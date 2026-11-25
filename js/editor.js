/*
 * editor.js — Celle di input in stile Excel e tabella dei blocchi.
 *
 * Celle numeriche: accettano formule (=800-30-50), Invio/frecce per
 * spostarsi, Esc per annullare la modifica, selezione del contenuto al clic.
 * Tabella blocchi: si possono incollare righe copiate da Excel
 * (Nome, Larghezza, Altezza, Distanza, Allineamento, Colore).
 */
(function () {
  'use strict';

  var DLC = window.DLC = window.DLC || {};

  function clamp(v, range) { return Math.min(range[1], Math.max(range[0], v)); }

  function focusCell(el) {
    if (!el) return false;
    el.focus();
    if (el.select) el.select();
    return true;
  }

  /* Spostamento tra le celle di un contenitore [data-nav] (ordine del DOM). */
  function moveFocus(el, delta) {
    var scope = el.closest('[data-nav]');
    if (!scope) return false;
    var list = Array.prototype.filter.call(scope.querySelectorAll('input.cell, select.cell'), function (x) {
      return !x.disabled && x.offsetParent !== null;
    });
    var i = list.indexOf(el);
    return i >= 0 ? focusCell(list[i + delta]) : false;
  }

  /* Seleziona tutto il contenuto al primo clic (come una cella di Excel). */
  function selectOnFocus(el) {
    var fresh = false;
    el.addEventListener('focus', function () { fresh = true; el.select(); });
    el.addEventListener('mouseup', function (e) { if (fresh) { e.preventDefault(); fresh = false; } });
    el.addEventListener('blur', function () { fresh = false; });
  }

  /* o = { get(), set(v), range, commit(), nav(el, dir) } */
  function bindNumber(el, o) {
    var original = null;
    el.setAttribute('inputmode', 'decimal');
    el.setAttribute('autocomplete', 'off');
    el.spellcheck = false;
    if (!el.title) el.title = 'Puoi scrivere anche una formula, es. =800-30-50';
    selectOnFocus(el);
    el.addEventListener('focus', function () { original = o.get(); });
    el.addEventListener('input', function () {
      var v = DLC.expr.evaluate(el.value);
      if (isFinite(v)) {
        el.classList.remove('invalid');
        o.set(clamp(Math.round(v), o.range));
      } else {
        el.classList.toggle('invalid', el.value.trim() !== '');
      }
    });
    el.addEventListener('blur', finish);
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (original !== null && original !== o.get()) o.set(original);
        el.value = o.get();
        el.classList.remove('invalid');
        el.select();
        return;
      }
      var dir = 0;
      if (e.key === 'Enter') dir = e.shiftKey ? -1 : 1;
      else if (e.key === 'ArrowDown') dir = 1;
      else if (e.key === 'ArrowUp') dir = -1;
      if (!dir) return;
      e.preventDefault();
      finish();
      var moved = o.nav ? o.nav(el, dir) : moveFocus(el, dir);
      if (!moved) el.select();
    });
    function finish() {
      el.classList.remove('invalid');
      el.value = o.get();
      original = o.get();
      o.commit();
    }
  }

  /* o = { get(), set(v), fallback(), maxLength, commit(), nav(el, dir) } */
  function bindText(el, o) {
    var original = null;
    el.setAttribute('autocomplete', 'off');
    el.spellcheck = false;
    if (o.maxLength) el.maxLength = o.maxLength;
    el.addEventListener('focus', function () { original = o.get(); });
    el.addEventListener('input', function () { o.set(el.value.replace(/[\u0000-\u001f\u007f]+/g, ' ')); });
    el.addEventListener('blur', finish);
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (original !== null) o.set(original);
        el.value = o.get();
        el.select();
        return;
      }
      var dir = 0;
      if (e.key === 'Enter') dir = e.shiftKey ? -1 : 1;
      else if (o.nav && e.key === 'ArrowDown') dir = 1;
      else if (o.nav && e.key === 'ArrowUp') dir = -1;
      if (!dir) return;
      e.preventDefault();
      finish();
      var moved = o.nav ? o.nav(el, dir) : moveFocus(el, dir);
      if (!moved) el.blur();
    });
    function finish() {
      var v = el.value.trim();
      o.set(v || o.fallback());
      el.value = o.get();
      original = o.get();
      o.commit();
    }
  }

  /* o = { get(), set(v), commit(), nav(el, dir) } */
  function bindSelect(el, o) {
    el.addEventListener('change', function () { o.set(el.value); o.commit(); });
    el.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (o.nav) o.nav(el, e.shiftKey ? -1 : 1); else moveFocus(el, e.shiftKey ? -1 : 1);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Tabella dei blocchi                                                */
  /* ------------------------------------------------------------------ */

  var FIELDS = ['name', 'width', 'height', 'gap', 'align', 'color'];

  var ALIGN_WORDS = {
    start: ['start', 'alto', 'top', 'sopra', 'inizio', 'sinistra', 'left', 'sx'],
    center: ['center', 'centre', 'centro', 'centrato', 'middle', 'medio', 'mezzo'],
    end: ['end', 'basso', 'bottom', 'sotto', 'fine', 'destra', 'right', 'dx']
  };

  function parseAlign(text) {
    var t = String(text || '').trim().toLowerCase();
    for (var k in ALIGN_WORDS) {
      if (ALIGN_WORDS.hasOwnProperty(k) && ALIGN_WORDS[k].indexOf(t) !== -1) return k;
    }
    return null;
  }

  function textColorOn(hex) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#111827' : '#ffffff';
  }

  /*
   * api = {
   *   group(), config(), limits, onLive(), onStructural(), commit(), toast(msg)
   * }
   */
  function BlockTable(host, api) {
    this.host = host;
    this.api = api;
    var self = this;
    host.addEventListener('paste', function (e) { self._paste(e); });
  }

  BlockTable.prototype.render = function () {
    var g = this.api.group(), horiz = g.direction !== 'v', self = this;
    var table = document.createElement('table');
    table.className = 'xl-table blk-table';
    var head = [
      ['c-idx', '#', 'Colore e numero del blocco (clic sul colore per cambiarlo)'],
      ['c-name', 'Nome', 'Nome del blocco, es. LED, Scritta, Pulsante'],
      ['c-num', 'Larg.', 'Larghezza del blocco in pixel'],
      ['c-num', 'Alt.', 'Altezza del blocco in pixel'],
      ['c-num', horiz ? 'Dist. ←' : 'Dist. ↑', horiz
        ? 'Distanza a sinistra del blocco (px): dal blocco precedente; per il primo blocco, dal bordo sinistro dell\'elemento'
        : 'Distanza sopra il blocco (px): dal blocco precedente; per il primo blocco, dal bordo superiore dell\'elemento'],
      ['c-align', 'Allin.', horiz
        ? 'Allineamento verticale del blocco nella riga (conta se i blocchi hanno altezze diverse)'
        : 'Allineamento orizzontale del blocco nella colonna (conta se i blocchi hanno larghezze diverse)'],
      ['c-act', '', '']
    ];
    var colgroup = document.createElement('colgroup');
    var thead = document.createElement('thead');
    var htr = document.createElement('tr');
    head.forEach(function (h) {
      var col = document.createElement('col');
      col.className = h[0];
      colgroup.appendChild(col);
      var th = document.createElement('th');
      th.textContent = h[1];
      if (h[2]) th.title = h[2];
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(colgroup);
    table.appendChild(thead);
    var tbody = document.createElement('tbody');
    g.blocks.forEach(function (b, i) { tbody.appendChild(self._row(b, i, horiz, g.blocks.length)); });
    table.appendChild(tbody);
    this.host.textContent = '';
    this.host.appendChild(table);
  };

  BlockTable.prototype._nav = function (el, dir) {
    var row = +el.getAttribute('data-row') + dir;
    var f = el.getAttribute('data-field');
    return focusCell(this.host.querySelector('[data-row="' + row + '"][data-field="' + f + '"]'));
  };

  BlockTable.prototype._block = function (i) { return this.api.group().blocks[i]; };

  BlockTable.prototype._row = function (b, i, horiz, n) {
    var self = this, api = this.api, lim = api.limits;
    var tr = document.createElement('tr');

    // Numero + colore
    var td0 = document.createElement('td');
    td0.className = 'blk-idx';
    var sw = document.createElement('label');
    sw.className = 'swatch';
    sw.style.background = b.color;
    sw.style.color = textColorOn(b.color);
    sw.title = 'Colore del blocco ' + (i + 1) + ' (clic per cambiarlo)';
    var color = document.createElement('input');
    color.type = 'color';
    color.value = b.color;
    color.tabIndex = -1;
    color.setAttribute('aria-label', 'Colore del blocco ' + (i + 1));
    color.addEventListener('input', function () {
      var v = DLC.layout.cleanColor(color.value, null);
      if (!v) return;
      self._block(i).color = v;
      sw.style.background = v;
      sw.style.color = textColorOn(v);
      api.onLive();
    });
    color.addEventListener('change', function () { api.commit(); });
    var num = document.createElement('span');
    num.textContent = i + 1;
    sw.appendChild(color);
    sw.appendChild(num);
    td0.appendChild(sw);
    tr.appendChild(td0);

    // Nome
    var tdName = document.createElement('td');
    var name = document.createElement('input');
    name.className = 'cell';
    name.value = b.name;
    name.setAttribute('data-row', i);
    name.setAttribute('data-field', 'name');
    name.setAttribute('aria-label', 'Nome del blocco ' + (i + 1));
    bindText(name, {
      get: function () { return self._block(i).name; },
      set: function (v) { self._block(i).name = v.slice(0, lim.nameLength); api.onLive(); },
      fallback: function () { return 'Blocco ' + (i + 1); },
      maxLength: lim.nameLength,
      commit: api.commit,
      nav: function (el, dir) { return self._nav(el, dir); }
    });
    tdName.appendChild(name);
    tr.appendChild(tdName);

    // Larghezza, altezza, distanza
    [['width', lim.blockSize, 'Larghezza'], ['height', lim.blockSize, 'Altezza'], ['gap', lim.gap, 'Distanza']].forEach(function (f) {
      var td = document.createElement('td');
      var input = document.createElement('input');
      input.className = 'cell num';
      input.value = b[f[0]];
      input.setAttribute('data-row', i);
      input.setAttribute('data-field', f[0]);
      input.setAttribute('aria-label', f[2] + ' del blocco ' + (i + 1) + ' in pixel');
      bindNumber(input, {
        get: function () { return self._block(i)[f[0]]; },
        set: function (v) { self._block(i)[f[0]] = v; api.onLive(); },
        range: f[1],
        commit: api.commit,
        nav: function (el, dir) { return self._nav(el, dir); }
      });
      td.appendChild(input);
      tr.appendChild(td);
    });

    // Allineamento
    var tdAl = document.createElement('td');
    var sel = document.createElement('select');
    sel.className = 'cell';
    sel.setAttribute('data-row', i);
    sel.setAttribute('data-field', 'align');
    sel.setAttribute('aria-label', 'Allineamento del blocco ' + (i + 1));
    (horiz ? [['start', 'Alto'], ['center', 'Centro'], ['end', 'Basso']]
      : [['start', 'Sinistra'], ['center', 'Centro'], ['end', 'Destra']]).forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o[0];
      opt.textContent = o[1];
      sel.appendChild(opt);
    });
    sel.value = b.align;
    bindSelect(sel, {
      get: function () { return self._block(i).align; },
      set: function (v) { self._block(i).align = v; api.onLive(); },
      commit: api.commit,
      nav: function (el, dir) { return self._nav(el, dir); }
    });
    tdAl.appendChild(sel);
    tr.appendChild(tdAl);

    // Azioni
    var tdAct = document.createElement('td');
    tdAct.className = 'blk-actions';
    [['up', 'Sposta su', i === 0, function () { self.move(i, -1); }],
      ['down', 'Sposta giù', i === n - 1, function () { self.move(i, 1); }],
      ['trash', 'Elimina blocco', n <= 1, function () { self.remove(i); }]].forEach(function (a) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icon-btn mini' + (a[0] === 'trash' ? ' danger' : '');
      btn.tabIndex = -1;
      btn.title = a[1];
      btn.setAttribute('aria-label', a[1] + ' ' + (i + 1));
      btn.innerHTML = DLC.icons.get(a[0]);
      btn.disabled = a[2];
      btn.addEventListener('click', a[3]);
      tdAct.appendChild(btn);
    });
    tr.appendChild(tdAct);
    return tr;
  };

  BlockTable.prototype.add = function () {
    var g = this.api.group(), lim = this.api.limits;
    if (g.blocks.length >= lim.maxBlocks) {
      this.api.toast('Massimo ' + lim.maxBlocks + ' blocchi per elemento.');
      return;
    }
    g.blocks.push(DLC.layout.newBlock(g, this.api.config()));
    this.api.onStructural();
    this.api.commit();
    focusCell(this.host.querySelector('[data-row="' + (g.blocks.length - 1) + '"][data-field="name"]'));
  };

  BlockTable.prototype.move = function (i, dir) {
    var blocks = this.api.group().blocks, j = i + dir;
    if (j < 0 || j >= blocks.length) return;
    var t = blocks[i];
    blocks[i] = blocks[j];
    blocks[j] = t;
    this.api.onStructural();
    this.api.commit();
  };

  BlockTable.prototype.remove = function (i) {
    var blocks = this.api.group().blocks;
    if (blocks.length <= 1) return;
    var removed = blocks.splice(i, 1)[0];
    this.api.onStructural();
    this.api.commit();
    this.api.toast('Blocco «' + removed.name + '» eliminato', true);
  };

  /* Incolla un intervallo di celle copiato da Excel. */
  BlockTable.prototype._paste = function (e) {
    var target = e.target;
    if (!target || !target.getAttribute || !target.hasAttribute('data-field')) return;
    var text = (e.clipboardData || window.clipboardData).getData('text') || '';
    text = text.replace(/\r/g, '');
    if (!/[\t\n]/.test(text.replace(/\n+$/, ''))) return; // valore singolo: incolla normale
    e.preventDefault();
    var lines = text.split('\n');
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    var grid = lines.map(function (l) { return l.split('\t'); });
    var start = FIELDS.indexOf(target.getAttribute('data-field'));
    var startRow = +target.getAttribute('data-row');
    var E = DLC.expr, L = DLC.layout, lim = this.api.limits;

    // Riga di intestazione (es. "Nome  Larghezza  Altezza") → ignorata
    if (grid.length > 1) {
      var numericFields = 0, numericOk = 0;
      grid[0].forEach(function (v, ci) {
        var f = FIELDS[start + ci];
        if (f === 'width' || f === 'height' || f === 'gap') {
          numericFields++;
          if (isFinite(E.evaluate(v))) numericOk++;
        }
      });
      if (numericFields > 0 && numericOk === 0) grid.shift();
    }

    var g = this.api.group(), cfg = this.api.config(), rowsDone = 0;
    for (var ri = 0; ri < grid.length; ri++) {
      var row = startRow + ri;
      if (row >= lim.maxBlocks) break;
      while (g.blocks.length <= row) g.blocks.push(L.newBlock(g, cfg));
      var b = g.blocks[row];
      grid[ri].forEach(function (val, ci) {
        var f = FIELDS[start + ci];
        if (!f) return;
        if (f === 'name') b.name = L.cleanName(val, b.name);
        else if (f === 'align') { var a = parseAlign(val); if (a) b.align = a; }
        else if (f === 'color') b.color = L.cleanColor(val, b.color);
        else {
          var v = E.evaluate(val);
          if (isFinite(v)) b[f] = clamp(Math.round(v), f === 'gap' ? lim.gap : lim.blockSize);
        }
      });
      rowsDone++;
    }
    this.api.onStructural();
    this.api.commit();
    this.api.toast('Incollate ' + rowsDone + (rowsDone === 1 ? ' riga' : ' righe') + ' nella tabella dei blocchi');
  };

  DLC.editor = {
    bindNumber: bindNumber,
    bindText: bindText,
    bindSelect: bindSelect,
    moveFocus: moveFocus,
    BlockTable: BlockTable
  };
}());
