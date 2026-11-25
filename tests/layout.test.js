'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/layout.js');

function compute(mutate) {
  const cfg = L.defaultConfig();
  if (mutate) mutate(cfg, cfg.groups[0]);
  return L.computeLayout(L.normalizeConfig(cfg));
}

test('esempio iniziale: 800x480, offset 30/50, LED 50 + Scritta 300, distanza 15, righe a 20 px', () => {
  const res = compute();
  const g = res.groups[0];
  assert.deepEqual(g.area, { x: 0, y: 30, w: 800, h: 400 });
  assert.equal(g.element.w, 380);
  assert.equal(g.element.h, 50);
  assert.equal(g.items.length, 6);
  assert.deepEqual(g.items.map((it) => it.y), [30, 100, 170, 240, 310, 380]);
  for (const it of g.items) {
    assert.deepEqual(it.blocks.map((b) => [b.name, b.x, b.w, b.h]), [['LED', 15, 50, 50], ['Scritta', 80, 300, 50]]);
  }
  assert.equal(res.totals.outArea, 0);
  assert.equal(res.totals.outDisplay, 0);
  assert.deepEqual(g.fit, { rows: 6, cols: 2 });
  assert.equal(g.free.h, 0, 'le 6 righe riempiono esattamente l\'area');
});

test('elementi oltre l\'area vengono segnalati', () => {
  const g = compute((c, g) => { g.count = 7; }).groups[0];
  const last = g.items[6];
  assert.equal(last.y, 450);
  assert.ok(last.blocks.every((b) => b.outArea && b.outDisplay));
  assert.equal(g.out.area, 2);
});

test('due colonne con numerazione per righe', () => {
  const g = compute((c, g) => { g.count = 12; g.columns = 2; }).groups[0];
  assert.equal(g.rows, 6);
  assert.equal(g.cols, 2);
  assert.equal(g.items[1].x, 400); // 380 + 20
  assert.equal(g.items[1].blocks[0].x, 415);
  assert.equal(g.items[1].row, 1);
  assert.equal(g.items[2].row, 2);
});

test('numerazione per colonne', () => {
  const g = compute((c, g) => { g.count = 12; g.columns = 2; g.order = 'cols'; }).groups[0];
  assert.deepEqual([g.items[5].row, g.items[5].col], [6, 1]);
  assert.deepEqual([g.items[6].row, g.items[6].col], [1, 2]);
  assert.equal(g.items[6].blocks[0].x, 415);
});

test('numerazione per colonne con elementi non multipli', () => {
  const g = compute((c, g) => { g.count = 5; g.columns = 2; g.order = 'cols'; }).groups[0];
  assert.equal(g.rows, 3);
  assert.equal(g.cols, 2);
  assert.deepEqual(g.items.map((it) => [it.row, it.col]), [[1, 1], [2, 1], [3, 1], [1, 2], [2, 2]]);
});

test('allineamenti orizzontali: centro e destra', () => {
  const center = compute((c, g) => { g.count = 1; g.alignH = 'center'; }).groups[0];
  assert.equal(center.items[0].x, 210); // (800 - 380) / 2
  const end = compute((c, g) => { g.count = 1; g.alignH = 'end'; }).groups[0];
  assert.equal(end.items[0].x, 420);
});

test('distribuisci: prima e ultima riga sui bordi dell\'area', () => {
  const g = compute((c, g) => { g.count = 3; g.alignV = 'distribute'; }).groups[0];
  assert.deepEqual(g.items.map((it) => it.y), [30, 205, 380]);
  assert.equal(g.gaps.row, 125);
});

test('blocchi di altezza diversa: allineamento al centro', () => {
  const g = compute((c, g) => { g.blocks[0].height = 30; }).groups[0];
  assert.equal(g.element.h, 50);
  assert.equal(g.items[0].blocks[0].y, 40); // 30 + (50 - 30) / 2
  assert.equal(g.items[0].blocks[1].y, 30);
});

test('blocchi impilati (verticale)', () => {
  const g = compute((c, g) => { g.direction = 'v'; g.count = 1; }).groups[0];
  assert.equal(g.element.w, 300);
  assert.equal(g.element.h, 130); // 15 + 50 + 15 + 50
  const [led, txt] = g.items[0].blocks;
  assert.deepEqual([led.x, led.y], [125, 45]);
  assert.deepEqual([txt.x, txt.y], [0, 110]);
});

test('area non valida quando gli offset superano il display', () => {
  const g = compute((c, g) => { g.area.top = 300; g.area.bottom = 300; }).groups[0];
  assert.equal(g.areaValid, false);
  assert.ok(g.blocks.every((b) => b.outArea));
});

test('sovrapposizioni segnalate solo tra gruppi diversi', () => {
  const cfg = L.defaultConfig();
  cfg.groups.push(JSON.parse(JSON.stringify(cfg.groups[0])));
  const res = L.computeLayout(L.normalizeConfig(cfg));
  assert.equal(res.totals.overlaps, 24);
  const single = compute((c, g) => { g.blocks[1].gap = -20; });
  assert.equal(single.totals.overlaps, 0);
});

test('nuovo gruppo suggerito nella fascia libera in basso', () => {
  const cfg = L.defaultConfig();
  const g2 = L.suggestGroup(cfg, 0);
  assert.equal(g2.area.top, 430);
  assert.equal(g2.area.bottom, 0);
  cfg.groups.push(g2);
  const res = L.computeLayout(L.normalizeConfig(cfg));
  assert.equal(res.totals.overlaps, 0);
  assert.equal(res.groups[1].out.area, 0);
  assert.deepEqual(res.groups[1].items.map((it) => it.x), [130, 270, 410, 550]);
});

test('limite totale di blocchi', () => {
  const cfg = L.defaultConfig();
  cfg.groups = [];
  for (let i = 0; i < 6; i++) {
    const g = L.defaultGroup(i);
    g.count = 1000;
    cfg.groups.push(g);
  }
  const res = L.computeLayout(L.normalizeConfig(cfg));
  assert.equal(res.truncated, true);
  assert.ok(res.blocks.length <= L.LIMITS.maxTotalBlocks);
});

test('normalizeConfig ripara dati non validi', () => {
  const c = L.normalizeConfig({
    name: '  Prova\n',
    display: { width: 'abc', height: -5 },
    groups: [{ blocks: [{ name: '', width: '0', height: 1e9, gap: 'x', color: 'red', align: 'boh' }], count: 1.6, columns: 0 }]
  });
  assert.equal(c.name, 'Prova');
  assert.deepEqual(c.display, { width: 800, height: 1 });
  const b = c.groups[0].blocks[0];
  assert.equal(b.name, 'Blocco 1');
  assert.equal(b.width, 1);
  assert.equal(b.height, 10000);
  assert.equal(b.gap, 0);
  assert.match(b.color, /^#[0-9a-f]{6}$/);
  assert.equal(b.align, 'center');
  assert.equal(c.groups[0].count, 2);
  assert.equal(c.groups[0].columns, 1);
  assert.equal(L.normalizeConfig(null).groups.length, 1);
  assert.equal(L.normalizeConfig({ groups: 'x' }).groups[0].blocks.length, 2);
});

test('colori brevi #abc accettati', () => {
  assert.equal(L.cleanColor('#AbC', null), '#aabbcc');
  assert.equal(L.cleanColor('javascript:alert(1)', '#000000'), '#000000');
});
