/*
 * sheet.js — Tabella delle coordinate in stile foglio Excel.
 *
 *  - lettere di colonna (A, B, C…) e numeri di riga, riga 1 = intestazioni;
 *  - clic = seleziona (e, se attivo, copia) la cella; trascinamento o
 *    Maiusc+clic = intervallo; clic su lettere/numeri = colonne/righe intere;
 *  - tastiera: frecce, Maiusc+frecce, Ctrl+C, Ctrl+A, Esc, doppio clic = copia;
 *  - la copia produce testo separato da tabulazioni: si incolla in Excel.
 */
(function () {
  'use strict';

  var DLC = window.DLC = window.DLC || {};

  function colName(i) {
    var s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
    return s;
  }

  function cellText(v) {
    return DLC.exporters ? DLC.exporters.cellText(v) : String(v);
  }

  function Sheet(opts) {
    this.opts = opts || {};
    this.root = document.createElement('div');
    this.root.className = 'sheet-block';
    this.titleEl = document.createElement('div');
    this.titleEl.className = 'sheet-title';
    this.el = document.createElement('div');
    this.el.className = 'sheet';
    this.el.tabIndex = 0;
    this.el.setAttribute('aria-label', 'Tabella delle coordinate: usa le frecce per muoverti, Ctrl+C per copiare');
    this.root.appendChild(this.titleEl);
    this.root.appendChild(this.el);
    this.data = null;
    this.sel = null;          // { ar, ac, fr, fc } ancora + estremo (r = 0 riga intestazioni)
    this.cells = [];
    this.rowHeads = [];
    this.colHeads = [];
    this.trs = [];
    this.keyRow = {};
    this.painted = [];
    this.hoverTr = null;
    this.dragging = null;
    this._bind();
  }

  Sheet.prototype.setData = function (data) {
    this.data = data;
    this.titleEl.textContent = data.title || '';
    this.titleEl.hidden = !data.title;
    var nR = data.rows.length + 1, nC = data.columns.length;
    if (this.sel && (Math.max(this.sel.ar, this.sel.fr) >= nR || Math.max(this.sel.ac, this.sel.fc) >= nC)) {
      this.sel = null;
    }
    this._render();
    this._paint();
    if (this.sel) this._emit(false);
  };

  Sheet.prototype._render = function () {
    var d = this.data;
    var table = document.createElement('table');
    table.className = 'grid';

    var thead = document.createElement('thead');
    var htr = document.createElement('tr');
    var corner = document.createElement('th');
    corner.className = 'corner';
    corner.setAttribute('data-k', 'all');
    corner.title = 'Seleziona tutto (Ctrl+A)';
    htr.appendChild(corner);
    this.colHeads = d.columns.map(function (col, c) {
      var th = document.createElement('th');
      th.className = 'colhead';
      th.setAttribute('data-k', 'col');
      th.setAttribute('data-c', c);
      th.textContent = colName(c);
      th.title = 'Seleziona la colonna «' + col.label + '»';
      htr.appendChild(th);
      return th;
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    this.cells = [];
    this.rowHeads = [];
    this.trs = [];
    this.keyRow = {};
    for (var r = 0; r <= d.rows.length; r++) {
      var tr = document.createElement('tr');
      var rh = document.createElement('th');
      rh.className = 'rowhead';
      rh.setAttribute('data-k', 'row');
      rh.setAttribute('data-r', r);
      rh.textContent = r + 1;
      tr.appendChild(rh);
      this.rowHeads.push(rh);
      var rowCells = [];
      for (var c = 0; c < d.columns.length; c++) {
        var col = d.columns[c];
        var td = document.createElement('td');
        td.setAttribute('data-r', r);
        td.setAttribute('data-c', c);
        if (r === 0) {
          td.textContent = col.label;
          if (col.title) td.title = col.title;
        } else {
          td.textContent = String(d.rows[r - 1].values[c]);
          if (col.num) td.className = col.coord ? 'num coord' : 'num';
        }
        tr.appendChild(td);
        rowCells.push(td);
      }
      if (r === 0) tr.className = 'hdr-row';
      else {
        if (d.rows[r - 1].warn) tr.className = 'warn';
        var keys = d.rows[r - 1].keys;
        for (var k = 0; k < keys.length; k++) this.keyRow[keys[k]] = r;
      }
      tbody.appendChild(tr);
      this.cells.push(rowCells);
      this.trs.push(tr);
    }
    table.appendChild(tbody);

    this.el.textContent = '';
    this.el.appendChild(table);
    if (!d.rows.length) {
      var empty = document.createElement('div');
      empty.className = 'sheet-empty';
      empty.textContent = 'Nessun blocco da mostrare: imposta almeno un elemento.';
      this.el.appendChild(empty);
    }
    this.painted = [];
    this.hoverTr = null;
  };

  Sheet.prototype._range = function () {
    var s = this.sel;
    if (!s) return null;
    return {
      r1: Math.min(s.ar, s.fr), r2: Math.max(s.ar, s.fr),
      c1: Math.min(s.ac, s.fc), c2: Math.max(s.ac, s.fc)
    };
  };

  Sheet.prototype._paint = function () {
    for (var i = 0; i < this.painted.length; i++) this.painted[i].classList.remove('sel', 'active', 'hl');
    this.painted = [];
    var g = this._range();
    if (!g) return;
    for (var r = g.r1; r <= g.r2; r++) {
      var row = this.cells[r];
      if (!row) continue;
      for (var c = g.c1; c <= g.c2; c++) {
        if (row[c]) { row[c].classList.add('sel'); this.painted.push(row[c]); }
      }
      this.rowHeads[r].classList.add('hl');
      this.painted.push(this.rowHeads[r]);
    }
    for (var cc = g.c1; cc <= g.c2; cc++) {
      if (this.colHeads[cc]) { this.colHeads[cc].classList.add('hl'); this.painted.push(this.colHeads[cc]); }
    }
    var a = this.cells[this.sel.ar] && this.cells[this.sel.ar][this.sel.ac];
    if (a) { a.classList.add('active'); this.painted.push(a); }
  };

  Sheet.prototype._value = function (r, c) {
    var d = this.data;
    return r === 0 ? d.columns[c].label : d.rows[r - 1].values[c];
  };

  /* Blocchi (chiavi) coinvolti da un intervallo di celle. */
  Sheet.prototype._keys = function (r1, r2, c1, c2) {
    var d = this.data, seen = {}, out = [];
    function add(k) { if (k && !seen[k]) { seen[k] = 1; out.push(k); } }
    for (var r = Math.max(1, r1); r <= r2; r++) {
      var row = d.rows[r - 1];
      if (!row) continue;
      for (var c = c1; c <= c2; c++) {
        var bi = d.columns[c] ? d.columns[c].blockIdx : null;
        if (bi != null) add(row.keys[bi]);
        else row.keys.forEach(add);
      }
    }
    return out;
  };

  Sheet.prototype._emit = function (final) {
    var g = this._range();
    if (!g) { if (this.opts.onSelect) this.opts.onSelect(null, this); return; }
    var ref = colName(this.sel.ac) + (this.sel.ar + 1);
    if (g.r1 !== g.r2 || g.c1 !== g.c2) ref = colName(g.c1) + (g.r1 + 1) + ':' + colName(g.c2) + (g.r2 + 1);
    var count = 0, nums = 0, sum = 0;
    for (var r = g.r1; r <= g.r2; r++) {
      for (var c = g.c1; c <= g.c2; c++) {
        count++;
        var v = this._value(r, c);
        if (r > 0 && typeof v === 'number') { nums++; sum += v; }
      }
    }
    var info = {
      ref: ref,
      value: String(this._value(this.sel.ar, this.sel.ac)),
      count: count,
      numbers: nums,
      sum: sum,
      rows: g.r2 - g.r1 + 1,
      cols: g.c2 - g.c1 + 1,
      keys: this._keys(g.r1, g.r2, g.c1, g.c2)
    };
    if (this.opts.onSelect) this.opts.onSelect(info, this);
    if (final && this.opts.autoCopy && this.opts.autoCopy()) this.copy('click');
  };

  Sheet.prototype._hit = function (t) {
    var k = t.getAttribute('data-k');
    if (k === 'all') return { kind: 'all' };
    if (k === 'col') return { kind: 'col', c: +t.getAttribute('data-c') };
    if (k === 'row') return { kind: 'row', r: +t.getAttribute('data-r') };
    if (t.hasAttribute('data-r')) return { kind: 'cell', r: +t.getAttribute('data-r'), c: +t.getAttribute('data-c') };
    return null;
  };

  Sheet.prototype._start = function (h, shift) {
    var nR = this.data.rows.length + 1, nC = this.data.columns.length, s = this.sel;
    if (!nC) return;
    this.dragging = h.kind;
    if (h.kind === 'all') {
      this.sel = { ar: 0, ac: 0, fr: nR - 1, fc: nC - 1 };
    } else if (h.kind === 'col') {
      this.sel = { ar: 0, ac: shift && s ? s.ac : h.c, fr: nR - 1, fc: h.c };
    } else if (h.kind === 'row') {
      this.sel = { ar: shift && s ? s.ar : h.r, ac: 0, fr: h.r, fc: nC - 1 };
    } else if (shift && s) {
      this.sel = { ar: s.ar, ac: s.ac, fr: h.r, fc: h.c };
    } else {
      this.sel = { ar: h.r, ac: h.c, fr: h.r, fc: h.c };
    }
    this._paint();
    this._emit(false);
  };

  Sheet.prototype._dragTo = function (h) {
    var s = this.sel, nR = this.data.rows.length + 1, nC = this.data.columns.length, next;
    if (!s) return;
    if (this.dragging === 'col' && h.c != null) next = { ar: 0, ac: s.ac, fr: nR - 1, fc: h.c };
    else if (this.dragging === 'row' && h.r != null) next = { ar: s.ar, ac: 0, fr: h.r, fc: nC - 1 };
    else if (this.dragging === 'cell' && h.kind === 'cell') next = { ar: s.ar, ac: s.ac, fr: h.r, fc: h.c };
    else return;
    if (next.fr === s.fr && next.fc === s.fc) return;
    this.sel = next;
    this._paint();
    this._emit(false);
  };

  Sheet.prototype._bind = function () {
    var self = this;

    this.el.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || !self.data) return;
      var t = e.target.closest ? e.target.closest('td, th') : null;
      if (!t || !self.el.contains(t)) return;
      var h = self._hit(t);
      if (!h) return;
      e.preventDefault();
      try { self.el.focus({ preventScroll: true }); } catch (err) { self.el.focus(); }
      self._start(h, e.shiftKey);
      var move = function (ev) {
        var el = document.elementFromPoint(ev.clientX, ev.clientY);
        var cell = el && el.closest ? el.closest('td, th') : null;
        if (cell && self.el.contains(cell)) {
          var hh = self._hit(cell);
          if (hh) self._dragTo(hh);
        }
      };
      var up = function () {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        if (!self.dragging) return;
        self.dragging = null;
        self._emit(true);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });

    this.el.addEventListener('dblclick', function (e) {
      var t = e.target.closest ? e.target.closest('td') : null;
      if (!t || !self.sel) return;
      if (!(self.opts.autoCopy && self.opts.autoCopy())) self.copy('dblclick');
    });

    this.el.addEventListener('mouseover', function (e) {
      if (self.dragging) return;
      var t = e.target.closest ? e.target.closest('td') : null;
      if (!t || !self.el.contains(t)) return;
      var r = +t.getAttribute('data-r'), c = +t.getAttribute('data-c');
      self._hoverRow(r >= 1 ? r : null);
      if (self.opts.onHover) self.opts.onHover(r >= 1 ? self._keys(r, r, c, c) : null);
    });

    this.el.addEventListener('mouseleave', function () {
      self._hoverRow(null);
      if (self.opts.onHover) self.opts.onHover(null);
    });

    this.el.addEventListener('keydown', function (e) { self._key(e); });
  };

  Sheet.prototype._key = function (e) {
    if (!this.data || !this.data.columns.length) return;
    var nR = this.data.rows.length + 1, nC = this.data.columns.length;
    var mod = e.ctrlKey || e.metaKey, key = e.key;
    if (mod && (key === 'c' || key === 'C')) {
      if (this.sel) { e.preventDefault(); this.copy('keyboard'); }
      return;
    }
    if (mod && (key === 'a' || key === 'A')) {
      e.preventDefault();
      this.sel = { ar: 0, ac: 0, fr: nR - 1, fc: nC - 1 };
      this._paint();
      this._emit(false);
      return;
    }
    if (key === 'Escape') { if (this.sel) { e.preventDefault(); this.clear(); } return; }
    var dr = 0, dc = 0;
    if (key === 'ArrowUp') dr = -1;
    else if (key === 'ArrowDown') dr = 1;
    else if (key === 'ArrowLeft') dc = -1;
    else if (key === 'ArrowRight') dc = 1;
    else if (key === 'Enter') dr = e.shiftKey ? -1 : 1;
    else if (key === 'Home') dc = -nC;
    else if (key === 'End') dc = nC;
    else if (key === 'PageDown') dr = 15;
    else if (key === 'PageUp') dr = -15;
    else return;
    e.preventDefault();
    var clampR = function (v) { return Math.max(0, Math.min(nR - 1, v)); };
    var clampC = function (v) { return Math.max(0, Math.min(nC - 1, v)); };
    if (!this.sel) {
      this.sel = { ar: Math.min(1, nR - 1), ac: 0, fr: Math.min(1, nR - 1), fc: 0 };
    } else if (e.shiftKey && key.indexOf('Arrow') === 0) {
      this.sel = { ar: this.sel.ar, ac: this.sel.ac, fr: clampR(this.sel.fr + dr), fc: clampC(this.sel.fc + dc) };
    } else {
      var r = clampR(this.sel.ar + dr), c = clampC(this.sel.ac + dc);
      this.sel = { ar: r, ac: c, fr: r, fc: c };
    }
    this._paint();
    this._scrollTo(this.sel.fr, this.sel.fc);
    this._emit(false);
  };

  Sheet.prototype._scrollTo = function (r, c) {
    var cell = this.cells[r] && this.cells[r][c];
    if (!cell) return;
    var box = this.el, top = cell.offsetTop, left = cell.offsetLeft;
    var stickTop = 50, stickLeft = this.rowHeads[0] ? this.rowHeads[0].offsetWidth : 40;
    if (top - stickTop < box.scrollTop) box.scrollTop = Math.max(0, top - stickTop);
    else if (top + cell.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + cell.offsetHeight - box.clientHeight;
    if (left - stickLeft < box.scrollLeft) box.scrollLeft = Math.max(0, left - stickLeft);
    else if (left + cell.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = left + cell.offsetWidth - box.clientWidth;
  };

  Sheet.prototype._hoverRow = function (r) {
    var tr = r != null ? this.trs[r] : null;
    if (tr === this.hoverTr) return;
    if (this.hoverTr) this.hoverTr.classList.remove('hover');
    if (tr) tr.classList.add('hover');
    this.hoverTr = tr;
  };

  /* Evidenzia la riga di un blocco (passaggio del mouse sull'anteprima). */
  Sheet.prototype.hoverKey = function (key) {
    this._hoverRow(key != null && this.keyRow[key] != null ? this.keyRow[key] : null);
  };

  /* Seleziona le coordinate di un blocco (clic sull'anteprima). */
  Sheet.prototype.selectKey = function (key) {
    var r = this.keyRow[key];
    if (r == null) return false;
    var bi = +String(key).split(':')[2];
    var cols = this.data.columns, c1 = -1, c2 = -1;
    for (var c = 0; c < cols.length; c++) {
      var col = cols[c];
      var mine = col.blockIdx == null || col.blockIdx === bi;
      if (!mine) continue;
      if (col.field === 'x' && c1 < 0) c1 = c;
      if (col.field === 'y' || col.field === 'h') c2 = c;
    }
    if (c1 < 0) { c1 = 0; c2 = cols.length - 1; }
    if (c2 < c1) c2 = c1;
    this.sel = { ar: r, ac: c1, fr: r, fc: c2 };
    this._paint();
    this._scrollTo(r, c1);
    this._emit(false);
    return true;
  };

  Sheet.prototype.clear = function (silent) {
    if (!this.sel) return;
    this.sel = null;
    this._paint();
    if (!silent) this._emit(false);
  };

  Sheet.prototype.copy = function (source) {
    var g = this._range();
    if (!g) return;
    var lines = [];
    for (var r = g.r1; r <= g.r2; r++) {
      var vals = [];
      for (var c = g.c1; c <= g.c2; c++) vals.push(cellText(this._value(r, c)));
      lines.push(vals.join('\t'));
    }
    var text = lines.join('\n');
    var self = this;
    var info = { text: text, cells: (g.r2 - g.r1 + 1) * (g.c2 - g.c1 + 1), rows: g.r2 - g.r1 + 1, cols: g.c2 - g.c1 + 1, source: source };
    DLC.copyText(text).then(function (ok) {
      info.ok = ok;
      if (self.opts.onCopy) self.opts.onCopy(info);
    });
  };

  Sheet.prototype.destroy = function () {
    if (this.root.parentNode) this.root.parentNode.removeChild(this.root);
  };

  DLC.Sheet = Sheet;
  DLC.colName = colName;
}());
