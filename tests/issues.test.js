'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/layout.js');
const I = require('../js/issues.js');

/* Tre livelli a schermo intero (sfondo, menu, pagina): la configurazione che generava 32 falsi allarmi. */
const { layers: baseLayers } = require('./fixtures.js');

function layers(mutate) {
  const cfg = baseLayers();
  if (mutate) mutate(cfg);
  return cfg;
}

function diagnose(cfg) { return I.build(cfg, L.computeLayout(cfg)); }
const kinds = (list) => list.map((i) => i.kind);

test('diagnostica: nessun falso allarme sui livelli, solo i problemi veri', () => {
  const list = diagnose(layers());
  assert.deepEqual(kinds(list), ['overlap', 'out-area'], 'una collisione vera e un gruppo che non entra nell\'area');
  const [ovl, area] = list;

  assert.deepEqual(ovl.nodes, ['alm', 'pag']);
  assert.equal(ovl.node, 'alm', 'porta al gruppo "sotto": è il primo coinvolto');
  assert.equal(ovl.severity, 'warn');
  assert.equal(ovl.count, 1);
  assert.match(ovl.title, /«Allarmi» e «Pulsanti» si sovrappongono/);
  assert.match(ovl.detail, /hanno in comune 9 × 60 px a X 611, Y 417/);
  assert.match(ovl.fix, /almeno 9 px in orizzontale/);
  assert.deepEqual(ovl.keys.sort(), ['bg#1/alm:1:0', 'bg#1/pag:1:0'].sort());

  assert.equal(area.node, 'pop');
  assert.equal(area.count, 2);
  assert.match(area.title, /«Comparsa»: 2 elementi fuori dalla propria area/);
  assert.match(area.detail, /area di lavoro misura 797 × 234 px/);
  assert.match(area.detail, /servono 312 px/);
  assert.match(area.detail, /mancano 78 px/);
  assert.match(area.detail, /ci stanno 3 righe, ne hai 5/);
  assert.match(area.fix, /riduci gli elementi a 3 \(3 righe\)/);
  assert.match(area.fix, /offset in alto da 180 a 102/, 'allineato in basso: sporge in alto, si riduce l\'offset in alto');
});

test('diagnostica: fuori dal display è un errore e viene prima degli avvisi', () => {
  const list = diagnose(layers((cfg) => { cfg.nodes[2].children[0].count = 9; }));
  assert.equal(list[0].kind, 'out-display');
  assert.equal(list[0].severity, 'error');
  assert.match(list[0].title, /«Ingressi»: \d+ elementi escono dal display/);
  assert.match(list[0].detail, /Il display misura 800 × 480 px/);
  assert.match(list[0].detail, /in basso/);
  const totals = I.totals(list);
  assert.ok(totals['out-display'].count >= 1);
  assert.ok(totals['out-area'].count >= totals['out-display'].count);
});

test('diagnostica: area non valida', () => {
  const list = diagnose(layers((cfg) => { cfg.nodes[2].area = { top: 300, bottom: 300, left: 0, right: 0 }; }));
  const bad = list.find((i) => i.kind === 'bad-area' && i.node === 'page');
  assert.ok(bad);
  assert.equal(bad.severity, 'error');
  assert.match(bad.detail, /in verticale 300 \+ 300 px di offset su 480 px/);
  assert.ok(!list.some((i) => i.kind === 'out-area' && i.node === 'page'), 'niente doppioni: è già "area non valida"');
});

test('diagnostica: un frame con sfondo pieno che nasconde blocchi si può rendere trasparente con un clic', () => {
  assert.ok(!diagnose(layers()).some((i) => i.kind === 'covered'), 'automatico: nessun problema');
  const list = diagnose(layers((cfg) => { cfg.nodes[1].transparent = false; }));
  const cov = list.find((i) => i.kind === 'covered');
  assert.ok(cov);
  assert.equal(cov.severity, 'info');
  assert.equal(cov.node, 'menu');
  assert.match(cov.title, /Il frame «Menu» nasconde 5 blocchi dei livelli sotto/);
  assert.deepEqual(cov.action, { id: 'transparent', label: 'Rendi trasparente', node: 'menu' });
  assert.equal(list[list.length - 1], cov, 'le note vengono dopo gli avvisi');
});

test('diagnostica: sovrapposizione voluta o nascosta non cambia l\'esito, la voluta sì', () => {
  assert.equal(diagnose(layers((cfg) => { cfg.nodes[0].children[1].allowOverlap = true; })).filter((i) => i.kind === 'overlap').length, 0);
  assert.equal(diagnose(layers((cfg) => { cfg.nodes[0].hidden = true; })).filter((i) => i.kind === 'overlap').length, 1);
});

test('diagnostica: filtro per nodi e totali', () => {
  const list = diagnose(layers());
  assert.deepEqual(kinds(I.forNodes(list, { pop: true })), ['out-area']);
  assert.deepEqual(kinds(I.forNodes(list, { pag: true })), ['overlap'], 'basta uno dei due nodi coinvolti');
  assert.equal(I.forNodes(list, null), list);
  const t = I.totals(list);
  assert.deepEqual([t.overlap.issues, t.overlap.count, t['out-area'].count, t['out-display'].issues], [1, 1, 2, 0]);
});

test('diagnostica: i frame ripetuti non moltiplicano i problemi delle copie', () => {
  const cfg = L.normalizeConfig({
    display: { width: 800, height: 480 },
    nodes: [{
      id: 'f', type: 'frame', name: 'Scheda', mode: 'fixed', width: 300, height: 100, area: { top: 0, bottom: 0, left: 0, right: 0 },
      count: 4, columns: 2, rowGap: 10, colGap: 10,
      children: [{ id: 'g', type: 'group', name: 'Righe', area: { top: 0, bottom: 0, left: 0, right: 0 },
        blocks: [{ name: 'R', width: 100, height: 40, gap: 0 }], count: 3, columns: 1, rowGap: 5 }]
    }]
  });
  const list = I.build(cfg, L.computeLayout(cfg));
  const area = list.find((i) => i.kind === 'out-area' && i.node === 'g');
  assert.ok(area, '3 righe da 40 + 2 × 5 = 130 px non entrano nei 100 px del frame');
  assert.equal(area.count, 1, 'solo l\'elemento che esce, contato nella prima copia');
  assert.match(area.detail, /mancano 30 px/);
});
