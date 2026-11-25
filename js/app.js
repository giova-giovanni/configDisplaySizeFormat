/*
 * app.js — Interfaccia del Configuratore Layout Display.
 *
 * Collega: celle dell'editor → calcolo del layout → anteprima SVG e tabella
 * delle coordinate; gestisce salvataggi, annulla/ripristina, esportazioni.
 */
(function () {
  'use strict';

  var DLC = window.DLC;
  var L = DLC.layout, X = DLC.exporters, S = DLC.storage, E = DLC.editor;
  var LIM = L.LIMITS;
  var APP_ID = 'configuratore-layout-display';

  var PRESETS = [
    [320, 240, 'QVGA'],
    [480, 272, '4,3"'],
    [640, 480, 'VGA'],
    [800, 480, '7" WVGA'],
    [800, 600, 'SVGA'],
    [1024, 600, 'WSVGA'],
    [1024, 768, 'XGA'],
    [1280, 720, 'HD 720p'],
    [1280, 800, 'WXGA'],
    [1280, 1024, 'SXGA'],
    [1366, 768, 'HD 16:9'],
    [1920, 1080, 'Full HD']
  ];
  var ZOOMS = ['fit', '0.5', '1', '1.5', '2'];
  var FORMATS = [['tsv', 'Excel (TSV)'], ['csv', 'CSV'], ['st', 'CODESYS (ST)'], ['txt', 'Testo'], ['json', 'JSON']];
  var THEMES = ['auto', 'light', 'dark'];
  var THEME_LABEL = { auto: 'Auto', light: 'Chiaro', dark: 'Scuro' };

  function defaultUI() {
    return {
      active: 0,
      view: 'long',
      zoom: 'fit',
      showGrid: true,
      showNames: true,
      showCoords: true,
      autoCopy: true,
      onlyActive: false,
      theme: 'auto',
      exp: { fmt: 'tsv', table: 'long', headers: true, sep: ';', stType: 'ST_VisuRect', stBase: 1, stConst: true, scope: 'all' }
    };
  }

  var state = { config: null, ui: null, result: null, blockMap: {}, sheetsData: [] };
  var hist = { past: [], future: [], last: '' };
  var fields = [];
  var sheets = [];
  var preview = null;
  var blockTable = null;
  var raf = 0, draftTimer = 0, uiTimer = 0, toastTimer = 0;

  /* ------------------------------------------------------------------ */
  /*  Utilità                                                            */
  /* ------------------------------------------------------------------ */

  function $(id) { return document.getElementById(id); }
  function cfg() { return state.config; }
  function grp() { return state.config.groups[state.ui.active]; }
  function plural(n, one, many) { return n === 1 ? one : many; }
  function fmtNum(n) { return (Math.round(n * 10) / 10).toLocaleString('it-IT'); }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function iconButton(cls, icon, label) {
    var b = el('button', cls);
    b.type = 'button';
    b.innerHTML = DLC.icons.get(icon);
    if (label) b.appendChild(document.createTextNode(label));
    return b;
  }

  function clampActive() {
    state.ui.active = Math.max(0, Math.min(cfg().groups.length - 1, state.ui.active | 0));
  }

  function fileBase() {
    return DLC.slug(cfg().name) + '_' + cfg().display.width + 'x' + cfg().display.height;
  }

  /* ------------------------------------------------------------------ */
  /*  Preferenze dell'interfaccia                                        */
  /* ------------------------------------------------------------------ */

  function loadUI() {
    var u = S.loadUI(), d = defaultUI();
    if (!u || typeof u !== 'object') return d;
    if (typeof u.active === 'number' && isFinite(u.active)) d.active = Math.max(0, Math.floor(u.active));
    if (u.view === 'long' || u.view === 'wide') d.view = u.view;
    if (ZOOMS.indexOf(String(u.zoom)) !== -1) d.zoom = String(u.zoom);
    ['showGrid', 'showNames', 'showCoords', 'autoCopy', 'onlyActive'].forEach(function (k) {
      if (typeof u[k] === 'boolean') d[k] = u[k];
    });
    if (THEMES.indexOf(u.theme) !== -1) d.theme = u.theme;
    var x = u.exp;
    if (x && typeof x === 'object') {
      if (FORMATS.some(function (f) { return f[0] === x.fmt; })) d.exp.fmt = x.fmt;
      if (x.table === 'long' || x.table === 'wide') d.exp.table = x.table;
      if (typeof x.headers === 'boolean') d.exp.headers = x.headers;
      if ([';', ',', 'tab'].indexOf(x.sep) !== -1) d.exp.sep = x.sep;
      if (typeof x.stType === 'string') d.exp.stType = x.stType.slice(0, 40);
      if (x.stBase === 0 || x.stBase === 1) d.exp.stBase = x.stBase;
      if (typeof x.stConst === 'boolean') d.exp.stConst = x.stConst;
      if (x.scope === 'all' || x.scope === 'active') d.exp.scope = x.scope;
    }
    return d;
  }

  function saveUISoon() {
    clearTimeout(uiTimer);
    uiTimer = setTimeout(function () { S.saveUI(state.ui); }, 250);
  }

  function applyTheme() {
    var t = state.ui.theme, root = document.documentElement;
    if (t === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', t);
    var label = $('theme-label');
    if (label) label.textContent = THEME_LABEL[t];
    var btn = $('btn-theme');
    if (btn) btn.title = 'Tema: ' + THEME_LABEL[t].toLowerCase() + ' (clic per cambiare)';
  }

  /* ------------------------------------------------------------------ */
  /*  Salvataggio automatico e cronologia (annulla / ripristina)         */
  /* ------------------------------------------------------------------ */

  function saveDraftSoon() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraftNow, 400);
  }

  function saveDraftNow() {
    clearTimeout(draftTimer);
    var ok = S.saveDraft(state.config);
    var label = $('save-state');
    label.textContent = ok ? 'Salvataggio automatico attivo' : 'Salvataggio automatico non disponibile';
    label.classList.toggle('off', !ok);
  }

  function snapshot() { return JSON.stringify(state.config); }

  function commit() {
    var s = snapshot();
    if (s === hist.last) return;
    hist.past.push(hist.last);
    if (hist.past.length > 200) hist.past.shift();
    hist.last = s;
    hist.future = [];
    renderUndo();
  }

  function undo() {
    commit();
    if (!hist.past.length) { toast('Niente da annullare'); return; }
    hist.future.push(hist.last);
    hist.last = hist.past.pop();
    state.config = JSON.parse(hist.last);
    clampActive();
    renderAll();
  }

  function redo() {
    if (!hist.future.length) { toast('Niente da ripristinare'); return; }
    hist.past.push(hist.last);
    hist.last = hist.future.pop();
    state.config = JSON.parse(hist.last);
    clampActive();
    renderAll();
  }

  function renderUndo() {
    $('btn-undo').disabled = !hist.past.length && snapshot() === hist.last;
    $('btn-redo').disabled = !hist.future.length;
  }

  /* ------------------------------------------------------------------ */
  /*  Rendering                                                          */
  /* ------------------------------------------------------------------ */

  function renderAll() {
    syncFields();
    renderDirection();
    blockTable.render();
    recompute();
  }

  function scheduleRecompute() {
    if (!raf) raf = requestAnimationFrame(function () { raf = 0; recompute(); });
  }

  function recompute() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    state.result = L.computeLayout(state.config);
    state.blockMap = {};
    state.result.blocks.forEach(function (b) { state.blockMap[b.key] = b; });
    renderTabs();
    renderGroupInfo();
    syncPreset();
    renderPreview();
    renderOutput();
    renderUndo();
    saveDraftSoon();
  }

  function syncFields() {
    fields.forEach(function (f) {
      if (document.activeElement !== f.el) f.el.value = f.get();
    });
  }

  function renderTabs() {
    var wrap = $('group-tabs');
    wrap.textContent = '';
    cfg().groups.forEach(function (g, i) {
      var active = i === state.ui.active;
      var b = el('button', 'tab' + (active ? ' active' : ''));
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(active));
      var dot = el('span', 'dot');
      dot.style.background = g.blocks[0] ? g.blocks[0].color : '#94a3b8';
      b.appendChild(dot);
      b.appendChild(el('span', null, g.name || ('Gruppo ' + (i + 1))));
      b.addEventListener('click', function () { setActive(i); });
      wrap.appendChild(b);
    });
    var add = iconButton('tab tab-add', 'plus');
    add.title = 'Aggiungi un gruppo di elementi (es. una fila di pulsanti)';
    add.setAttribute('aria-label', 'Aggiungi un gruppo');
    add.disabled = cfg().groups.length >= LIM.maxGroups;
    add.addEventListener('click', addGroup);
    wrap.appendChild(add);
    $('btn-del-group').disabled = cfg().groups.length <= 1;
    $('btn-dup-group').disabled = cfg().groups.length >= LIM.maxGroups;
  }

  function renderDirection() {
    var dir = grp().direction;
    Array.prototype.forEach.call(document.querySelectorAll('#dir-seg button'), function (b) {
      var on = b.getAttribute('data-dir') === dir;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
  }

  function renderViewSeg() {
    Array.prototype.forEach.call(document.querySelectorAll('#view-seg button'), function (b) {
      var on = b.getAttribute('data-view') === state.ui.view;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
  }

  function fitLine(label, value) {
    var p = el('p', 'fit-line');
    p.appendChild(el('span', 'k', label));
    p.appendChild(el('span', 'v', value));
    return p;
  }

  function renderGroupInfo() {
    var gr = state.result.groups[state.ui.active], g = grp();

    // Area di lavoro
    var box = $('area-info');
    box.textContent = '';
    box.classList.toggle('invalid', !gr.areaValid);
    box.appendChild(el('strong', null, gr.areaValid ? gr.area.w + ' × ' + gr.area.h + ' px' : 'Area non valida'));
    box.appendChild(el('span', null, gr.areaValid ? 'X ' + gr.area.x + ' · Y ' + gr.area.y : 'gli offset superano il display'));

    // Ingombro dell'elemento
    var parts = [];
    g.blocks.forEach(function (b) {
      if (b.gap) parts.push(b.gap < 0 ? '(' + b.gap + ')' : String(b.gap));
      parts.push(String(g.direction === 'v' ? b.height : b.width));
    });
    var info = 'Elemento: ' + gr.element.w + ' × ' + gr.element.h + ' px';
    if (parts.length > 1) info += ' — ' + (g.direction === 'v' ? 'altezza ' : 'larghezza ') + parts.join(' + ');
    $('element-info').textContent = info;

    // Distanze calcolate automaticamente con "Distribuisci"
    var cg = $('col-gap'), rg = $('row-gap');
    cg.disabled = g.alignH === 'distribute';
    rg.disabled = g.alignV === 'distribute';
    cg.title = cg.disabled ? 'Calcolata automaticamente (allineamento “Distribuisci”)' : 'Distanza orizzontale tra le colonne di elementi';
    rg.title = rg.disabled ? 'Calcolata automaticamente (allineamento “Distribuisci”)' : 'Distanza verticale tra le righe di elementi';

    // Riepilogo griglia
    var fit = $('fit-info');
    fit.textContent = '';
    if (!gr.count) {
      fit.appendChild(el('p', 'fit-line', 'Nessun elemento: imposta il numero di elementi.'));
    } else {
      fit.appendChild(fitLine('Griglia', gr.rows + ' ' + plural(gr.rows, 'riga', 'righe') + ' × ' + gr.cols + ' ' +
        plural(gr.cols, 'colonna', 'colonne') + ' · ingombro ' + gr.grid.w + ' × ' + gr.grid.h + ' px'));
      if (gr.areaValid) fit.appendChild(fitLine('Spazio libero', gr.free.w + ' px orizz. · ' + gr.free.h + ' px vert.'));
      if (g.alignH === 'distribute' && gr.cols > 1) fit.appendChild(fitLine('Dist. colonne', '≈ ' + fmtNum(gr.gaps.col) + ' px (calcolata)'));
      if (g.alignV === 'distribute' && gr.rows > 1) fit.appendChild(fitLine('Dist. righe', '≈ ' + fmtNum(gr.gaps.row) + ' px (calcolata)'));
    }

    var fr = gr.fit.rows, fc = gr.fit.cols, finite = isFinite(fr) && isFinite(fc);
    var row = el('div', 'fit-row');
    row.appendChild(el('span', null, finite
      ? 'Nell\'area entrano al massimo ' + fr + ' ' + plural(fr, 'riga', 'righe') + ' × ' + fc + ' ' + plural(fc, 'colonna', 'colonne')
      : 'Con distanze negative non c\'è un limite di spazio'));
    if (finite && fr > 0 && fc > 0) {
      var cols = Math.max(1, Math.min(g.columns, fc));
      var n = Math.min(LIM.count[1], fr * cols);
      if (n !== g.count || cols !== g.columns) {
        var fill = el('button', 'link-btn', 'Riempi: ' + fr + ' × ' + cols + ' = ' + n);
        fill.type = 'button';
        fill.title = 'Imposta il numero di elementi che riempie l\'area di lavoro';
        fill.addEventListener('click', function () {
          change(function (c, gg) { gg.columns = cols; gg.count = n; }, { sync: true });
          toast('Area riempita con ' + n + ' elementi', { action: { label: 'Annulla', fn: undo } });
        });
        row.appendChild(fill);
      }
    }
    fit.appendChild(row);

    if (gr.out.area) {
      var w = el('p', 'fit-warn');
      w.innerHTML = DLC.icons.get('warn');
      w.appendChild(document.createTextNode(gr.out.area + ' ' + plural(gr.out.area, 'blocco esce', 'blocchi escono') +
        ' dall\'area di lavoro' + (gr.out.display ? ' (' + gr.out.display + ' anche dal display)' : '')));
      fit.appendChild(w);
    }
  }

  function buildPresets() {
    var sel = $('display-preset');
    sel.textContent = '';
    PRESETS.forEach(function (p) {
      var o = el('option', null, p[0] + ' × ' + p[1] + '  —  ' + p[2]);
      o.value = p[0] + 'x' + p[1];
      sel.appendChild(o);
    });
    var custom = el('option', null, 'Personalizzato');
    custom.value = 'custom';
    sel.appendChild(custom);
  }

  function syncPreset() {
    var d = cfg().display, v = d.width + 'x' + d.height, sel = $('display-preset');
    var found = PRESETS.some(function (p) { return p[0] + 'x' + p[1] === v; });
    var rotated = !found && PRESETS.some(function (p) { return p[1] + 'x' + p[0] === v; });
    sel.value = found ? v : 'custom';
    sel.options[sel.options.length - 1].textContent = rotated ? 'Personalizzato (verticale)' : 'Personalizzato';
  }

  function previewView() {
    return {
      active: state.ui.active,
      zoom: state.ui.zoom,
      showGrid: state.ui.showGrid,
      showNames: state.ui.showNames,
      showCoords: state.ui.showCoords
    };
  }

  function renderPreview() {
    $('preview-size').textContent = cfg().display.width + ' × ' + cfg().display.height + ' px';
    preview.render(state.result, previewView());
  }

  function outputFilter() {
    return cfg().groups.length > 1 && state.ui.onlyActive ? [state.ui.active] : null;
  }

  function renderOutput() {
    var multi = cfg().groups.length > 1;
    $('only-active-wrap').hidden = !multi;
    var filter = outputFilter();
    var data = X.buildSheets(state.result, { view: state.ui.view, groups: filter });
    while (sheets.length < data.length) sheets.push(makeSheet());
    while (sheets.length > data.length) sheets.pop().destroy();
    data.forEach(function (d, i) { sheets[i].setData(d); });
    state.sheetsData = data;
    renderSummary(filter);
  }

  function badge(host, kind, text, icon) {
    var b = el('span', 'badge' + (kind ? ' ' + kind : ''));
    if (icon) b.innerHTML = DLC.icons.get(icon);
    b.appendChild(document.createTextNode(text));
    host.appendChild(b);
  }

  function renderSummary(filter) {
    var host = $('summary');
    host.textContent = '';
    var groups = filter ? state.result.groups.filter(function (g) { return filter.indexOf(g.index) !== -1; }) : state.result.groups;
    var elements = 0, blocks = 0, outA = 0, outD = 0, ovl = 0;
    groups.forEach(function (g) {
      elements += g.items.length;
      blocks += g.blocks.length;
      g.blocks.forEach(function (b) {
        if (b.outArea) outA++;
        if (b.outDisplay) outD++;
        if (b.overlap) ovl++;
      });
    });
    badge(host, '', elements + ' ' + plural(elements, 'elemento', 'elementi') + ' · ' + blocks + ' ' + plural(blocks, 'blocco', 'blocchi'), 'table');
    if (outD) badge(host, 'err', outD + ' fuori dal display', 'warn');
    if (outA) badge(host, 'warn', outA + ' fuori dall\'area di lavoro', 'warn');
    if (ovl) badge(host, 'warn', ovl + ' ' + plural(ovl, 'sovrapposto', 'sovrapposti') + ' ad altri gruppi', 'warn');
    if (state.result.truncated) badge(host, 'err', 'Mostrati solo i primi ' + LIM.maxTotalBlocks + ' blocchi', 'warn');
    if (blocks && !outA && !outD && !ovl) badge(host, 'ok', 'Tutto dentro l\'area di lavoro', 'check');
  }

  function renderSelStats(info) {
    var s = $('sel-stats');
    if (!info || info.count < 2) { s.textContent = ''; return; }
    var txt = 'Celle: ' + info.count;
    if (info.numbers > 1) txt += ' · Somma: ' + info.sum.toLocaleString('it-IT');
    s.textContent = txt;
  }

  function renderSheetHint() {
    $('sheet-hint').textContent = state.ui.autoCopy
      ? 'Clic su una cella = copia il valore · trascina per copiare più celle (incollabili in Excel) · Ctrl+C'
      : 'Seleziona le celle e premi Ctrl+C (o doppio clic su una cella) per copiare';
  }

  /* ------------------------------------------------------------------ */
  /*  Tabella coordinate ↔ anteprima                                     */
  /* ------------------------------------------------------------------ */

  function makeSheet() {
    var sh = new DLC.Sheet({
      autoCopy: function () { return state.ui.autoCopy; },
      onSelect: onSheetSelect,
      onHover: function (keys) { preview.setHover(keys || []); },
      onCopy: onSheetCopy
    });
    $('sheets').appendChild(sh.root);
    return sh;
  }

  function onSheetSelect(info, src) {
    if (info) sheets.forEach(function (s) { if (s !== src) s.clear(true); });
    $('namebox').textContent = info ? info.ref : '—';
    $('fx-value').textContent = info ? info.value : '';
    renderSelStats(info);
    preview.setSelection(info ? info.keys : []);
  }

  function onSheetCopy(r) {
    if (!r.ok) { toast('Copia non riuscita: seleziona e usa Ctrl+C', { kind: 'err' }); return; }
    if (r.cells === 1) toast('Copiato: ' + r.text, { timeout: 1500 });
    else toast('Copiate ' + r.cells + ' celle (' + r.rows + ' × ' + r.cols + '): incollale in Excel', { timeout: 2200 });
  }

  function onPreviewHover(key, e) {
    var b = key ? state.blockMap[key] : null;
    sheets.forEach(function (s) { s.hoverKey(b ? key : null); });
    if (!b) {
      hideTip();
      $('hover-info').textContent = '';
      return;
    }
    $('hover-info').textContent = b.name + ' ' + b.n + ': X ' + b.x + ' · Y ' + b.y + ' · ' + b.w + ' × ' + b.h + ' px';
    showTip(b, e);
  }

  function onPreviewMove(e) {
    if (!$('tooltip').hidden) placeTip(e);
  }

  function onPreviewClick(key) {
    var b = state.blockMap[key];
    if (!b) return;
    if (b.group !== state.ui.active) setActive(b.group);
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].selectKey(key)) break;
    }
  }

  function onCursor(pt) {
    $('cursor-pos').textContent = pt ? 'Cursore  X ' + pt.x + ' · Y ' + pt.y : 'Cursore  X — · Y —';
  }

  function showTip(b, e) {
    var t = $('tooltip');
    t.textContent = '';
    var title = el('div', 'tip-title');
    title.appendChild(el('b', null, b.name + ' ' + b.n));
    if (cfg().groups.length > 1) title.appendChild(document.createTextNode(' · ' + state.result.groups[b.group].name));
    t.appendChild(title);
    t.appendChild(el('div', null, 'X ' + b.x + '   Y ' + b.y));
    t.appendChild(el('div', 'tip-dim', b.w + ' × ' + b.h + ' px · riga ' + b.row + ', col. ' + b.col));
    if (b.outDisplay) t.appendChild(el('div', 'tip-warn', 'Fuori dal display'));
    else if (b.outArea) t.appendChild(el('div', 'tip-warn', 'Fuori dall\'area di lavoro'));
    if (b.overlap) t.appendChild(el('div', 'tip-warn', 'Sovrapposto a un altro gruppo'));
    t.hidden = false;
    if (e) placeTip(e);
  }

  function placeTip(e) {
    var t = $('tooltip');
    var r = t.getBoundingClientRect();
    var x = e.clientX + 14, y = e.clientY + 16;
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - 12;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - 12;
    t.style.left = Math.max(4, x) + 'px';
    t.style.top = Math.max(4, y) + 'px';
  }

  function hideTip() { $('tooltip').hidden = true; }

  /* ------------------------------------------------------------------ */
  /*  Modifiche                                                          */
  /* ------------------------------------------------------------------ */

  function change(mutator, opts) {
    opts = opts || {};
    mutator(state.config, grp());
    if (opts.structural) renderAll();
    else {
      if (opts.sync) syncFields();
      recompute();
    }
    commit();
  }

  function setActive(i) {
    if (i === state.ui.active) return;
    state.ui.active = i;
    saveUISoon();
    renderAll();
  }

  function addGroup() {
    if (cfg().groups.length >= LIM.maxGroups) return;
    commit();
    cfg().groups.push(L.suggestGroup(cfg(), state.ui.active));
    state.ui.active = cfg().groups.length - 1;
    saveUISoon();
    renderAll();
    commit();
    toast('Aggiunto «' + grp().name + '»: imposta area, blocchi e disposizione', { action: { label: 'Annulla', fn: undo } });
  }

  function duplicateGroup() {
    if (cfg().groups.length >= LIM.maxGroups) return;
    commit();
    var copy = JSON.parse(JSON.stringify(grp()));
    copy.name = (copy.name + ' (copia)').slice(0, LIM.nameLength);
    cfg().groups.splice(state.ui.active + 1, 0, copy);
    state.ui.active++;
    saveUISoon();
    renderAll();
    commit();
    toast('Gruppo duplicato', { action: { label: 'Annulla', fn: undo } });
  }

  function deleteGroup() {
    if (cfg().groups.length <= 1) return;
    commit();
    var name = grp().name;
    cfg().groups.splice(state.ui.active, 1);
    clampActive();
    saveUISoon();
    renderAll();
    commit();
    toast('Eliminato «' + name + '»', { action: { label: 'Annulla', fn: undo } });
  }

  function loadConfig(config, message) {
    commit();
    state.config = L.normalizeConfig(JSON.parse(JSON.stringify(config)));
    state.ui.active = 0;
    sheets.forEach(function (s) { s.clear(true); });
    saveUISoon();
    renderAll();
    commit();
    toast(message, { action: { label: 'Annulla', fn: undo } });
  }

  /* ------------------------------------------------------------------ */
  /*  Collegamenti dell'editor                                           */
  /* ------------------------------------------------------------------ */

  function bindNum(id, get, set, range) {
    var input = $(id);
    E.bindNumber(input, {
      get: get,
      set: function (v) { set(v); scheduleRecompute(); },
      range: range,
      commit: commit
    });
    fields.push({ el: input, get: get });
  }

  function bindTxt(id, get, set, fallback, maxLength) {
    var input = $(id);
    E.bindText(input, {
      get: get,
      set: function (v) { set(v.slice(0, maxLength)); scheduleRecompute(); },
      fallback: fallback,
      maxLength: maxLength,
      commit: commit
    });
    fields.push({ el: input, get: get });
  }

  function bindSel(id, get, set) {
    var input = $(id);
    E.bindSelect(input, {
      get: get,
      set: function (v) { set(v); recompute(); },
      commit: commit
    });
    fields.push({ el: input, get: get });
  }

  function bindEditor() {
    bindTxt('cfg-name', function () { return cfg().name; }, function (v) { cfg().name = v; },
      function () { return 'Layout display'; }, LIM.configNameLength);

    bindNum('display-w', function () { return cfg().display.width; }, function (v) { cfg().display.width = v; }, LIM.displaySize);
    bindNum('display-h', function () { return cfg().display.height; }, function (v) { cfg().display.height = v; }, LIM.displaySize);
    $('display-preset').addEventListener('change', function () {
      var v = this.value;
      if (v === 'custom') { $('display-w').focus(); return; }
      var p = v.split('x');
      change(function (c) { c.display.width = +p[0]; c.display.height = +p[1]; }, { sync: true });
    });
    $('btn-rotate').addEventListener('click', function () {
      change(function (c) {
        var w = c.display.width;
        c.display.width = c.display.height;
        c.display.height = w;
      }, { sync: true });
    });

    bindTxt('group-name', function () { return grp().name; }, function (v) { grp().name = v; },
      function () { return 'Gruppo ' + (state.ui.active + 1); }, LIM.nameLength);
    $('btn-dup-group').addEventListener('click', duplicateGroup);
    $('btn-del-group').addEventListener('click', deleteGroup);

    ['top', 'left', 'right', 'bottom'].forEach(function (side) {
      bindNum('off-' + side, function () { return grp().area[side]; }, function (v) { grp().area[side] = v; }, LIM.offset);
    });

    Array.prototype.forEach.call(document.querySelectorAll('#dir-seg button'), function (b) {
      b.addEventListener('click', function () {
        var dir = b.getAttribute('data-dir');
        if (grp().direction === dir) return;
        change(function (c, g) { g.direction = dir; }, { structural: true });
      });
    });
    $('btn-add-block').addEventListener('click', function () { blockTable.add(); });

    bindNum('count', function () { return grp().count; }, function (v) { grp().count = v; }, LIM.count);
    bindNum('columns', function () { return grp().columns; }, function (v) { grp().columns = v; }, LIM.columns);
    bindNum('row-gap', function () { return grp().rowGap; }, function (v) { grp().rowGap = v; }, LIM.gap);
    bindNum('col-gap', function () { return grp().colGap; }, function (v) { grp().colGap = v; }, LIM.gap);
    bindSel('order', function () { return grp().order; }, function (v) { grp().order = v; });
    bindSel('align-h', function () { return grp().alignH; }, function (v) { grp().alignH = v; });
    bindSel('align-v', function () { return grp().alignV; }, function (v) { grp().alignV = v; });
  }

  /* ------------------------------------------------------------------ */
  /*  Barra dei comandi                                                  */
  /* ------------------------------------------------------------------ */

  function importFile(file) {
    if (file.size > 2 * 1024 * 1024) { toast('File troppo grande.', { kind: 'err' }); return; }
    DLC.readFile(file).then(function (text) {
      var data = JSON.parse(text);
      var conf = data && data.app === APP_ID && data.config ? data.config : data;
      if (!conf || typeof conf !== 'object' || !conf.display || !Array.isArray(conf.groups)) throw new Error('formato');
      loadConfig(conf, 'Importato «' + file.name + '»');
    }).catch(function () {
      toast('Il file non contiene un layout valido.', { kind: 'err' });
    });
  }

  function exportConfig() {
    var data = { app: APP_ID, version: 1, exportedAt: new Date().toISOString(), config: cfg() };
    DLC.download(DLC.slug(cfg().name) + '.json', JSON.stringify(data, null, 2), 'application/json');
    toast('Impostazioni esportate in un file .json (reimportabile con “Importa”)');
  }

  function copyLink() {
    var url = S.shareUrl(cfg());
    DLC.copyText(url).then(function (ok) {
      if (ok) toast('Link copiato: chi lo apre vede questo layout');
      else toast('Impossibile copiare il link', { kind: 'err' });
    });
  }

  function copyAll() {
    var data = state.sheetsData;
    var rows = data.reduce(function (n, s) { return n + s.rows.length; }, 0);
    DLC.copyText(X.sheetsToTSV(data, { headers: true })).then(function (ok) {
      if (ok) toast('Tabella copiata (' + rows + ' righe + intestazioni): incollala in Excel');
      else toast('Copia non riuscita', { kind: 'err' });
    });
  }

  function bindToolbar() {
    $('btn-new').addEventListener('click', function () { loadConfig(L.defaultConfig(), 'Nuovo layout con i valori iniziali'); });
    $('btn-open').addEventListener('click', function () { openConfigs(false); });
    $('btn-save').addEventListener('click', function () { openConfigs(true); });
    $('btn-import').addEventListener('click', function () { $('file-import').click(); });
    $('file-import').addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      if (f) importFile(f);
    });
    $('btn-export-cfg').addEventListener('click', exportConfig);
    $('btn-link').addEventListener('click', copyLink);
    $('btn-undo').addEventListener('click', undo);
    $('btn-redo').addEventListener('click', redo);
    $('btn-help').addEventListener('click', function () { $('dlg-help').showModal(); });
    $('btn-theme').addEventListener('click', function () {
      state.ui.theme = THEMES[(THEMES.indexOf(state.ui.theme) + 1) % THEMES.length];
      applyTheme();
      saveUISoon();
      renderPreview();
    });
  }

  function bindPreviewTools() {
    var z = $('zoom');
    z.value = state.ui.zoom;
    z.addEventListener('change', function () { state.ui.zoom = z.value; saveUISoon(); renderPreview(); });
    [['opt-grid', 'showGrid'], ['opt-names', 'showNames'], ['opt-coords', 'showCoords']].forEach(function (p) {
      var c = $(p[0]);
      c.checked = state.ui[p[1]];
      c.addEventListener('change', function () { state.ui[p[1]] = c.checked; saveUISoon(); renderPreview(); });
    });
    $('btn-png').addEventListener('click', function () {
      DLC.preview.exportPNG(state.result, previewView()).then(function (blob) {
        DLC.downloadBlob(fileBase() + '.png', blob);
        toast('Immagine PNG ' + cfg().display.width + ' × ' + cfg().display.height + ' px scaricata');
      }, function () {
        toast('Impossibile creare l\'immagine PNG', { kind: 'err' });
      });
    });
    $('btn-svg').addEventListener('click', function () {
      DLC.download(fileBase() + '.svg', DLC.preview.exportSVG(state.result, previewView()), 'image/svg+xml');
      toast('Disegno SVG scaricato');
    });
  }

  function bindOutputTools() {
    Array.prototype.forEach.call(document.querySelectorAll('#view-seg button'), function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-view');
        if (v === state.ui.view) return;
        state.ui.view = v;
        sheets.forEach(function (s) { s.clear(true); });
        onSheetSelect(null);
        saveUISoon();
        renderViewSeg();
        renderOutput();
      });
    });
    var only = $('opt-only-active');
    only.checked = state.ui.onlyActive;
    only.addEventListener('change', function () { state.ui.onlyActive = only.checked; saveUISoon(); renderOutput(); });
    var auto = $('opt-autocopy');
    auto.checked = state.ui.autoCopy;
    auto.addEventListener('change', function () { state.ui.autoCopy = auto.checked; saveUISoon(); renderSheetHint(); });
    $('btn-copy-all').addEventListener('click', copyAll);
    $('btn-export').addEventListener('click', openExport);
  }

  /* ------------------------------------------------------------------ */
  /*  Finestre: layout salvati                                           */
  /* ------------------------------------------------------------------ */

  function describe(entry) {
    var c = entry.config || {}, d = c.display || {};
    var n = Array.isArray(c.groups) ? c.groups.length : 0;
    var date = new Date(entry.savedAt), ds = '';
    if (!isNaN(date.getTime())) {
      ds = date.toLocaleDateString('it-IT') + ' ' + date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    }
    return (d.width || '?') + ' × ' + (d.height || '?') + ' px · ' + n + ' ' + plural(n, 'gruppo', 'gruppi') + (ds ? ' · ' + ds : '');
  }

  function renderSavedList() {
    var host = $('saved-list');
    host.textContent = '';
    if (!S.available) {
      host.appendChild(el('p', 'empty', 'Questo browser non permette il salvataggio (navigazione privata?). Usa “Esporta” per salvare un file .json.'));
      return;
    }
    var list = S.listSaved();
    if (!list.length) {
      host.appendChild(el('p', 'empty', 'Nessun layout salvato finora.'));
      return;
    }
    list.forEach(function (entry) {
      var row = el('div', 'saved-item');
      var info = el('div', 'saved-info');
      info.appendChild(el('strong', null, entry.name));
      info.appendChild(el('span', null, describe(entry)));
      row.appendChild(info);
      var open = el('button', 'btn', 'Apri');
      open.type = 'button';
      open.addEventListener('click', function () {
        $('dlg-configs').close();
        loadConfig(entry.config, 'Aperto «' + entry.name + '»');
      });
      var del = iconButton('icon-btn danger', 'trash');
      del.title = 'Elimina';
      del.setAttribute('aria-label', 'Elimina ' + entry.name);
      var armed = false, timer = 0;
      del.addEventListener('click', function () {
        if (!armed) {
          armed = true;
          del.classList.add('armed');
          del.title = 'Clic di nuovo per confermare';
          toast('Clic di nuovo sul cestino per eliminare «' + entry.name + '»');
          timer = setTimeout(function () { armed = false; del.classList.remove('armed'); del.title = 'Elimina'; }, 3000);
          return;
        }
        clearTimeout(timer);
        S.removeSaved(entry.id);
        renderSavedList();
        toast('Eliminato «' + entry.name + '»');
      });
      row.appendChild(open);
      row.appendChild(del);
      host.appendChild(row);
    });
  }

  function openConfigs(focusSave) {
    $('save-name').value = cfg().name;
    renderSavedList();
    $('dlg-configs').showModal();
    if (focusSave) {
      $('save-name').focus();
      $('save-name').select();
    }
  }

  function doSave(name) {
    name = String(name || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, LIM.configNameLength) || 'Layout display';
    if (cfg().name !== name) {
      cfg().name = name;
      syncFields();
      commit();
    }
    var r = S.saveNamed(name, cfg());
    if (!r) {
      toast('Salvataggio non riuscito: il browser non lo consente. Usa “Esporta”.', { kind: 'err', timeout: 5000 });
      return;
    }
    saveDraftNow();
    if ($('dlg-configs').open) $('dlg-configs').close();
    toast((r.updated ? 'Aggiornato' : 'Salvato') + ' «' + name + '» in questo browser');
  }

  /* ------------------------------------------------------------------ */
  /*  Finestra: esporta coordinate                                       */
  /* ------------------------------------------------------------------ */

  function openExport() {
    state.ui.exp.table = state.ui.view;
    renderExportTabs();
    renderExportOptions();
    renderExportOutputs();
    $('dlg-export').showModal();
  }

  function renderExportTabs() {
    var host = $('export-tabs');
    host.textContent = '';
    FORMATS.forEach(function (f) {
      var on = state.ui.exp.fmt === f[0];
      var b = el('button', 'fmt-tab' + (on ? ' on' : ''), f[1]);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(on));
      b.addEventListener('click', function () {
        state.ui.exp.fmt = f[0];
        saveUISoon();
        renderExportTabs();
        renderExportOptions();
        renderExportOutputs();
      });
      host.appendChild(b);
    });
  }

  function optSelect(label, options, value, onChange) {
    var wrap = el('label', 'opt');
    wrap.appendChild(el('span', null, label));
    var s = el('select', 'cell');
    options.forEach(function (o) {
      var op = el('option', null, o[1]);
      op.value = o[0];
      s.appendChild(op);
    });
    s.value = value;
    s.addEventListener('change', function () { onChange(s.value); saveUISoon(); renderExportOutputs(); });
    wrap.appendChild(s);
    return wrap;
  }

  function optCheck(label, value, onChange) {
    var wrap = el('label', 'chk');
    var c = el('input');
    c.type = 'checkbox';
    c.checked = value;
    c.addEventListener('change', function () { onChange(c.checked); saveUISoon(); renderExportOutputs(); });
    wrap.appendChild(c);
    wrap.appendChild(document.createTextNode(label));
    return wrap;
  }

  function optText(label, value, onChange) {
    var wrap = el('label', 'opt');
    wrap.appendChild(el('span', null, label));
    var i = el('input', 'cell');
    i.value = value;
    i.maxLength = 40;
    i.spellcheck = false;
    i.addEventListener('input', function () { onChange(i.value); saveUISoon(); renderExportOutputs(); });
    wrap.appendChild(i);
    return wrap;
  }

  function renderExportOptions() {
    var x = state.ui.exp, host = $('export-opts');
    host.textContent = '';
    if (cfg().groups.length > 1) {
      host.appendChild(optSelect('Gruppi', [['all', 'Tutti i gruppi'], ['active', 'Solo «' + grp().name + '»']], x.scope,
        function (v) { x.scope = v; }));
    }
    if (x.fmt === 'tsv' || x.fmt === 'csv') {
      host.appendChild(optSelect('Tabella', [['long', 'Una riga per blocco'], ['wide', 'Una riga per elemento']], x.table,
        function (v) { x.table = v; }));
      if (x.fmt === 'csv') {
        host.appendChild(optSelect('Separatore', [[';', 'Punto e virgola ;'], [',', 'Virgola ,'], ['tab', 'Tabulazione']], x.sep,
          function (v) { x.sep = v; }));
      }
      host.appendChild(optCheck('Intestazioni', x.headers, function (v) { x.headers = v; }));
    }
    if (x.fmt === 'st') {
      host.appendChild(optText('Nome struttura', x.stType, function (v) { x.stType = v; }));
      host.appendChild(optSelect('Indice array da', [['1', '1'], ['0', '0']], String(x.stBase), function (v) { x.stBase = Number(v); }));
      host.appendChild(optCheck('Costanti (VAR_GLOBAL CONSTANT)', x.stConst, function (v) { x.stConst = v; }));
    }
    host.hidden = !host.childNodes.length;
  }

  function codeBox(label, text, filename, mime, bom) {
    var box = el('div', 'code-box');
    var head = el('div', 'code-head');
    head.appendChild(el('span', 'code-label', label));
    var actions = el('div', 'code-actions');
    var copy = iconButton('btn primary', 'copy', 'Copia');
    copy.addEventListener('click', function () {
      DLC.copyText(text).then(function (ok) {
        toast(ok ? 'Copiato negli appunti' : 'Copia non riuscita', ok ? null : { kind: 'err' });
      });
    });
    var dl = iconButton('btn', 'download', 'Scarica');
    dl.addEventListener('click', function () { DLC.download(filename, (bom ? '﻿' : '') + text, mime); });
    actions.appendChild(copy);
    actions.appendChild(dl);
    head.appendChild(actions);
    box.appendChild(head);
    var ta = el('textarea', 'code');
    ta.readOnly = true;
    ta.spellcheck = false;
    ta.setAttribute('wrap', 'off');
    ta.setAttribute('aria-label', label);
    ta.value = text;
    ta.rows = Math.min(16, Math.max(5, text.split('\n').length + 1));
    box.appendChild(ta);
    return box;
  }

  function renderExportOutputs() {
    var x = state.ui.exp, host = $('export-outputs'), res = state.result;
    host.textContent = '';
    var filter = cfg().groups.length > 1 && x.scope === 'active' ? [state.ui.active] : null;
    var base = DLC.slug(cfg().name);
    if (x.fmt === 'st') {
      var st = X.toST(res, { typeName: x.stType, base: x.stBase, constant: x.stConst, groups: filter });
      host.appendChild(codeBox('1 · DUT — in CODESYS: Aggiungi oggetto › DUT (struttura), poi incolla', st.dut, base + '_DUT.txt'));
      host.appendChild(codeBox('2 · GVL — in CODESYS: Aggiungi oggetto › Lista variabili globali (es. GVL_Layout), poi incolla',
        st.gvl, base + '_GVL.txt'));
      return;
    }
    var text, file, mime = 'text/plain;charset=utf-8', bom = false, label;
    if (x.fmt === 'tsv' || x.fmt === 'csv') {
      var list = X.buildSheets(res, { view: x.table, groups: filter });
      if (x.fmt === 'tsv') {
        text = X.sheetsToTSV(list, { headers: x.headers });
        file = base + '_coordinate.tsv';
        mime = 'text/tab-separated-values;charset=utf-8';
        label = 'Testo con tabulazioni: copialo e incollalo direttamente in Excel';
      } else {
        text = X.sheetsToCSV(list, { sep: x.sep === 'tab' ? '\t' : x.sep, headers: x.headers });
        file = base + '_coordinate.csv';
        mime = 'text/csv;charset=utf-8';
        bom = true;
        label = 'File CSV per Excel (UTF-8)';
      }
    } else if (x.fmt === 'txt') {
      text = X.toText(res, { groups: filter });
      file = base + '_coordinate.txt';
      label = 'Elenco leggibile delle coordinate';
    } else {
      text = X.toJSON(res, { groups: filter });
      file = base + '_coordinate.json';
      mime = 'application/json';
      label = 'Dati strutturati (JSON)';
    }
    host.appendChild(codeBox(label, text, file, mime, bom));
  }

  /* ------------------------------------------------------------------ */
  /*  Finestre, avvisi, scorciatoie                                      */
  /* ------------------------------------------------------------------ */

  function bindDialogs() {
    ['dlg-configs', 'dlg-export', 'dlg-help'].forEach(function (id) {
      var d = $(id), downOnBackdrop = false;
      d.addEventListener('mousedown', function (e) { downOnBackdrop = e.target === d; });
      d.addEventListener('click', function (e) {
        if (downOnBackdrop && e.target === d) d.close();
        downOnBackdrop = false;
      });
    });
    $('btn-save-confirm').addEventListener('click', function () { doSave($('save-name').value); });
    $('save-name').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doSave(this.value); }
    });
  }

  function toast(msg, o) {
    o = o || {};
    var t = $('toast');
    var host = document.querySelector('dialog[open]') || document.body;
    if (t.parentNode !== host) host.appendChild(t);
    t.textContent = '';
    t.className = 'toast' + (o.kind ? ' ' + o.kind : '');
    t.appendChild(el('span', null, msg));
    if (o.action) {
      var b = el('button', null, o.action.label);
      b.type = 'button';
      b.addEventListener('click', function () { hide(); o.action.fn(); });
      t.appendChild(b);
    }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hide, o.timeout || (o.action ? 5000 : 2400));
    function hide() { t.hidden = true; }
  }

  function bindShortcuts() {
    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      var k = (e.key || '').toLowerCase(), t = e.target;
      var inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (k === 's') {
        e.preventDefault();
        doSave(cfg().name);
      } else if (!inField && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (!inField && (k === 'y' || (k === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      }
    });
    window.addEventListener('beforeunload', saveDraftNow);
    window.addEventListener('scroll', hideTip, { passive: true });
  }

  /* ------------------------------------------------------------------ */
  /*  Avvio                                                              */
  /* ------------------------------------------------------------------ */

  function init() {
    DLC.icons.apply(document);
    state.ui = loadUI();
    applyTheme();

    var stored = S.loadDraft();
    state.config = L.normalizeConfig(stored || L.defaultConfig());
    clampActive();
    hist.last = snapshot();

    var link = S.readHash();
    if (link) {
      S.clearHash();
      if (link.config) {
        state.config = L.normalizeConfig(link.config);
        state.ui.active = 0;
        commit();
      }
    }

    buildPresets();
    preview = new DLC.Preview($('preview-wrap'), $('preview'), {
      onHover: onPreviewHover,
      onMove: onPreviewMove,
      onClick: onPreviewClick,
      onCursor: onCursor
    });
    blockTable = new E.BlockTable($('blocks-editor'), {
      group: grp,
      config: cfg,
      limits: LIM,
      onLive: scheduleRecompute,
      onStructural: function () { blockTable.render(); recompute(); },
      commit: commit,
      toast: function (msg, undoable) { toast(msg, undoable ? { action: { label: 'Annulla', fn: undo } } : null); }
    });

    bindEditor();
    bindToolbar();
    bindPreviewTools();
    bindOutputTools();
    bindDialogs();
    bindShortcuts();
    renderViewSeg();
    renderSheetHint();
    renderAll();
    saveDraftNow();

    if (link && link.config) toast('Layout caricato dal link condiviso', { action: { label: 'Annulla', fn: undo } });
    else if (link && link.error) toast('Il link non contiene un layout valido', { kind: 'err' });
    else if (!S.available) toast('Salvataggio nel browser non disponibile: usa “Esporta” per conservare il lavoro', { kind: 'warn', timeout: 6000 });
  }

  init();
}());
