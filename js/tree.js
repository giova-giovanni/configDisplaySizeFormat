/*
 * tree.js — Elenco dei livelli (struttura della pagina) con trascinamento.
 *
 *  - come il "Riquadro selezione" di PowerPoint: in alto c'è ciò che sta davanti,
 *    in basso lo sfondo; i frame mostrano il loro contenuto rientrato;
 *  - un clic seleziona; la riga "Display" toglie la selezione;
 *  - l'occhio nasconde/mostra un oggetto nell'anteprima;
 *  - si trascina una riga per cambiare livello (sopra/sotto un'altra riga) o per
 *    spostarla dentro un frame (sul corpo della riga del frame, o sul Display);
 *  - tasti: ↑ ↓ cambiano selezione, Alt+↑/↓ portano avanti/indietro, tasto
 *    menu o Maiusc+F10 aprono il menu del livello.
 *
 * api = {
 *   config(), result(), selected(),
 *   meta(node, entry)    testo a destra del nome
 *   issues(id)           problemi che riguardano il nodo
 *   select(id), toggleHidden(id), order(id, how),
 *   move(id, parentId, index), context(id, x, y)
 * }
 */
(function () {
  'use strict';

  var DLC = window.DLC = window.DLC || {};

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function Tree(host, api) {
    this.host = host;
    this.api = api;
    this.dragId = '';
    this.line = null;
    this.rows = [];
    this._bind();
  }

  Tree.prototype.render = function () {
    var api = this.api, L = DLC.layout, cfg = api.config(), res = api.result();
    var host = this.host, selected = api.selected();
    var focusId = null;
    if (document.activeElement && host.contains(document.activeElement)) {
      focusId = document.activeElement.getAttribute('data-id') || (document.activeElement.classList.contains('tree-root') ? '' : null);
    }
    host.textContent = '';
    this.line = null;

    var root = el('div', 'tree-root' + (selected ? '' : ' sel'));
    root.setAttribute('role', 'treeitem');
    root.setAttribute('aria-level', '1');
    root.setAttribute('aria-selected', String(!selected));
    root.tabIndex = selected ? -1 : 0;
    root.innerHTML = DLC.icons.get('display');
    root.appendChild(el('span', 'tree-name', 'Display ' + cfg.display.width + ' × ' + cfg.display.height + ' px'));
    root.appendChild(el('span', 'tree-meta', selected ? 'clic = mostra tutto' : 'nessuna selezione'));
    root.title = 'Il display: un clic toglie la selezione e mostra tutti i livelli con i colori reali. Si può trascinare un oggetto qui per portarlo fuori dai frame, in primo piano.';
    host.appendChild(root);

    var rows = [root];
    L.listNodesFront(cfg).forEach(function (x) {
      var n = x.node, e = res.nodes[n.id], isSel = n.id === selected, isFrame = n.type === 'frame';
      var row = el('div', 'tree-row' + (isSel ? ' sel' : '') + (isFrame ? ' is-frame' : '') + (n.hidden ? ' is-hidden' : ''));
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(x.depth + 2));
      row.setAttribute('aria-selected', String(isSel));
      row.setAttribute('data-id', n.id);
      row.tabIndex = isSel ? 0 : -1;
      row.draggable = true;
      row.style.paddingLeft = (6 + (x.depth + 1) * 16) + 'px';

      var grip = el('span', 'grip');
      grip.innerHTML = DLC.icons.get('grip');
      grip.title = 'Trascina per cambiare livello o per spostare in un frame';
      row.appendChild(grip);
      var kind = el('span', 'kind');
      kind.innerHTML = DLC.icons.get(isFrame ? 'frame' : 'group');
      row.appendChild(kind);
      var dot = el('span', 'dot');
      dot.style.background = isFrame ? n.color : n.blocks[0].color;
      if (isFrame && e && e.items[0] && e.items[0].transparent) dot.classList.add('clear');
      row.appendChild(dot);
      row.appendChild(el('span', 'tree-name', n.name));
      row.appendChild(el('span', 'tree-meta', api.meta(n, e)));

      var issues = api.issues(n.id);
      if (issues.length) {
        var worst = issues.some(function (i) { return i.severity === 'error'; }) ? 'err' : issues.some(function (i) { return i.severity === 'warn'; }) ? 'warn' : 'info';
        var w = el('span', 'tree-warn ' + worst);
        w.innerHTML = DLC.icons.get(worst === 'info' ? 'info' : 'warn');
        w.title = issues.map(function (i) { return i.title; }).join('\n');
        row.appendChild(w);
      }
      var eye = el('button', 'tree-eye');
      eye.type = 'button';
      eye.tabIndex = -1;
      eye.innerHTML = DLC.icons.get(n.hidden ? 'eyeOff' : 'eye');
      eye.title = n.hidden ? 'Nascosto nell\'anteprima e nelle immagini: clic per mostrarlo' : 'Visibile: clic per nasconderlo nell\'anteprima e nelle immagini';
      eye.setAttribute('aria-label', (n.hidden ? 'Mostra ' : 'Nascondi ') + n.name);
      row.appendChild(eye);
      row.title = isFrame ? 'Frame: contenitore di altri gruppi e frame' : 'Gruppo di elementi';
      host.appendChild(row);
      rows.push(row);
    });

    var end = el('div', 'tree-end');
    end.title = 'Rilascia qui per portare l\'oggetto sullo sfondo, fuori dai frame';
    host.appendChild(end);
    this.rows = rows;

    if (focusId !== null) {
      var again = host.querySelector(focusId === '' ? '.tree-root' : '.tree-row[data-id="' + focusId + '"]');
      if (again) again.focus();
    }
  };

  Tree.prototype._rowOf = function (target) {
    return target && target.closest ? target.closest('.tree-row[data-id], .tree-root') : null;
  };

  Tree.prototype._idOf = function (row) {
    return row.classList.contains('tree-root') ? '' : row.getAttribute('data-id');
  };

  Tree.prototype._bind = function () {
    var self = this, host = this.host, api = this.api;

    host.addEventListener('click', function (e) {
      var eye = e.target.closest ? e.target.closest('.tree-eye') : null;
      var row = self._rowOf(e.target);
      if (eye && row) { e.stopPropagation(); api.toggleHidden(self._idOf(row)); return; }
      if (row) api.select(self._idOf(row));
    });

    host.addEventListener('contextmenu', function (e) {
      var row = self._rowOf(e.target);
      if (!row || row.classList.contains('tree-root')) return;
      e.preventDefault();
      api.select(self._idOf(row));
      api.context(self._idOf(row), e.clientX, e.clientY);
    });

    host.addEventListener('keydown', function (e) {
      var row = self._rowOf(e.target);
      if (!row || e.target.classList.contains('tree-eye')) return;
      var id = self._idOf(row), i = self.rows.indexOf(row);
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        api.select(id);
      } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.altKey && id) {
        e.preventDefault();
        api.order(id, e.key === 'ArrowUp' ? 'forward' : 'backward');
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var next = self.rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
        if (next) { next.focus(); api.select(self._idOf(next)); }
      } else if ((e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) && id) {
        e.preventDefault();
        var r = row.getBoundingClientRect();
        api.context(id, r.left + 40, r.bottom);
      }
    });

    host.addEventListener('dragstart', function (e) {
      var row = e.target.closest ? e.target.closest('.tree-row[data-id]') : null;
      if (!row) return;
      self.dragId = row.getAttribute('data-id');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', self.dragId); } catch (x) { /* alcuni browser */ }
      row.classList.add('dragging');
      host.classList.add('dnd');
    });
    host.addEventListener('dragend', function () { self._endDrag(); });
    host.addEventListener('dragover', function (e) {
      if (!self.dragId) return;
      var drop = self._dropAt(e);
      if (!drop || drop.reason || drop.same) {
        self._indicate(null, drop);
        e.dataTransfer.dropEffect = 'none';
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      self._indicate(drop);
    });
    host.addEventListener('dragleave', function (e) {
      if (!e.relatedTarget || !host.contains(e.relatedTarget)) self._indicate(null);
    });
    host.addEventListener('drop', function (e) {
      if (!self.dragId) return;
      e.preventDefault();
      var drop = self._dropAt(e), id = self.dragId;
      self._endDrag();
      if (drop && !drop.reason && !drop.same) api.move(id, drop.parent, drop.index);
    });
  };

  /*
   * Dove finirebbe l'oggetto trascinato, in base al punto sulla riga sotto il mouse:
   *   parte alta  → davanti alla riga      parte bassa → dietro la riga
   *   centro di un frame → dentro il frame (in primo piano)
   * Restituisce { parent, index, mode, row } oppure { reason } se non è consentito.
   */
  Tree.prototype._dropAt = function (e) {
    var L = DLC.layout, cfg = this.api.config(), id = this.dragId;
    var end = e.target.closest ? e.target.closest('.tree-end') : null;
    var row = this._rowOf(e.target);
    var drop;
    if (end) {
      drop = { parent: '', index: 0, mode: 'end', row: end };
    } else if (!row) {
      return null;
    } else if (row.classList.contains('tree-root')) {
      drop = { parent: '', index: cfg.nodes.length, mode: 'inside', row: row };
    } else {
      var tid = row.getAttribute('data-id'), f = L.findNode(cfg, tid);
      if (!f) return null;
      var r = row.getBoundingClientRect(), y = (e.clientY - r.top) / Math.max(1, r.height);
      var isFrame = f.node.type === 'frame', zone;
      if (isFrame) zone = y < 0.28 ? 'above' : (y > 0.72 && !f.node.children.length ? 'below' : 'inside');
      else zone = y < 0.5 ? 'above' : 'below';
      var parent = f.parent ? f.parent.id : '';
      if (zone === 'above') drop = { parent: parent, index: f.index + 1, mode: 'above', row: row };
      else if (zone === 'below') drop = { parent: parent, index: f.index, mode: 'below', row: row };
      else drop = { parent: tid, index: f.node.children.length, mode: 'inside', row: row };
    }
    if (drop.row.getAttribute && drop.row.getAttribute('data-id') === id && drop.mode !== 'inside') drop.same = true;
    var why = L.canMove(cfg, id, drop.parent);
    if (why) drop.reason = why;
    return drop;
  };

  Tree.prototype._indicate = function (drop, denied) {
    var host = this.host;
    Array.prototype.forEach.call(host.querySelectorAll('.drop-in, .drop-no'), function (r) { r.classList.remove('drop-in', 'drop-no'); });
    if (this.line) { this.line.hidden = true; }
    if (!drop && denied && denied.row && denied.reason) denied.row.classList.add('drop-no');
    if (!drop) return;
    if (drop.mode === 'inside') { drop.row.classList.add('drop-in'); return; }
    if (!this.line) {
      this.line = el('div', 'drop-line');
      host.appendChild(this.line);
    }
    var hr = host.getBoundingClientRect(), rr = drop.row.getBoundingClientRect();
    var y = drop.mode === 'above' ? rr.top : drop.mode === 'below' ? rr.bottom : rr.top + rr.height / 2;
    var left = drop.row.style.paddingLeft ? parseInt(drop.row.style.paddingLeft, 10) : 8;
    this.line.style.top = (y - hr.top - 1) + 'px';
    this.line.style.left = left + 'px';
    this.line.hidden = false;
  };

  Tree.prototype._endDrag = function () {
    this.dragId = '';
    this.host.classList.remove('dnd');
    Array.prototype.forEach.call(this.host.querySelectorAll('.dragging, .drop-in, .drop-no'), function (r) {
      r.classList.remove('dragging', 'drop-in', 'drop-no');
    });
    if (this.line) this.line.hidden = true;
  };

  DLC.Tree = Tree;
}());
