'use strict';

/*
 * Prova "a campione": centinaia di layout casuali ma riproducibili (seme fisso) con frame,
 * gruppi, nascosti, trasparenti e sovrapposizioni. Si verifica che nulla si rompa e che
 * valgano le regole fondamentali del motore, della diagnostica e del disegno.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/layout.js');
const I = require('../js/issues.js');
const X = require('../js/exporters.js');

global.window = global;
require('../js/preview.js');
const P = global.DLC.preview;

/* Generatore pseudo-casuale con seme (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomConfig(r) {
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = (list) => list[Math.floor(r() * list.length)];
  const area = () => ({ top: int(0, 120), bottom: int(0, 120), left: int(0, 150), right: int(0, 150) });
  const colors = ['#2563eb', '#16a34a', '#f6f6f6', '#cc0605', '#9da1aa', '#fad201'];
  const group = (i) => ({
    type: 'group', name: 'G' + i, area: area(), direction: pick(['h', 'v']),
    blocks: Array.from({ length: int(1, 3) }, (_, b) => ({
      name: 'B' + b, width: int(10, 160), height: int(10, 90), gap: int(-5, 20), align: pick(['start', 'center', 'end']), color: pick(colors)
    })),
    count: int(0, 8), columns: int(1, 4), order: pick(['rows', 'cols']), rowGap: int(-5, 25), colGap: int(-5, 25),
    alignH: pick(['start', 'center', 'end', 'distribute']), alignV: pick(['start', 'center', 'end', 'distribute']),
    ...(r() < 0.15 ? { hidden: true } : {}), ...(r() < 0.15 ? { allowOverlap: true } : {})
  });
  const frame = (i, depth) => ({
    type: 'frame', name: 'F' + i, area: r() < 0.5 ? { top: 0, bottom: 0, left: 0, right: 0 } : area(),
    mode: pick(['fill', 'fill', 'fixed']), width: int(80, 400), height: int(60, 300), color: pick(colors),
    count: int(0, 4), columns: int(1, 3), rowGap: int(0, 20), colGap: int(0, 20),
    ...(r() < 0.3 ? { transparent: r() < 0.5 } : {}), ...(r() < 0.1 ? { hidden: true } : {}), ...(r() < 0.1 ? { allowOverlap: true } : {}),
    children: depth < 2 ? Array.from({ length: int(0, 3) }, (_, k) => (r() < 0.25 ? frame(i * 10 + k, depth + 1) : group(i * 10 + k))) : []
  });
  const nodes = Array.from({ length: int(1, 5) }, (_, i) => (r() < 0.45 ? frame(i, 0) : group(i)));
  return L.normalizeConfig({ display: { width: int(200, 1280), height: int(150, 800) }, nodes });
}

const keysOf = (res) => new Set(res.items.map((it) => it.key));
/* Posizione di ogni blocco (senza il gruppo di appartenenza: dopo un'unione cambia). */
const snapshotBlocks = (cfg) => L.computeLayout(cfg).items
  .filter((it) => it.kind === 'block').map((b) => [b.name, b.n, b.x, b.y, b.w, b.h].join()).sort();
const ids = (cfg) => { const out = []; L.walk(cfg.nodes, (n) => out.push(n.id)); return out.sort(); };

test('campione: motore, diagnostica, tabelle e disegno non si rompono e restano coerenti', () => {
  const r = rng(20261127);
  for (let n = 0; n < 250; n++) {
    const cfg = randomConfig(r);
    assert.deepEqual(L.normalizeConfig(JSON.parse(JSON.stringify(cfg))), cfg, 'normalizzazione idempotente');
    const res = L.computeLayout(cfg);
    const keys = keysOf(res);

    // sovrapposizioni: solo blocchi, coppie coerenti con i rettangoli
    assert.ok(res.items.filter((it) => it.overlap).every((it) => it.kind === 'block'), 'i frame non sono mai in collisione');
    assert.equal(res.totals.overlaps, res.items.filter((it) => it.overlap).length);
    res.overlapPairs.forEach((p) => {
      assert.ok(keys.has(p.a) && keys.has(p.b));
      const a = res.items.find((it) => it.key === p.a), b = res.items.find((it) => it.key === p.b);
      assert.ok(a.z < b.z, 'a sta sotto b');
      assert.ok(p.w > 0 && p.h > 0);
      assert.ok(p.x >= Math.max(a.x, b.x) && p.x + p.w <= Math.min(a.x + a.w, b.x + b.w));
      assert.ok(p.y >= Math.max(a.y, b.y) && p.y + p.h <= Math.min(a.y + a.h, b.y + b.h));
      assert.ok(!a.allow && !b.allow, 'la sovrapposizione voluta non si segnala');
      assert.notEqual(a.groupKey, b.groupKey);
    });
    // lo sfondo dei frame è sempre deciso
    res.items.filter((it) => it.kind === 'frame').forEach((f) => assert.equal(typeof f.transparent, 'boolean'));

    // diagnostica
    const issues = I.build(cfg, res);
    issues.forEach((it) => {
      assert.ok(res.nodes[it.node], 'nodo responsabile esistente');
      it.nodes.forEach((id) => assert.ok(res.nodes[id]));
      it.keys.forEach((k) => assert.ok(keys.has(k), 'chiave da evidenziare esistente'));
      assert.ok(['error', 'warn', 'info'].includes(it.severity));
      assert.ok(it.title && it.detail);
      assert.ok(it.count >= 1);
    });
    const rank = { error: 0, warn: 1, info: 2 };
    issues.forEach((it, i) => { if (i) assert.ok(rank[issues[i - 1].severity] <= rank[it.severity], 'ordinati per gravità'); });
    I.totals(issues);

    // tabelle, codice ST, testo, JSON
    ['long', 'wide'].forEach((view) => ['frame', 'display'].forEach((coord) => {
      X.buildSheets(res, { view, coord, sizes: r() < 0.5, hide: r() < 0.5 ? { n: true, row: true, path: true, ctx: true, color: true } : null })
        .forEach((s) => s.rows.forEach((row) => assert.equal(row.values.length, s.columns.length)));
      X.toST(res, { coord });
      X.toText(res, { coord });
    }));
    JSON.parse(X.toJSON(res));

    // disegno: ben formato in tutte le modalità
    [{ colorful: true }, { selected: cfg.nodes[0].id, focus: L.descendantIds(cfg.nodes[0]) }, { solid: true, only: L.descendantIds(cfg.nodes[0]) }]
      .forEach((extra) => {
        const svg = P.markup(res, Object.assign({
          scale: 0.7, coord: 'frame', showGrid: true, showNames: true, showCoords: true, solid: false, problems: true
        }, extra));
        assert.equal((svg.match(/<g /g) || []).length, (svg.match(/<\/g>/g) || []).length);
        assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
        assert.ok(!/NaN|undefined|Infinity/.test(svg), 'nessun valore non valido nel disegno');
      });
    P.exportSVG(res, { coord: 'frame' }, { pixels: 2 });
  }
});

test('campione: ordine, spostamenti e unioni non perdono né spostano blocchi', () => {
  const r = rng(424242);
  let moved = 0, merged = 0, refused = 0;
  for (let n = 0; n < 200; n++) {
    const cfg = randomConfig(r);
    const all = ids(cfg);
    const pickId = () => all[Math.floor(r() * all.length)];

    // ordine dei livelli: stessi nodi, stesso numero
    const a = pickId();
    L.reorder(cfg, a, ['front', 'forward', 'backward', 'back'][Math.floor(r() * 4)]);
    assert.deepEqual(ids(cfg), all);

    // spostamento: o riesce (stessi nodi) o lascia tutto com'era
    const id = pickId(), target = r() < 0.3 ? '' : pickId();
    const before = JSON.stringify(cfg), why = L.canMove(cfg, id, target);
    const res = L.moveNode(cfg, id, target, r() < 0.5 ? 0 : undefined, { keepPosition: r() < 0.5 });
    if (why) {
      assert.equal(res.ok, false);
      assert.equal(JSON.stringify(cfg), before, 'spostamento non consentito: nessuna modifica');
    } else {
      assert.equal(res.ok, true);
      assert.deepEqual(ids(cfg), all);
      moved++;
    }

    // unione: se riesce nessun blocco cambia posto; se no la configurazione resta intatta
    const groups = [];
    L.walk(cfg.nodes, (node, parent, list) => { if (node.type === 'group') groups.push({ node, list }); });
    for (const g of groups) {
      const mate = groups.find((o) => o.list === g.list && o.node.id !== g.node.id);
      if (!mate) continue;
      const snap = JSON.stringify(cfg), blocks = snapshotBlocks(cfg);
      const out = L.mergeGroups(cfg, g.node.id, mate.node.id);
      if (out.ok) {
        merged++;
        assert.deepEqual(snapshotBlocks(cfg), blocks, 'ogni blocco resta esattamente dov\'era');
        assert.equal(ids(cfg).length, all.length - 1);
      } else {
        refused++;
        assert.ok(out.reason);
        assert.equal(JSON.stringify(cfg), snap, 'unione rifiutata: nessuna modifica');
      }
      break;
    }
  }
  assert.ok(moved > 20 && refused > 10, 'il campione esercita davvero i due casi (spostati ' + moved + ', rifiutate ' + refused + ', unite ' + merged + ')');
});

test('campione: due gruppi costruiti per essere uniti si uniscono quasi sempre', () => {
  const r = rng(7);
  let ok = 0;
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  for (let n = 0; n < 150; n++) {
    const wA = int(20, 200), wB = int(20, 200), h = int(20, 80), gap = int(0, 30), count = int(1, 6);
    const alignH = ['start', 'end'][int(0, 1)], rowGap = int(0, 20);
    const left = int(0, 40), right = int(0, 40), top = int(0, 40), bottom = int(0, 40);
    const W = 800, H = 480;
    const grp = (id, w, areaLeft, areaRight) => ({
      id, type: 'group', name: id, area: { top, bottom, left: areaLeft, right: areaRight }, direction: 'h',
      blocks: [{ name: id, width: w, height: h, gap: 0, align: 'center', color: '#2563eb' }],
      count, columns: 1, order: 'rows', rowGap, colGap: 0, alignH, alignV: ['start', 'center', 'end'][int(0, 2)]
    });
    // B sta a destra di A: se allineati a sinistra B sposta il bordo sinistro dell'area, se a destra A sposta quello destro
    const vAlign = ['start', 'center', 'end'][int(0, 2)];
    const A = grp('A', wA, alignH === 'start' ? left : left, alignH === 'start' ? W - left - wA - gap - wB : right + wB + gap);
    const B = grp('B', wB, alignH === 'start' ? left + wA + gap : left, alignH === 'start' ? right : right);
    A.alignV = vAlign; B.alignV = vAlign;
    const cfg = L.normalizeConfig({ display: { width: W, height: H }, nodes: [A, B] });
    const before = snapshotBlocks(cfg);
    const out = L.mergeGroups(cfg, 'A', 'B');
    if (out.ok) { ok++; assert.deepEqual(snapshotBlocks(cfg), before); }
    else assert.ok(out.reason, 'se rifiuta, spiega perché');
  }
  assert.ok(ok > 100, 'i gruppi costruiti per essere uniti si uniscono quasi sempre (' + ok + ' su 150)');
});
