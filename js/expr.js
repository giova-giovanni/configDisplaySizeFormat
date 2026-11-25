/*
 * expr.js — Valutatore sicuro di piccole formule numeriche, come nelle celle di Excel.
 *
 * Accetta numeri (decimali con "." o ","), + - * / ( ) e il segno unario.
 * Il "=" iniziale è facoltativo: "=800-30-50" equivale a "800-30-50".
 * Non usa eval(): il testo viene analizzato da un piccolo parser a discesa ricorsiva.
 * Restituisce NaN se il testo non è una formula valida.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.DLC = root.DLC || {}).expr = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_LENGTH = 200;
  var MAX_DEPTH = 40;

  function evaluate(input) {
    var src = String(input == null ? '' : input).replace(/\s+/g, '');
    if (src.charAt(0) === '=') src = src.slice(1);
    if (!src || src.length > MAX_LENGTH) return NaN;
    src = src.replace(/,/g, '.');
    var pos = 0;

    function number() {
      var m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(pos));
      if (!m) throw new Error('numero atteso');
      pos += m[0].length;
      return parseFloat(m[0]);
    }

    function factor(depth) {
      if (depth > MAX_DEPTH) throw new Error('formula troppo annidata');
      var ch = src.charAt(pos);
      if (ch === '+' || ch === '-') {
        pos++;
        var v = factor(depth + 1);
        return ch === '-' ? -v : v;
      }
      if (ch === '(') {
        pos++;
        var inner = sum(depth + 1);
        if (src.charAt(pos) !== ')') throw new Error('parentesi non chiusa');
        pos++;
        return inner;
      }
      return number();
    }

    function product(depth) {
      var v = factor(depth);
      for (;;) {
        var ch = src.charAt(pos);
        if (ch !== '*' && ch !== '/') return v;
        pos++;
        var r = factor(depth);
        v = ch === '*' ? v * r : v / r;
      }
    }

    function sum(depth) {
      var v = product(depth);
      for (;;) {
        var ch = src.charAt(pos);
        if (ch !== '+' && ch !== '-') return v;
        pos++;
        var r = product(depth);
        v = ch === '+' ? v + r : v - r;
      }
    }

    try {
      var result = sum(0);
      return pos === src.length && isFinite(result) ? result : NaN;
    } catch (e) {
      return NaN;
    }
  }

  return { evaluate: evaluate };
}));
