'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate } = require('../js/expr.js');

test('formule valide', () => {
  assert.equal(evaluate('800'), 800);
  assert.equal(evaluate('=800-30-50'), 720);
  assert.equal(evaluate('(800-45)/2'), 377.5);
  assert.equal(evaluate('2*(3+4)'), 14);
  assert.equal(evaluate(' 1 + 2 * 3 '), 7);
  assert.equal(evaluate('-5'), -5);
  assert.equal(evaluate('--5'), 5);
  assert.equal(evaluate('1,5'), 1.5);
  assert.equal(evaluate('.5*4'), 2);
});

test('testo non valido restituisce NaN', () => {
  for (const s of ['', '=', 'abc', '5+', '((1)', '1/0', '1..2', '2**3', 'alert(1)', '1e5', null, undefined]) {
    assert.ok(Number.isNaN(evaluate(s)), String(s));
  }
});

test('formule troppo lunghe o annidate vengono rifiutate', () => {
  assert.ok(Number.isNaN(evaluate('1+'.repeat(150) + '1')));
  assert.ok(Number.isNaN(evaluate('('.repeat(60) + '1' + ')'.repeat(60))));
});
