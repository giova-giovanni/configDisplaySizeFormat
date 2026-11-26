'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/layout.js');

function compute(mutate) {
  const cfg = L.defaultConfig();
  if (mutate) mutate(cfg, cfg.nodes[0]);
  return L.computeLayout(L.normalizeConfig(cfg));
}

/* Primo contesto (prima copia) di un nodo. */
function ctx(res, id) {
  return res.nodes[id].contexts[0];
}

test('esempio iniziale: 800x480, offset 30/50, LED 50 + Scritta 300, distanza 15, righe a 20 px', () => {
  const res = compute();
  const g = ctx(res, 'n1');
  assert.deepEqual([g.region.x, g.region.y, g.region.w, g.region.h], [0, 30, 800, 400]);
  assert.equal(g.element.w, 380);
  assert.equal(g.element.h, 50);
  assert.equal(g.items.length, 6);
  assert.deepEqual(g.items.map((it) => it.y), [30, 100, 170, 240, 310, 380]);
  for (const it of g.items) {
    assert.deepEqual(it.blocks.map((b) => [b.name, b.x, b.w, b.h]), [['LED', 15, 50, 50], ['Scritta', 80, 300, 50]]);
    assert.deepEqual(it.blocks.map((b) => [b.rx, b.ry]), it.blocks.map((b) => [b.x, b.y]));
  }
  assert.equal(res.totals.outArea, 0);
  assert.equal(res.totals.outDisplay, 0);
  assert.equal(res.totals.elements, 6);
  assert.equal(res.totals.blocks, 12);
  assert.deepEqual(g.fit, { rows: 6, cols: 2 });
  assert.equal(g.free.h, 0, 'le 6 righe riempiono esattamente l\'area');
  assert.equal(res.hasFrames, false);
});

test('elementi oltre l\'area vengono segnalati', () => {
  const res = compute((c, g) => { g.count = 7; });
  const last = ctx(res, 'n1').items[6];
  assert.equal(last.y, 450);
  assert.ok(last.blocks.every((b) => b.outArea && b.outDisplay));
  assert.equal(res.nodes.n1.out.area, 2);
});

test('due colonne con numerazione per righe', () => {
  const g = ctx(compute((c, g) => { g.count = 12; g.columns = 2; }), 'n1');
  assert.equal(g.rows, 6);
  assert.equal(g.cols, 2);
  assert.equal(g.items[1].x, 400); // 380 + 20
  assert.equal(g.items[1].blocks[0].x, 415);
  assert.equal(g.items[1].row, 1);
  assert.equal(g.items[2].row, 2);
});

test('numerazione per colonne', () => {
  const g = ctx(compute((c, g) => { g.count = 12; g.columns = 2; g.order = 'cols'; }), 'n1');
  assert.deepEqual([g.items[5].row, g.items[5].col], [6, 1]);
  assert.deepEqual([g.items[6].row, g.items[6].col], [1, 2]);
  assert.equal(g.items[6].blocks[0].x, 415);
});

test('numerazione per colonne con elementi non multipli', () => {
  const g = ctx(compute((c, g) => { g.count = 5; g.columns = 2; g.order = 'cols'; }), 'n1');
  assert.equal(g.rows, 3);
  assert.equal(g.cols, 2);
  assert.deepEqual(g.items.map((it) => [it.row, it.col]), [[1, 1], [2, 1], [3, 1], [1, 2], [2, 2]]);
});

test('allineamenti orizzontali: centro e destra', () => {
  assert.equal(ctx(compute((c, g) => { g.count = 1; g.alignH = 'center'; }), 'n1').items[0].x, 210);
  assert.equal(ctx(compute((c, g) => { g.count = 1; g.alignH = 'end'; }), 'n1').items[0].x, 420);
});

test('distribuisci: prima e ultima riga sui bordi dell\'area', () => {
  const g = ctx(compute((c, g) => { g.count = 3; g.alignV = 'distribute'; }), 'n1');
  assert.deepEqual(g.items.map((it) => it.y), [30, 205, 380]);
  assert.equal(g.gaps.row, 125);
});

test('blocchi di altezza diversa: allineamento al centro', () => {
  const g = ctx(compute((c, g) => { g.blocks[0].height = 30; }), 'n1');
  assert.equal(g.element.h, 50);
  assert.equal(g.items[0].blocks[0].y, 40);
  assert.equal(g.items[0].blocks[1].y, 30);
});

test('blocchi impilati (verticale)', () => {
  const g = ctx(compute((c, g) => { g.direction = 'v'; g.count = 1; }), 'n1');
  assert.equal(g.element.w, 300);
  assert.equal(g.element.h, 130);
  const [led, txt] = g.items[0].blocks;
  assert.deepEqual([led.x, led.y], [125, 45]);
  assert.deepEqual([txt.x, txt.y], [0, 110]);
});

test('area non valida quando gli offset superano il display', () => {
  const res = compute((c, g) => { g.area.top = 300; g.area.bottom = 300; });
  assert.equal(ctx(res, 'n1').region.valid, false);
  assert.ok(res.items.every((b) => b.outArea));
});

/* ---------------------------------------------------------------- frame */

function motorConfig() {
  return L.normalizeConfig({
    display: { width: 800, height: 480 },
    nodes: [{
      id: 'f', type: 'frame', name: 'Motore', mode: 'fixed', width: 370, height: 180,
      area: { top: 30, bottom: 50, left: 20, right: 20 },
      count: 4, columns: 2, rowGap: 20, colGap: 20,
      children: [{
        id: 'g', type: 'group', name: 'Pulsanti', area: { top: 10, bottom: 10, left: 10, right: 10 },
        blocks: [{ name: 'Start', width: 100, height: 40, gap: 0, align: 'start', color: 'RAL', ral: '6024' }],
        count: 2, columns: 2, colGap: 10
      }]
    }]
  });
}

test('frame ripetuti: posizioni dei frame e coordinate relative del contenuto', () => {
  const res = L.computeLayout(motorConfig());
  const frames = res.items.filter((it) => it.kind === 'frame');
  assert.deepEqual(frames.map((f) => [f.x, f.y, f.w, f.h]), [[20, 30, 370, 180], [410, 30, 370, 180], [20, 230, 370, 180], [410, 230, 370, 180]]);
  assert.deepEqual(frames.map((f) => f.label), ['Motore 1', 'Motore 2', 'Motore 3', 'Motore 4']);
  const blocks = res.items.filter((it) => it.kind === 'block');
  assert.equal(blocks.length, 8);
  // dentro ogni frame il contenuto ha le stesse coordinate relative
  for (const b of blocks) assert.deepEqual([b.rx, b.ry], b.n === 1 ? [10, 10] : [120, 10]);
  const second = blocks.filter((b) => b.key.startsWith('f#2/'));
  assert.deepEqual(second.map((b) => [b.x, b.y]), [[420, 40], [530, 40]]);
  assert.equal(second[0].path, 'Motore 2 › Pulsanti');
  assert.equal(second[0].relPath, 'Motore ×4 › Pulsanti');
  assert.equal(second[0].dup, true);
  assert.equal(second[0].twin, 'f#1/g:1:0');
  assert.equal(frames[2].twin, 'f#3');
  assert.equal(res.nodes.g.contexts.length, 4);
  assert.equal(res.totals.frames, 4);
  assert.equal(res.totals.overlaps, 0, 'un frame non si sovrappone ai suoi figli');
  assert.equal(res.hasFrames, true);
  assert.equal(blocks[0].color, '#308446');
  assert.equal(blocks[0].ral, '6024');
});

test('frame "riempie l\'area" con gruppo interno e figli fuori dal frame', () => {
  const cfg = L.normalizeConfig({
    nodes: [{
      id: 'p', type: 'frame', name: 'Pannello', area: { top: 40, bottom: 40, left: 40, right: 40 },
      children: [{ id: 'g', type: 'group', area: { top: 0, bottom: 0, left: 0, right: 0 }, blocks: [{ width: 100, height: 50 }], count: 9, columns: 1, rowGap: 0 }]
    }]
  });
  const res = L.computeLayout(cfg);
  const frame = res.items[0];
  assert.deepEqual([frame.x, frame.y, frame.w, frame.h], [40, 40, 720, 400]);
  const blocks = res.items.filter((it) => it.kind === 'block');
  assert.deepEqual([blocks[0].x, blocks[0].y, blocks[0].rx, blocks[0].ry], [40, 40, 0, 0]);
  assert.equal(blocks[8].ry, 400);
  assert.ok(blocks[8].outArea, 'il nono blocco esce dal frame');
  assert.ok(!blocks[7].outArea);
});

test('sovrapposizioni tra frame e gruppi esterni', () => {
  const cfg = motorConfig();
  cfg.nodes.push({ id: 'x', type: 'group', name: 'Esterno', area: { top: 40, bottom: 0, left: 30, right: 0 }, blocks: [{ name: 'B', width: 20, height: 20, gap: 0 }], count: 1, columns: 1, order: 'rows', rowGap: 0, colGap: 0, alignH: 'start', alignV: 'start', direction: 'h' });
  const res = L.computeLayout(L.normalizeConfig(cfg));
  const ext = res.items.find((it) => it.node === 'x');
  assert.ok(ext.overlap);
  assert.ok(res.items.find((it) => it.key === 'f#1').overlap);
});

test('nodi dentro un frame senza copie restano senza contesti', () => {
  const cfg = motorConfig();
  cfg.nodes[0].count = 0;
  const res = L.computeLayout(cfg);
  assert.equal(res.nodes.g.contexts.length, 0);
  assert.equal(res.nodes.g.parent, 'f');
  assert.deepEqual(res.order, ['f', 'g']);
});

test('limite totale di oggetti', () => {
  const cfg = L.defaultConfig();
  cfg.nodes = [];
  for (let i = 0; i < 6; i++) {
    cfg.nodes.push({ type: 'group', blocks: [{}, {}], count: 1000 });
  }
  const res = L.computeLayout(L.normalizeConfig(cfg));
  assert.equal(res.truncated, true);
  assert.ok(res.items.length <= L.LIMITS.maxTotalItems);
});

/* ------------------------------------------------- struttura ad albero */

test('racchiudere un gruppo in un frame mantiene le coordinate', () => {
  const cfg = L.defaultConfig();
  const before = L.computeLayout(cfg).items.map((it) => [it.x, it.y]);
  const frame = L.wrapInFrame(cfg, 'n1');
  assert.equal(frame.type, 'frame');
  assert.deepEqual(frame.area, { top: 30, bottom: 50, left: 0, right: 0 });
  assert.deepEqual(cfg.nodes[0].children[0].area, { top: 0, bottom: 0, left: 0, right: 0 });
  const after = L.computeLayout(cfg).items.filter((it) => it.kind === 'block').map((it) => [it.x, it.y]);
  assert.deepEqual(after, before);
  const rel = L.computeLayout(cfg).items.filter((it) => it.kind === 'block')[0];
  assert.deepEqual([rel.rx, rel.ry], [15, 0]);
});

test('spostare, duplicare, eliminare nodi', () => {
  const cfg = motorConfig();
  assert.equal(L.moveTo(cfg, 'f', 'g'), false, 'un nodo non può finire dentro se stesso');
  assert.equal(L.moveTo(cfg, 'g', ''), true);
  assert.deepEqual(cfg.nodes.map((n) => n.id), ['f', 'g']);
  const copy = L.duplicateNode(cfg, 'f');
  assert.notEqual(copy.id, 'f');
  assert.equal(copy.name, 'Motore (copia)');
  assert.equal(L.countNodes(cfg.nodes), 3);
  assert.ok(L.removeNode(cfg, 'f'));
  assert.ok(L.removeNode(cfg, copy.id));
  assert.equal(L.removeNode(cfg, 'g'), null, 'resta almeno un nodo');
  const opts = L.containers(motorConfig(), 'g').map((c) => c.id);
  assert.deepEqual(opts, ['', 'f']);
});

test('inserimento: dentro un frame o dopo il nodo selezionato', () => {
  const cfg = motorConfig();
  const g2 = L.newGroup(cfg, 'f', 'g');
  assert.ok(L.insertNode(cfg, g2, 'f'));
  assert.deepEqual(cfg.nodes[0].children.map((n) => n.id), ['g', g2.id]);
  const g3 = L.newGroup(cfg, '', 'g');
  L.insertNode(cfg, g3, 'g');
  assert.deepEqual(cfg.nodes[0].children.map((n) => n.id), ['g', g3.id, g2.id]);
  assert.equal(g2.name, 'Gruppo 1');
  assert.equal(g3.name, 'Gruppo 2');
});

test('nuovo gruppo sul display: occupa la fascia libera in basso', () => {
  const cfg = L.defaultConfig();
  const g2 = L.newGroup(cfg, '', 'n1');
  L.insertNode(cfg, g2, 'n1');
  const res = L.computeLayout(cfg);
  assert.equal(g2.area.top, 430);
  assert.equal(res.totals.overlaps, 0);
  assert.deepEqual(ctx(res, g2.id).items.map((it) => it.x), [130, 270, 410, 550]);
});

test('profondità massima di annidamento', () => {
  let node = { type: 'group', name: 'Fondo' };
  for (let i = 0; i < 8; i++) node = { type: 'frame', name: 'F' + i, children: [node] };
  const cfg = L.normalizeConfig({ nodes: [node] });
  let depth = 0;
  L.walk(cfg.nodes, (n, p, list, i, d) => { depth = Math.max(depth, d); });
  assert.equal(depth, L.LIMITS.maxDepth);
});

/* ----------------------------------------------------- normalizzazione */

test('formato versione 1 (gruppi) convertito automaticamente', () => {
  const v1 = { name: 'Vecchio', display: { width: 1024, height: 600 }, groups: [{ name: 'A', count: 3 }, { name: 'B' }] };
  const c = L.normalizeConfig(v1);
  assert.equal(c.v, 2);
  assert.deepEqual(c.nodes.map((n) => [n.type, n.name]), [['group', 'A'], ['group', 'B']]);
  assert.notEqual(c.nodes[0].id, c.nodes[1].id);
});

test('normalizeConfig ripara dati non validi', () => {
  const c = L.normalizeConfig({
    name: '  Prova\n',
    display: { width: 'abc', height: -5 },
    nodes: [{ blocks: [{ name: '', width: '0', height: 1e9, gap: 'x', color: 'red', align: 'boh' }], count: 1.6, columns: 0 }]
  });
  assert.equal(c.name, 'Prova');
  assert.deepEqual(c.display, { width: 800, height: 1 });
  const b = c.nodes[0].blocks[0];
  assert.equal(b.name, 'Blocco 1');
  assert.equal(b.width, 1);
  assert.equal(b.height, 10000);
  assert.equal(b.gap, 0);
  assert.match(b.color, /^#[0-9a-f]{6}$/);
  assert.equal(b.ral, '');
  assert.equal(b.align, 'center');
  assert.equal(c.nodes[0].count, 2);
  assert.equal(c.nodes[0].columns, 1);
  assert.equal(L.normalizeConfig(null).nodes.length, 1);
  assert.equal(L.normalizeConfig({ nodes: 'x' }).nodes[0].blocks.length, 2);
});

test('id duplicati vengono rigenerati', () => {
  const c = L.normalizeConfig({ nodes: [{ id: 'a' }, { id: 'a' }, { id: '<script>' }] });
  const ids = c.nodes.map((n) => n.id);
  assert.equal(ids[0], 'a');
  assert.equal(new Set(ids).size, 3);
  assert.match(ids[2], /^[A-Za-z0-9_-]+$/);
});

test('colori: esadecimale, RAL e coerenza', () => {
  assert.equal(L.cleanColor('#AbC', null), '#aabbcc');
  assert.equal(L.cleanColor('javascript:alert(1)', '#000000'), '#000000');
  assert.deepEqual(L.colorPair(null, 'RAL 3020', '#000000'), { color: '#cc0605', ral: '3020' });
  assert.deepEqual(L.colorPair('#cc0605', '3020', '#000000'), { color: '#cc0605', ral: '3020' });
  assert.deepEqual(L.colorPair('#123456', '3020', '#000000'), { color: '#123456', ral: '' });
  assert.deepEqual(L.colorPair('#123456', '9999', '#000000'), { color: '#123456', ral: '' });
});
