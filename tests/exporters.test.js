'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/layout.js');
const X = require('../js/exporters.js');

const result = L.computeLayout(L.defaultConfig());

function motor() {
  return L.computeLayout(L.normalizeConfig({
    display: { width: 800, height: 480 },
    nodes: [{
      id: 'f', type: 'frame', name: 'Motore', mode: 'fixed', width: 370, height: 180, ral: '7035',
      area: { top: 30, bottom: 50, left: 20, right: 20 }, count: 4, columns: 2, rowGap: 20, colGap: 20,
      children: [{
        id: 'g', type: 'group', name: 'Pulsanti', area: { top: 10, bottom: 10, left: 10, right: 10 },
        blocks: [{ name: 'Start', width: 100, height: 40, gap: 0, ral: '6024' }], count: 2, columns: 2, colGap: 10
      }]
    }]
  }));
}

test('tabella "per blocco"', () => {
  const [sheet] = X.buildSheets(result, { view: 'long' });
  assert.deepEqual(sheet.columns.map((c) => c.label), ['Elem.', 'Riga', 'Col.', 'Blocco', 'X', 'Y', 'Larg.', 'Alt.', 'Colore']);
  assert.equal(sheet.rows.length, 12);
  assert.deepEqual(sheet.rows[0].values, [1, 1, 1, 'LED', 15, 30, 50, 50, 'RAL 6024']);
  assert.deepEqual(sheet.rows[1].values, [1, 1, 1, 'Scritta', 80, 30, 300, 50, 'RAL 5015']);
});

test('tabella "per elemento"', () => {
  const [sheet] = X.buildSheets(result, { view: 'wide' });
  assert.deepEqual(sheet.columns.map((c) => c.label), ['Elem.', 'Riga', 'Col.', 'LED X', 'LED Y', 'Scritta X', 'Scritta Y']);
  assert.deepEqual(sheet.rows[5].values, [6, 6, 1, 15, 380, 80, 380]);
  assert.deepEqual(sheet.rows[5].keys, ['n1:6:0', 'n1:6:1']);
  assert.equal(sheet.title, '');
});

test('TSV per Excel', () => {
  const lines = X.sheetsToTSV(X.buildSheets(result, { view: 'long' })).split('\n');
  assert.equal(lines[0], 'Elem.\tRiga\tCol.\tBlocco\tX\tY\tLarg.\tAlt.\tColore');
  assert.equal(lines[1], '1\t1\t1\tLED\t15\t30\t50\t50\tRAL 6024');
  assert.equal(lines.length, 13);
});

test('CSV con separatore ";" e testo protetto', () => {
  const cfg = L.defaultConfig();
  cfg.nodes[0].blocks[0].name = 'Pompa; "A"';
  cfg.nodes[0].blocks[1].name = '=SOMMA(A1)';
  cfg.nodes[0].blocks[1].color = '#cc0605';
  cfg.nodes[0].blocks[1].ral = '';
  const sheets = X.buildSheets(L.computeLayout(L.normalizeConfig(cfg)), { view: 'long' });
  const lines = X.sheetsToCSV(sheets, { sep: ';' }).split('\r\n');
  assert.equal(lines[1], '1;1;1;"Pompa; ""A""";15;30;50;50;RAL 6024');
  assert.equal(lines[2], '1;1;1;\'=SOMMA(A1);80;30;300;50;CC0605');
});

test('frame: coordinate relative (contenuto una volta) o assolute (ogni copia)', () => {
  const res = motor();
  const [rel] = X.buildSheets(res, { view: 'long', coord: 'frame' });
  assert.equal(rel.columns[0].label, 'Percorso');
  assert.deepEqual(rel.rows.map((r) => r.values.slice(0, 7)), [
    ['Motore', 1, 1, 1, 'Frame', 20, 30],
    ['Motore ×4 › Pulsanti', 1, 1, 1, 'Start', 10, 10],
    ['Motore ×4 › Pulsanti', 2, 1, 2, 'Start', 120, 10],
    ['Motore', 2, 1, 2, 'Frame', 410, 30],
    ['Motore', 3, 2, 1, 'Frame', 20, 230],
    ['Motore', 4, 2, 2, 'Frame', 410, 230]
  ]);
  assert.equal(rel.rows[0].values[9], 'RAL 7035');
  const [abs] = X.buildSheets(res, { view: 'long', coord: 'display' });
  assert.equal(abs.rows.length, 12);
  assert.deepEqual(abs.rows[4].values.slice(0, 7), ['Motore 2 › Pulsanti', 1, 1, 1, 'Start', 420, 40]);
});

test('frame: vista per elemento con colonna del frame contenitore', () => {
  const sheets = X.buildSheets(motor(), { view: 'wide', coord: 'display' });
  assert.equal(sheets.length, 2);
  assert.equal(sheets[0].title, 'Motore (frame)');
  assert.deepEqual(sheets[1].columns.map((c) => c.label), ['Frame', 'Elem.', 'Riga', 'Col.', 'Start X', 'Start Y']);
  assert.equal(sheets[1].rows.length, 8);
  assert.deepEqual(sheets[1].rows[2].values, ['Motore 2', 1, 1, 1, 420, 40]);
  const only = X.buildSheets(motor(), { view: 'wide', coord: 'frame', nodes: { g: true } });
  assert.equal(only.length, 1);
  assert.deepEqual(only[0].rows.map((r) => r.values), [['Motore ×4', 1, 1, 1, 10, 10], ['Motore ×4', 2, 1, 2, 120, 10]]);
});

test('codice ST per CODESYS', () => {
  const st = X.toST(result, {});
  assert.match(st.dut, /^TYPE ST_VisuRect :$/m);
  assert.match(st.dut, /iX : INT;/);
  assert.match(st.gvl, /^VAR_GLOBAL CONSTANT$/m);
  assert.match(st.gvl, /aLED : ARRAY\[1\.\.6\] OF ST_VisuRect := \[/);
  assert.match(st.gvl, /aScritta : ARRAY\[1\.\.6\] OF ST_VisuRect := \[/);
  assert.match(st.gvl, /\(iX := 15, iY := 30, iW := 50, iH := 50\),/);
  assert.match(st.gvl, /\(iX := 80, iY := 380, iW := 300, iH := 50\)\t/);
  assert.match(st.gvl, /END_VAR$/);
  const zero = X.toST(result, { base: 0, constant: false, typeName: '1 Rettangolo' });
  assert.match(zero.gvl, /ARRAY\[0\.\.5\] OF ST_1_Rettangolo/);
  assert.match(zero.gvl, /^VAR_GLOBAL$/m);
});

test('codice ST con frame: contenuto relativo una volta, frame in un array', () => {
  const rel = X.toST(motor(), { coord: 'frame' });
  assert.match(rel.gvl, /aMotore_Frame : ARRAY\[1\.\.4\] OF ST_VisuRect/);
  assert.match(rel.gvl, /aMotore_Pulsanti_Start : ARRAY\[1\.\.2\] OF ST_VisuRect/);
  assert.match(rel.gvl, /uguali in tutte le 4 copie/);
  assert.match(rel.gvl, /\(iX := 120, iY := 10, iW := 100, iH := 40\)/);
  const abs = X.toST(motor(), { coord: 'display' });
  assert.match(abs.gvl, /aMotore_Pulsanti_Start : ARRAY\[1\.\.8\] OF ST_VisuRect/);
  assert.match(abs.gvl, /\(iX := 530, iY := 40, iW := 100, iH := 40\)/);
});

test('identificatori IEC validi e unici', () => {
  assert.equal(X.identifier('Velocità motore', 'x'), 'Velocita_motore');
  assert.equal(X.identifier('__a--b__', 'x'), 'a_b');
  assert.equal(X.identifier('***', 'Blocco1'), 'Blocco1');
  const cfg = L.defaultConfig();
  cfg.nodes[0].blocks[1].name = 'led';
  const st = X.toST(L.computeLayout(L.normalizeConfig(cfg)), {});
  assert.match(st.gvl, /aLED : ARRAY/);
  assert.match(st.gvl, /aled_2 : ARRAY/);
});

test('i commenti ST non possono essere chiusi dai nomi', () => {
  const cfg = L.defaultConfig();
  cfg.nodes[0].name = 'Gruppo *) END_VAR (*';
  const st = X.toST(L.computeLayout(L.normalizeConfig(cfg)), {});
  for (const line of st.gvl.split('\n')) {
    const opens = (line.match(/\(\*/g) || []).length;
    const closes = (line.match(/\*\)/g) || []).length;
    assert.ok(opens <= 1 && opens === closes, line);
  }
});

test('JSON ad albero e testo', () => {
  const data = JSON.parse(X.toJSON(result));
  assert.equal(data.nodes[0].elements.length, 6);
  assert.deepEqual(data.nodes[0].elements[0].blocks[1], {
    name: 'Scritta', x: 80, y: 30, displayX: 80, displayY: 30, width: 300, height: 50, color: '#2271B3', ral: 'RAL 5015'
  });
  const tree = JSON.parse(X.toJSON(motor()));
  assert.equal(tree.nodes[0].type, 'frame');
  assert.equal(tree.nodes[0].instances.length, 4);
  assert.deepEqual(tree.nodes[0].instances[1].children[0].elements[0].blocks[0].x, 10);
  assert.deepEqual(tree.nodes[0].instances[1].children[0].elements[0].blocks[0].displayX, 420);
  const txt = X.toText(result);
  assert.match(txt, /Elemento 1 \(riga 1, col\. 1\)/);
  assert.match(txt, /LED\s+X\s+15\s+Y\s+30/);
  const ftxt = X.toText(motor(), { coord: 'frame' });
  assert.match(ftxt, /== Motore \(frame\) ==/);
  assert.match(ftxt, /\(display: X 30, Y 40\)/);
});
