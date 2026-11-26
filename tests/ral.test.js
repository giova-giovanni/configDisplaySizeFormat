'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/ral.js');

test('tabella RAL Classic completa e valida', () => {
  const all = R.all();
  assert.equal(all.length, 213);
  assert.equal(new Set(all.map((e) => e.code)).size, 213, 'nessun codice duplicato');
  for (const e of all) {
    assert.match(e.code, /^[1-9]\d{3}$/);
    assert.match(e.color, /^#[0-9a-f]{6}$/);
    assert.ok(e.name.length > 2);
  }
  const fam = R.families();
  assert.equal(fam.length, 9);
  assert.equal(fam.reduce((n, f) => n + f.items.length, 0), 213);
  assert.ok(R.common().every(Boolean));
});

test('codici esadecimali come nei dati dei display (CC0605)', () => {
  assert.deepEqual(R.parse('CC0605'), { color: '#cc0605', ral: '' });
  assert.deepEqual(R.parse('#cc0605'), { color: '#cc0605', ral: '' });
  assert.deepEqual(R.parse('#c06'), { color: '#cc0066', ral: '' });
  assert.equal(R.fromHex('#CC0605'), '3020');
  assert.equal(R.format('#cc0605', ''), 'CC0605');
  assert.match(R.describe('#cc0605', ''), /RAL 3020 Rosso traffico/);
});

test('codici RAL in vari formati', () => {
  for (const s of ['RAL 3020', 'ral3020', '3020', ' RAL-3020 ', 'RAL.3020']) {
    assert.deepEqual(R.parse(s), { color: '#cc0605', ral: '3020' }, s);
  }
  assert.deepEqual(R.parse('RAL 9010'), { color: '#ffffff', ral: '9010' });
  assert.equal(R.lookup('7035').name, 'Grigio luce');
  assert.equal(R.format('#cc0605', '3020'), 'RAL 3020');
  assert.equal(R.describe('#cc0605', '3020'), 'RAL 3020 Rosso traffico · #CC0605');
});

test('codici non validi', () => {
  for (const s of ['', 'RAL 9999', 'RAL 302', 'xyz', '#12345', '#1234567', 'rosso']) {
    assert.equal(R.parse(s), null, s);
  }
});
