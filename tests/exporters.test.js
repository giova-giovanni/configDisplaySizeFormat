'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/layout.js');
const X = require('../js/exporters.js');

const result = L.computeLayout(L.defaultConfig());

test('tabella "per blocco"', () => {
  const [sheet] = X.buildSheets(result, { view: 'long' });
  assert.deepEqual(sheet.columns.map((c) => c.label), ['Elem.', 'Riga', 'Col.', 'Blocco', 'X', 'Y', 'Larg.', 'Alt.']);
  assert.equal(sheet.rows.length, 12);
  assert.deepEqual(sheet.rows[0].values, [1, 1, 1, 'LED', 15, 30, 50, 50]);
  assert.deepEqual(sheet.rows[1].values, [1, 1, 1, 'Scritta', 80, 30, 300, 50]);
});

test('tabella "per elemento"', () => {
  const [sheet] = X.buildSheets(result, { view: 'wide' });
  assert.deepEqual(sheet.columns.map((c) => c.label), ['Elem.', 'Riga', 'Col.', 'LED X', 'LED Y', 'Scritta X', 'Scritta Y']);
  assert.deepEqual(sheet.rows[5].values, [6, 6, 1, 15, 380, 80, 380]);
  assert.deepEqual(sheet.rows[5].keys, ['0:6:0', '0:6:1']);
});

test('TSV per Excel', () => {
  const tsv = X.sheetsToTSV(X.buildSheets(result, { view: 'long' }));
  const lines = tsv.split('\n');
  assert.equal(lines[0], 'Elem.\tRiga\tCol.\tBlocco\tX\tY\tLarg.\tAlt.');
  assert.equal(lines[1], '1\t1\t1\tLED\t15\t30\t50\t50');
  assert.equal(lines.length, 13);
});

test('CSV con separatore ";" e testo protetto', () => {
  const cfg = L.defaultConfig();
  cfg.groups[0].blocks[0].name = 'Pompa; "A"';
  cfg.groups[0].blocks[1].name = '=SOMMA(A1)';
  const sheets = X.buildSheets(L.computeLayout(L.normalizeConfig(cfg)), { view: 'long' });
  const lines = X.sheetsToCSV(sheets, { sep: ';' }).split('\r\n');
  assert.equal(lines[1], '1;1;1;"Pompa; ""A""";15;30;50;50');
  assert.equal(lines[2], '1;1;1;\'=SOMMA(A1);80;30;300;50');
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

test('identificatori IEC validi e unici', () => {
  assert.equal(X.identifier('Velocità motore', 'x'), 'Velocita_motore');
  assert.equal(X.identifier('__a--b__', 'x'), 'a_b');
  assert.equal(X.identifier('***', 'Blocco1'), 'Blocco1');
  const cfg = L.defaultConfig();
  cfg.groups[0].blocks[1].name = 'led';
  const st = X.toST(L.computeLayout(L.normalizeConfig(cfg)), {});
  assert.match(st.gvl, /aLED : ARRAY/);
  assert.match(st.gvl, /aled_2 : ARRAY/);
});

test('i commenti ST non possono essere chiusi dai nomi', () => {
  const cfg = L.defaultConfig();
  cfg.groups[0].name = 'Gruppo *) END_VAR (*';
  const st = X.toST(L.computeLayout(L.normalizeConfig(cfg)), {});
  for (const line of st.gvl.split('\n')) {
    const opens = (line.match(/\(\*/g) || []).length;
    const closes = (line.match(/\*\)/g) || []).length;
    assert.ok(opens <= 1 && opens === closes, line);
  }
  assert.match(st.gvl, /\n\t\(\* Gruppo\s+END_VAR\s*: 6 elementi/);
});

test('JSON e testo', () => {
  const data = JSON.parse(X.toJSON(result));
  assert.equal(data.groups[0].elements.length, 6);
  assert.deepEqual(data.groups[0].elements[0].blocks[1], { name: 'Scritta', x: 80, y: 30, width: 300, height: 50 });
  const txt = X.toText(result);
  assert.match(txt, /Elemento 1 \(riga 1, col\. 1\)/);
  assert.match(txt, /LED\s+X\s+15\s+Y\s+30/);
});
