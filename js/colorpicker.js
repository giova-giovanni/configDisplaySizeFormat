/*
 * colorpicker.js — Selettore colore a comparsa.
 *
 * Colori RAL Classic raggruppati per famiglia, colori più usati su quadri e
 * pannelli, ricerca per codice ("3020"), nome ("rosso") o esadecimale
 * ("CC0605"), e colore libero con il selettore del sistema.
 *
 *   DLC.colorPicker.open(anchor, { color, ral }, function (value, final) { … })
 */
(function () {
  'use strict';

  var DLC = window.DLC = window.DLC || {};
  var R = DLC.ral;

  var pop = null, els = {}, cur = null;

  function norm(s) {
    s = String(s || '').toLowerCase();
    return s.normalize ? s.normalize('NFD').replace(/[̀-ͯ]/g, '') : s;
  }

  function swatch(entry) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'cpk-sw';
    b.style.background = entry.color;
    b.setAttribute('data-code', entry.code);
    b.setAttribute('data-hex', entry.color);
    b.setAttribute('data-name', norm(entry.name));
    b.title = 'RAL ' + entry.code + ' ' + entry.name + ' · ' + entry.color.toUpperCase();
    b.setAttribute('aria-label', 'RAL ' + entry.code + ' ' + entry.name);
    return b;
  }

  function section(title, entries, cls) {
    var sec = document.createElement('div');
    sec.className = 'cpk-section' + (cls ? ' ' + cls : '');
    var t = document.createElement('div');
    t.className = 'cpk-title';
    t.textContent = title;
    var grid = document.createElement('div');
    grid.className = 'cpk-grid';
    entries.forEach(function (e) { grid.appendChild(swatch(e)); });
    sec.appendChild(t);
    sec.appendChild(grid);
    return sec;
  }

  function build() {
    pop = document.createElement('div');
    pop.className = 'cpk';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Scegli un colore');
    pop.hidden = true;

    var head = document.createElement('div');
    head.className = 'cpk-head';
    els.search = document.createElement('input');
    els.search.type = 'text';
    els.search.className = 'cell cpk-search';
    els.search.placeholder = 'Cerca: 3020, rosso, CC0605…';
    els.search.setAttribute('aria-label', 'Cerca un colore RAL o scrivi un codice esadecimale');
    els.search.spellcheck = false;
    els.search.autocomplete = 'off';
    head.appendChild(els.search);

    els.current = document.createElement('div');
    els.current.className = 'cpk-current';
    els.chip = document.createElement('span');
    els.chip.className = 'cpk-chip';
    els.desc = document.createElement('span');
    els.desc.className = 'cpk-desc';
    els.current.appendChild(els.chip);
    els.current.appendChild(els.desc);

    els.body = document.createElement('div');
    els.body.className = 'cpk-body';
    els.use = document.createElement('button');
    els.use.type = 'button';
    els.use.className = 'btn cpk-use';
    els.use.hidden = true;
    els.body.appendChild(els.use);
    els.body.appendChild(section('Più usati su quadri e pannelli', R.common(), 'cpk-common'));
    R.families().forEach(function (f) { els.body.appendChild(section('RAL ' + f.key + 'xxx · ' + f.label, f.items)); });
    els.empty = document.createElement('p');
    els.empty.className = 'cpk-empty';
    els.empty.textContent = 'Nessun colore RAL trovato. Puoi scrivere un codice esadecimale, es. CC0605.';
    els.empty.hidden = true;
    els.body.appendChild(els.empty);

    var foot = document.createElement('div');
    foot.className = 'cpk-foot';
    var lab = document.createElement('label');
    lab.className = 'cpk-native';
    els.native = document.createElement('input');
    els.native.type = 'color';
    lab.appendChild(els.native);
    lab.appendChild(document.createTextNode('Altro colore…'));
    var note = document.createElement('span');
    note.className = 'cpk-note';
    note.textContent = 'Valori RAL indicativi (sRGB)';
    foot.appendChild(lab);
    foot.appendChild(note);

    pop.appendChild(head);
    pop.appendChild(els.current);
    pop.appendChild(els.body);
    pop.appendChild(foot);

    els.body.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.cpk-sw') : null;
      if (!b) return;
      pick({ color: b.getAttribute('data-hex'), ral: b.getAttribute('data-code') }, true);
    });
    els.use.addEventListener('click', function () {
      var v = R.parse(els.search.value);
      if (v) pick(v, true);
    });
    els.search.addEventListener('input', filter);
    els.search.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var v = R.parse(els.search.value);
      if (v) { pick(v, true); return; }
      var first = els.body.querySelector('.cpk-section:not([hidden]) .cpk-sw:not([hidden])');
      if (first) first.click();
    });
    els.native.addEventListener('input', function () { pick({ color: els.native.value, ral: '' }, false); });
    els.native.addEventListener('change', function () { pick({ color: els.native.value, ral: '' }, true); });
    pop.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    });
  }

  function showCurrent(v) {
    els.chip.style.background = v.color;
    els.desc.textContent = R.describe(v.color, v.ral);
    var all = els.body.querySelectorAll('.cpk-sw');
    for (var i = 0; i < all.length; i++) {
      var on = v.ral ? all[i].getAttribute('data-code') === v.ral : all[i].getAttribute('data-hex') === v.color;
      all[i].classList.toggle('on', on);
    }
  }

  function filter() {
    var q = els.search.value.trim();
    var nq = norm(q).replace(/^ral\s*/, '');
    var hex = R.parse(q);
    var isHex = hex && !hex.ral;
    els.use.hidden = !isHex;
    if (isHex) {
      els.use.textContent = '';
      var chip = document.createElement('span');
      chip.className = 'cpk-chip';
      chip.style.background = hex.color;
      els.use.appendChild(chip);
      var same = R.fromHex(hex.color);
      els.use.appendChild(document.createTextNode('Usa ' + hex.color.toUpperCase() + (same ? ' (= RAL ' + same + ')' : '')));
    }
    var any = false;
    var sections = els.body.querySelectorAll('.cpk-section');
    for (var s = 0; s < sections.length; s++) {
      var sec = sections[s], visible = 0;
      if (q && sec.classList.contains('cpk-common')) { sec.hidden = true; continue; }
      var sws = sec.querySelectorAll('.cpk-sw');
      for (var i = 0; i < sws.length; i++) {
        var b = sws[i], show = true;
        if (nq) {
          var code = b.getAttribute('data-code'), name = b.getAttribute('data-name');
          var h = b.getAttribute('data-hex').slice(1);
          show = code.indexOf(nq) === 0 || name.indexOf(nq) !== -1 || (nq.length >= 3 && h.indexOf(nq.replace('#', '')) === 0);
        }
        b.hidden = !show;
        if (show) visible++;
      }
      sec.hidden = !visible;
      if (visible) any = true;
    }
    els.empty.hidden = any || isHex;
  }

  function pick(v, final) {
    if (!cur) return;
    showCurrent(v);
    cur.onPick(v, final);
    if (final) close(true);
  }

  function place(anchor) {
    var r = anchor.getBoundingClientRect();
    var w = pop.offsetWidth, h = pop.offsetHeight;
    var left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    var top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = top + 'px';
  }

  function onDocDown(e) {
    if (!cur) return;
    if (pop.contains(e.target) || cur.anchor.contains(e.target)) return;
    close(false);
  }

  /* Scorrendo la pagina il selettore segue il quadratino; si chiude solo se esce dallo schermo. */
  function onScroll(e) {
    if (!cur || (e && e.target && e.target.nodeType === 1 && pop.contains(e.target))) return;
    var r = cur.anchor.getBoundingClientRect();
    if (!document.contains(cur.anchor) || r.bottom < 0 || r.top > window.innerHeight) close(false);
    else place(cur.anchor);
  }

  function open(anchor, value, onPick) {
    if (!pop) build();
    if (cur && cur.anchor === anchor) { close(true); return; }
    close(false);
    var host = anchor.closest('dialog[open]') || document.body;
    if (pop.parentNode !== host) host.appendChild(pop);
    cur = { anchor: anchor, onPick: onPick };
    els.search.value = '';
    filter();
    showCurrent(value);
    els.native.value = value.color;
    pop.hidden = false;
    place(anchor);
    els.body.scrollTop = 0;
    var on = els.body.querySelector('.cpk-section:not(.cpk-common) .cpk-sw.on');
    if (on) on.scrollIntoView({ block: 'nearest' });
    els.search.focus();
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
  }

  function close(restoreFocus) {
    if (!cur) return;
    var anchor = cur.anchor;
    cur = null;
    pop.hidden = true;
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onScroll);
    if (restoreFocus && anchor && document.contains(anchor)) {
      try { anchor.focus({ preventScroll: true }); } catch (e) { anchor.focus(); }
    }
  }

  DLC.colorPicker = { open: open, close: close, isOpen: function () { return !!cur; } };
}());
