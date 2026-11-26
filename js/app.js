/*
 * app.js — Interfaccia del Configuratore Layout Display.
 *
 * Collega: struttura (frame e gruppi) → calcolo del layout → anteprima SVG e
 * tabella delle coordinate; gestisce salvataggi, annulla/ripristina,
 * esportazioni, tema e colore dell'interfaccia.
 */
(function () {
  'use strict';

  var DLC = window.DLC;
  var L = DLC.layout, X = DLC.exporters, S = DLC.storage, E = DLC.editor, R = DLC.ral;
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
  var DEFAULT_ACCENT = '#005eb8';
  var ACCENTS = [
    ['#005eb8', 'Blu industriale (predefinito)'],
    ['#0b3d91', 'Blu notte'],
    ['#0077c8', 'Azzurro'],
    ['#00838f', 'Petrolio'],
    ['#107c41', 'Verde'],
    ['#c25e00', 'Arancio'],
    ['#b3261e', 'Rosso'],
    ['#6b3fa0', 'Viola'],
    ['#4a5560', 'Grafite']
  ];

  function defaultUI() {
    return {
      selected: '',
      view: 'long',
      coord: 'frame',
      zoom: 'fit',
      showGrid: true,
      showNames: true,
      showCoords: true,
      solid: false,
      autoCopy: true,
      onlyActive: false,
      theme: 'auto',
      accent: DEFAULT_ACCENT,
      exp: { fmt: 'tsv', table: 'long', headers: true, sep: ';', stType: 'ST_VisuRect', stBase: 1, stConst: true, scope: 'all', coord: 'frame' }
    };
  }

  var state = { config: null, ui: null, result: null, itemMap: {}, sheetsData: [] };
  var hist = { past: [], future: [], last: '' };
  var fields = [];
  var sheets = [];
  var preview = null, blockTable = null, frameColor = null;
  var raf = 0, draftTimer = 0, uiTimer = 0, toastTimer = 0;

  /* ------------------------------------------------------------------ */
  /*  Utilità                                                            */
  /* ------------------------------------------------------------------ */

  function $(id) { return document.getElementById(id); }
  function cfg() { return state.config; }
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

  function fileBase() {
    return DLC.slug(cfg().name) + '_' + cfg().display.width + 'x' + cfg().display.height;
  }

  /* Nodo selezionato nella struttura (sempre valido). */
  function selInfo() {
    var f = L.findNode(cfg(), state.ui.selected);
    if (!f) {
      state.ui.selected = cfg().nodes[0].id;
      f = L.findNode(cfg(), state.ui.selected);
    }
    return f;
  }
  function sel() { return selInfo().node; }
  function selEntry() { return state.result ? state.result.nodes[sel().id] : null; }

  function coordMode() {
    return state.result && state.result.hasFrames ? state.ui.coord : 'display';
  }

  /* ------------------------------------------------------------------ */
  /*  Preferenze, tema e colore                                          */
  /* ------------------------------------------------------------------ */

  function loadUI() {
    var u = S.loadUI(), d = defaultUI();
    if (!u || typeof u !== 'object') return d;
    if (typeof u.selected === 'string') d.selected = u.selected.slice(0, 40);
    if (u.view === 'long' || u.view === 'wide') d.view = u.view;
    if (u.coord === 'frame' || u.coord === 'display') d.coord = u.coord;
    if (ZOOMS.indexOf(String(u.zoom)) !== -1) d.zoom = String(u.zoom);
    ['showGrid', 'showNames', 'showCoords', 'solid', 'autoCopy', 'onlyActive'].forEach(function (k) {
      if (typeof u[k] === 'boolean') d[k] = u[k];
    });
    if (THEMES.indexOf(u.theme) !== -1) d.theme = u.theme;
    d.accent = L.cleanColor(u.accent, DEFAULT_ACCENT);
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
      if (x.coord === 'frame' || x.coord === 'display') d.exp.coord = x.coord;
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
    $('theme-label').textContent = THEME_LABEL[t];
    $('btn-theme').title = 'Tema: ' + THEME_LABEL[t].toLowerCase() + ' (clic per cambiare)';
  }

  function applyAccent() {
    var c = L.cleanColor(state.ui.accent, DEFAULT_ACCENT);
    var root = document.documentElement;
    root.style.setProperty('--acc', c);
    root.style.setProperty('--on-acc', DLC.preview.luminance(c) > 0.6 ? '#111827' : '#ffffff');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', c);
  }

  function setAccent(c) {
    state.ui.accent = L.cleanColor(c, DEFAULT_ACCENT);
    applyAccent();
    saveUISoon();
    renderAccentMenu();
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
    if (ok) {
      var t = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      label.textContent = 'Salvato in questo browser · ' + t;
    } else {
      label.textContent = 'Salvataggio nel browser non disponibile';
    }
    label.classList.toggle('off', !ok);
  }

  function snapshot() { return JSON.stringify(state.config); }

  function commit() {
    if (raf) recompute(); // una modifica confermata (Invio, Tab, uscita dalla cella) si vede subito
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
    renderAll();
  }

  function redo() {
    if (!hist.future.length) { toast('Niente da ripristinare'); return; }
    hist.past.push(hist.last);
    hist.last = hist.future.pop();
    state.config = JSON.parse(hist.last);
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
    selInfo();
    syncFields();
    renderNodeEditor();
    blockTable.render();
    recompute();
  }

  function scheduleRecompute() {
    if (!raf) raf = requestAnimationFrame(function () { raf = 0; recompute(); });
  }

  function recompute() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    state.result = L.computeLayout(state.config);
    state.itemMap = {};
    state.result.items.forEach(function (it) { state.itemMap[it.key] = it; });
    renderTree();
    renderNodeInfo();
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
    if (frameColor && sel().type === 'frame' && document.activeElement !== $('frame-color')) frameColor.refresh();
  }

  /* --- struttura ----------------------------------------------------- */

  function nodeMeta(n, e) {
    var c = e && e.contexts[0];
    if (n.type === 'frame') {
      if (n.mode !== 'fixed') return 'riempie l\'area';
      return '×' + (c ? c.count : 0) + ' · ' + n.width + '×' + n.height;
    }
    return (c ? c.count : 0) + ' el.';
  }

  function renderTree() {
    var host = $('tree');
    var hadFocus = document.activeElement && document.activeElement.classList.contains('tree-row');
    host.textContent = '';
    var d = cfg().display;
    var root = el('div', 'tree-root');
    root.innerHTML = DLC.icons.get('display');
    root.appendChild(el('span', null, 'Display ' + d.width + ' × ' + d.height + ' px'));
    host.appendChild(root);
    var focusRow = null;
    L.listNodes(cfg()).forEach(function (x) {
      var n = x.node, e = state.result.nodes[n.id], selected = n.id === state.ui.selected;
      var row = el('button', 'tree-row' + (selected ? ' sel' : '') + (n.type === 'frame' ? ' is-frame' : ''));
      row.type = 'button';
      row.setAttribute('role', 'treeitem');
      row.setAttribute('aria-level', String(x.depth + 1));
      row.setAttribute('aria-selected', String(selected));
      row.style.paddingLeft = (10 + (x.depth + 1) * 16) + 'px';
      row.innerHTML = DLC.icons.get(n.type === 'frame' ? 'frame' : 'group');
      var dot = el('span', 'dot');
      dot.style.background = n.type === 'frame' ? n.color : n.blocks[0].color;
      row.appendChild(dot);
      row.appendChild(el('span', 'tree-name', n.name));
      row.appendChild(el('span', 'tree-meta', nodeMeta(n, e)));
      if (e && (e.out.area || e.items.some(function (it) { return it.overlap; }))) {
        var w = el('span', 'tree-warn');
        w.innerHTML = DLC.icons.get('warn');
        w.title = 'Ci sono oggetti fuori dall\'area o sovrapposti';
        row.appendChild(w);
      }
      row.title = n.type === 'frame' ? 'Frame: contenitore di altri gruppi e frame' : 'Gruppo di elementi';
      row.addEventListener('click', function () { select(n.id); });
      if (selected) focusRow = row;
      host.appendChild(row);
    });
    if (hadFocus && focusRow) focusRow.focus();

    var info = selInfo(), total = L.countNodes(cfg().nodes);
    $('btn-node-up').disabled = info.index === 0;
    $('btn-node-down').disabled = info.index === info.list.length - 1;
    $('btn-node-del').disabled = total <= 1;
    $('btn-node-dup').disabled = total + L.countNodes([info.node]) > LIM.maxNodes;
    $('btn-node-wrap').disabled = total >= LIM.maxNodes || info.depth + 1 + L.subtreeHeight(info.node) > LIM.maxDepth;
    $('btn-add-group').disabled = total >= LIM.maxNodes;
    $('btn-add-frame').disabled = total >= LIM.maxNodes ||
      (info.node.type === 'frame' ? info.depth + 1 : info.depth) > LIM.maxDepth;
  }

  /* --- editor del nodo selezionato --------------------------------- */

  function renderNodeEditor() {
    var info = selInfo(), n = info.node, isFrame = n.type === 'frame';
    var kind = $('node-kind');
    kind.textContent = isFrame ? 'Frame' : 'Gruppo';
    kind.className = 'kind-badge ' + (isFrame ? 'frame' : 'group');

    var parentSel = $('node-parent');
    parentSel.textContent = '';
    L.containers(cfg(), n.id).forEach(function (c) {
      var o = el('option', null, c.depth < 0 ? 'Display' : new Array(c.depth + 2).join('  ') + '▣ ' + c.name);
      o.value = c.id;
      parentSel.appendChild(o);
    });
    parentSel.value = info.parent ? info.parent.id : '';

    $('area-sub').textContent = info.parent ? 'offset dai bordi del frame «' + info.parent.name + '»' : 'offset dai bordi del display';
    $('sec-blocks').hidden = isFrame;
    $('sec-frame').hidden = !isFrame;
    $('sec-layout').hidden = isFrame && n.mode !== 'fixed';
    $('layout-title').textContent = isFrame ? 'Ripetizione del frame' : 'Disposizione degli elementi';
    $('count-label').textContent = isFrame ? 'Numero di frame' : 'Numero elementi';

    Array.prototype.forEach.call(document.querySelectorAll('#dir-seg button'), function (b) {
      var on = !isFrame && b.getAttribute('data-dir') === n.direction;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    Array.prototype.forEach.call(document.querySelectorAll('#frame-mode-seg button'), function (b) {
      var on = isFrame && b.getAttribute('data-mode') === n.mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    if (isFrame) {
      $('frame-size').hidden = n.mode !== 'fixed';
      frameColor.refresh();
    }
  }

  function fitLine(label, value) {
    var p = el('p', 'fit-line');
    p.appendChild(el('span', 'k', label));
    p.appendChild(el('span', 'v', value));
    return p;
  }

  function renderNodeInfo() {
    var info = selInfo(), n = info.node, e = selEntry(), c = e && e.contexts[0];
    var isFrame = n.type === 'frame';

    // Area di lavoro nel contenitore
    var box = $('area-info');
    box.textContent = '';
    box.classList.toggle('invalid', !!c && !c.region.valid);
    if (!c) {
      box.appendChild(el('strong', null, '—'));
      box.appendChild(el('span', null, 'il frame contenitore non ha copie'));
    } else {
      box.appendChild(el('strong', null, c.region.valid ? c.region.w + ' × ' + c.region.h + ' px' : 'Area non valida'));
      box.appendChild(el('span', null, c.region.valid
        ? 'X ' + (c.region.x - c.origin.x) + ' · Y ' + (c.region.y - c.origin.y) + (info.parent ? ' nel frame' : '')
        : 'gli offset superano il contenitore'));
    }

    // Gruppo: ingombro dell'elemento; frame: dimensione e copie
    if (!isFrame) {
      var parts = [];
      n.blocks.forEach(function (b) {
        if (b.gap) parts.push(b.gap < 0 ? '(' + b.gap + ')' : String(b.gap));
        parts.push(String(n.direction === 'v' ? b.height : b.width));
      });
      var el0 = c ? c.element : L.elementGeometry(n);
      var txt = 'Elemento: ' + el0.w + ' × ' + el0.h + ' px';
      if (parts.length > 1) txt += ' — ' + (n.direction === 'v' ? 'altezza ' : 'larghezza ') + parts.join(' + ');
      $('element-info').textContent = txt;
    } else {
      var fi = $('frame-info');
      fi.textContent = '';
      if (c) {
        var line = 'Frame: ' + c.size.w + ' × ' + c.size.h + ' px';
        line += n.mode === 'fixed' ? ' · ' + c.count + ' ' + plural(c.count, 'copia', 'copie') : ' (riempie l\'area)';
        fi.appendChild(el('span', null, line));
      }
      fi.appendChild(el('span', 'muted', ' · contiene ' + n.children.length + ' ' + plural(n.children.length, 'oggetto', 'oggetti')));
    }

    // Distanze calcolate automaticamente con "Distribuisci"
    var cg = $('col-gap'), rg = $('row-gap');
    cg.disabled = n.alignH === 'distribute';
    rg.disabled = n.alignV === 'distribute';
    cg.title = cg.disabled ? 'Calcolata automaticamente (allineamento “Distribuisci”)' : 'Distanza orizzontale tra le colonne';
    rg.title = rg.disabled ? 'Calcolata automaticamente (allineamento “Distribuisci”)' : 'Distanza verticale tra le righe';

    // Riepilogo della griglia
    var fit = $('fit-info');
    fit.textContent = '';
    if (isFrame && n.mode !== 'fixed') return;
    var what = isFrame ? ['frame', 'frame'] : ['elemento', 'elementi'];
    if (!c) {
      fit.appendChild(el('p', 'fit-line', 'Nessuna copia: il frame che contiene questo ' + (isFrame ? 'frame' : 'gruppo') + ' non ha copie.'));
      return;
    }
    if (!c.count) {
      fit.appendChild(el('p', 'fit-line', 'Nessun ' + what[0] + ': imposta il numero.'));
    } else {
      fit.appendChild(fitLine('Griglia', c.rows + ' ' + plural(c.rows, 'riga', 'righe') + ' × ' + c.cols + ' ' +
        plural(c.cols, 'colonna', 'colonne') + ' · ingombro ' + c.grid.w + ' × ' + c.grid.h + ' px'));
      if (c.region.valid) fit.appendChild(fitLine('Spazio libero', c.free.w + ' px orizz. · ' + c.free.h + ' px vert.'));
      if (n.alignH === 'distribute' && c.cols > 1) fit.appendChild(fitLine('Dist. colonne', '≈ ' + fmtNum(c.gaps.col) + ' px (calcolata)'));
      if (n.alignV === 'distribute' && c.rows > 1) fit.appendChild(fitLine('Dist. righe', '≈ ' + fmtNum(c.gaps.row) + ' px (calcolata)'));
      if (e.contexts.length > 1) {
        fit.appendChild(fitLine('Copie', 'ripetuto in ' + e.contexts.length + ' frame «' + (info.parent ? info.parent.name : '') + '»'));
      }
    }

    var fr = c.fit.rows, fc = c.fit.cols, finite = isFinite(fr) && isFinite(fc);
    var row = el('div', 'fit-row');
    row.appendChild(el('span', null, finite
      ? 'Nell\'area entrano al massimo ' + fr + ' ' + plural(fr, 'riga', 'righe') + ' × ' + fc + ' ' + plural(fc, 'colonna', 'colonne')
      : 'Con distanze negative non c\'è un limite di spazio'));
    if (finite && fr > 0 && fc > 0) {
      var cols = Math.max(1, Math.min(n.columns, fc));
      var cnt = Math.min(LIM.count[1], fr * cols);
      if (cnt !== n.count || cols !== n.columns) {
        var fillBtn = el('button', 'link-btn', 'Riempi: ' + fr + ' × ' + cols + ' = ' + cnt);
        fillBtn.type = 'button';
        fillBtn.title = 'Imposta il numero che riempie l\'area';
        fillBtn.addEventListener('click', function () {
          change(function () { var x = sel(); x.columns = cols; x.count = cnt; }, { sync: true });
          toast('Area riempita: ' + cnt + ' ' + (cnt === 1 ? what[0] : what[1]), { action: { label: 'Annulla', fn: undo } });
        });
        row.appendChild(fillBtn);
      }
    }
    fit.appendChild(row);

    if (e.out.area) {
      var w = el('p', 'fit-warn');
      w.innerHTML = DLC.icons.get('warn');
      w.appendChild(document.createTextNode(e.out.area + ' ' + plural(e.out.area, 'oggetto esce', 'oggetti escono') +
        ' dall\'area' + (e.out.display ? ' (' + e.out.display + ' anche dal display)' : '')));
      fit.appendChild(w);
    }
  }

  /* --- display ------------------------------------------------------- */

  function buildPresets() {
    var s = $('display-preset');
    s.textContent = '';
    PRESETS.forEach(function (p) {
      var o = el('option', null, p[0] + ' × ' + p[1] + '  —  ' + p[2]);
      o.value = p[0] + 'x' + p[1];
      s.appendChild(o);
    });
    var custom = el('option', null, 'Personalizzato');
    custom.value = 'custom';
    s.appendChild(custom);
  }

  function syncPreset() {
    var d = cfg().display, v = d.width + 'x' + d.height, s = $('display-preset');
    var found = PRESETS.some(function (p) { return p[0] + 'x' + p[1] === v; });
    var rotated = !found && PRESETS.some(function (p) { return p[1] + 'x' + p[0] === v; });
    s.value = found ? v : 'custom';
    s.options[s.options.length - 1].textContent = rotated ? 'Personalizzato (verticale)' : 'Personalizzato';
  }

  /* --- anteprima e tabella ------------------------------------------ */

  function previewView() {
    var many = L.countNodes(cfg().nodes) > 1;
    return {
      selected: sel().id,
      focus: many ? L.descendantIds(sel()) : null,
      coord: coordMode(),
      zoom: state.ui.zoom,
      showGrid: state.ui.showGrid,
      showNames: state.ui.showNames,
      showCoords: state.ui.showCoords,
      solid: state.ui.solid
    };
  }

  function renderPreview() {
    $('preview-size').textContent = cfg().display.width + ' × ' + cfg().display.height + ' px';
    preview.render(state.result, previewView());
  }

  function outputFilter() {
    if (!state.ui.onlyActive || L.countNodes(cfg().nodes) < 2) return null;
    return L.descendantIds(sel());
  }

  function renderSegs() {
    [['#view-seg button', 'data-view', state.ui.view], ['#coord-seg button', 'data-coord', state.ui.coord]].forEach(function (s) {
      Array.prototype.forEach.call(document.querySelectorAll(s[0]), function (b) {
        var on = b.getAttribute(s[1]) === s[2];
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      });
    });
  }

  function renderOutput() {
    var multi = L.countNodes(cfg().nodes) > 1;
    $('only-active-wrap').hidden = !multi;
    $('only-active-label').textContent = 'Solo «' + sel().name + '»';
    $('coord-wrap').hidden = !state.result.hasFrames;
    var data = X.buildSheets(state.result, { view: state.ui.view, coord: coordMode(), nodes: outputFilter() });
    while (sheets.length < data.length) sheets.push(makeSheet());
    while (sheets.length > data.length) sheets.pop().destroy();
    data.forEach(function (d, i) { sheets[i].setData(d); });
    state.sheetsData = data;
    renderSummary();
  }

  function badge(host, kind, text, icon) {
    var b = el('span', 'badge' + (kind ? ' ' + kind : ''));
    if (icon) b.innerHTML = DLC.icons.get(icon);
    b.appendChild(document.createTextNode(text));
    host.appendChild(b);
  }

  function renderSummary() {
    var host = $('summary');
    host.textContent = '';
    var coord = coordMode(), filter = outputFilter();
    var items = X.pickItems(state.result, { coord: coord, nodes: filter });
    var blocks = 0, frames = 0, outA = 0, outD = 0, ovl = 0, elements = {};
    items.forEach(function (it) {
      if (it.kind === 'frame') frames++;
      else { blocks++; elements[it.groupKey + ':' + it.n] = 1; }
      if (it.outArea) outA++;
      if (it.outDisplay) outD++;
      if (it.overlap) ovl++;
    });
    var nEl = Object.keys(elements).length;
    badge(host, '', nEl + ' ' + plural(nEl, 'elemento', 'elementi') + ' · ' + blocks + ' ' + plural(blocks, 'blocco', 'blocchi') +
      (frames ? ' · ' + frames + ' frame' : ''), 'table');
    if (outD) badge(host, 'err', outD + ' fuori dal display', 'warn');
    if (outA) badge(host, 'warn', outA + ' fuori dalla propria area', 'warn');
    if (ovl) badge(host, 'warn', ovl + ' ' + plural(ovl, 'sovrapposto', 'sovrapposti') + ' ad altri oggetti', 'warn');
    if (state.result.truncated) badge(host, 'err', 'Mostrati solo i primi ' + LIM.maxTotalItems + ' oggetti', 'warn');
    if (items.length && !outA && !outD && !ovl) badge(host, 'ok', 'Tutto dentro le aree', 'check');
    if (coord === 'frame' && state.result.items.some(function (it) { return it.dup; })) {
      badge(host, 'info', 'Contenuto dei frame ripetuti mostrato una volta (coordinate uguali in ogni copia)', 'frame');
    }
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
    var it = key ? state.itemMap[key] : null;
    sheets.forEach(function (s) { s.hoverKey(it ? (s.keyRow[key] != null ? key : it.twin) : null); });
    if (!it) {
      hideTip();
      $('hover-info').textContent = '';
      return;
    }
    var X0 = coordMode() === 'display' ? it.x : it.rx, Y0 = coordMode() === 'display' ? it.y : it.ry;
    $('hover-info').textContent = (it.kind === 'frame' ? 'Frame ' + it.label : it.name + ' ' + it.n) +
      ': X ' + X0 + ' · Y ' + Y0 + ' · ' + it.w + ' × ' + it.h + ' px';
    showTip(it, e);
  }

  function onPreviewMove(e) {
    if (!$('tooltip').hidden) placeTip(e);
  }

  function onPreviewClick(key) {
    var it = state.itemMap[key];
    if (!it) return;
    if (it.node !== state.ui.selected) select(it.node);
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].selectKey(key) || (it.twin !== key && sheets[i].selectKey(it.twin))) break;
    }
  }

  function onCursor(pt) {
    $('cursor-pos').textContent = pt ? 'Cursore  X ' + pt.x + ' · Y ' + pt.y : 'Cursore  X — · Y —';
  }

  function showTip(it, e) {
    var t = $('tooltip');
    t.textContent = '';
    var title = el('div', 'tip-title');
    title.appendChild(el('b', null, it.kind === 'frame' ? 'Frame ' + it.label : it.name + ' ' + it.n));
    t.appendChild(title);
    if (it.depth > 0 || L.countNodes(cfg().nodes) > 1) t.appendChild(el('div', 'tip-dim', it.path));
    if (it.depth > 0) {
      t.appendChild(el('div', null, 'Nel frame:  X ' + it.rx + '   Y ' + it.ry));
      t.appendChild(el('div', null, 'Sul display:  X ' + it.x + '   Y ' + it.y));
    } else {
      t.appendChild(el('div', null, 'X ' + it.x + '   Y ' + it.y));
    }
    t.appendChild(el('div', 'tip-dim', it.w + ' × ' + it.h + ' px · ' + R.format(it.color, it.ral)));
    if (it.outDisplay) t.appendChild(el('div', 'tip-warn', 'Fuori dal display'));
    else if (it.outArea) t.appendChild(el('div', 'tip-warn', 'Fuori dalla propria area'));
    if (it.overlap) t.appendChild(el('div', 'tip-warn', 'Sovrapposto ad altri oggetti'));
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
    mutator(state.config);
    if (opts.structural) renderAll();
    else {
      if (opts.sync) syncFields();
      recompute();
    }
    commit();
  }

  function select(id) {
    if (id === state.ui.selected) return;
    state.ui.selected = id;
    saveUISoon();
    sheets.forEach(function (s) { s.clear(true); });
    onSheetSelect(null);
    renderAll();
  }

  function addNode(kind) {
    if (L.countNodes(cfg().nodes) >= LIM.maxNodes) {
      toast('Massimo ' + LIM.maxNodes + ' oggetti nella struttura', { kind: 'warn' });
      return;
    }
    commit();
    var info = selInfo();
    var parent = info.node.type === 'frame' ? info.node : info.parent;
    var node = kind === 'frame' ? L.newFrame(cfg())
      : L.newGroup(cfg(), parent ? parent.id : '', info.node.type === 'frame' ? '' : info.node.id);
    var res = L.insertNode(cfg(), node, info.node.id);
    if (!res) {
      toast('Non si possono annidare più di ' + LIM.maxDepth + ' livelli di frame', { kind: 'warn' });
      return;
    }
    state.ui.selected = node.id;
    saveUISoon();
    renderAll();
    commit();
    toast((kind === 'frame' ? 'Aggiunto il frame «' : 'Aggiunto il gruppo «') + node.name + '» ' +
      (res.parent ? 'dentro «' + res.parent.name + '»' : 'sul display'), { action: { label: 'Annulla', fn: undo } });
  }

  function nodeAction(action) {
    var info = selInfo(), id = info.node.id, name = info.node.name;
    commit();
    if (action === 'up' || action === 'down') {
      if (!L.moveSibling(cfg(), id, action === 'up' ? -1 : 1)) return;
      renderAll();
      commit();
      return;
    }
    if (action === 'wrap') {
      var frame = L.wrapInFrame(cfg(), id);
      if (!frame) { toast('Limite di annidamento raggiunto', { kind: 'warn' }); return; }
      state.ui.selected = frame.id;
      saveUISoon();
      renderAll();
      commit();
      toast('«' + name + '» è ora dentro «' + frame.name + '»: le coordinate sul display non cambiano', { action: { label: 'Annulla', fn: undo } });
      return;
    }
    if (action === 'dup') {
      var copy = L.duplicateNode(cfg(), id);
      if (!copy) { toast('Limite di ' + LIM.maxNodes + ' oggetti raggiunto', { kind: 'warn' }); return; }
      state.ui.selected = copy.id;
      saveUISoon();
      renderAll();
      commit();
      toast('Duplicato «' + name + '»', { action: { label: 'Annulla', fn: undo } });
      return;
    }
    if (action === 'del') {
      var next = info.list[info.index - 1] || info.list[info.index + 1] || info.parent;
      if (!L.removeNode(cfg(), id)) return;
      state.ui.selected = next ? next.id : cfg().nodes[0].id;
      saveUISoon();
      renderAll();
      commit();
      toast('Eliminato «' + name + '»' + (info.node.type === 'frame' && info.node.children.length ? ' con il suo contenuto' : ''),
        { action: { label: 'Annulla', fn: undo } });
    }
  }

  function loadConfig(config, message) {
    commit();
    state.config = L.normalizeConfig(JSON.parse(JSON.stringify(config)));
    state.ui.selected = state.config.nodes[0].id;
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

  function frameOnly(fn) {
    return function () { var n = sel(); return n.type === 'frame' ? fn(n) : ''; };
  }

  function bindEditor() {
    bindTxt('cfg-name', function () { return cfg().name; }, function (v) { cfg().name = v; },
      function () { return 'Layout display'; }, LIM.configNameLength);

    // Display
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

    // Struttura
    $('btn-add-group').addEventListener('click', function () { addNode('group'); });
    $('btn-add-frame').addEventListener('click', function () { addNode('frame'); });
    [['btn-node-up', 'up'], ['btn-node-down', 'down'], ['btn-node-wrap', 'wrap'], ['btn-node-dup', 'dup'], ['btn-node-del', 'del']]
      .forEach(function (p) { $(p[0]).addEventListener('click', function () { nodeAction(p[1]); }); });

    // Nodo selezionato
    bindTxt('node-name', function () { return sel().name; }, function (v) { sel().name = v; },
      function () { return sel().type === 'frame' ? 'Frame' : 'Gruppo'; }, LIM.nameLength);
    $('node-parent').addEventListener('change', function () {
      var target = this.value, name = sel().name;
      commit();
      if (L.moveTo(cfg(), sel().id, target)) {
        renderAll();
        commit();
        var t = target ? L.findNode(cfg(), target).node.name : 'Display';
        toast('«' + name + '» spostato in «' + t + '»: gli offset ora si riferiscono al nuovo contenitore',
          { action: { label: 'Annulla', fn: undo } });
      } else {
        renderNodeEditor();
        toast('Spostamento non possibile', { kind: 'warn' });
      }
    });

    ['top', 'left', 'right', 'bottom'].forEach(function (side) {
      bindNum('off-' + side, function () { return sel().area[side]; }, function (v) { sel().area[side] = v; }, LIM.offset);
    });

    // Gruppo: blocchi
    Array.prototype.forEach.call(document.querySelectorAll('#dir-seg button'), function (b) {
      b.addEventListener('click', function () {
        var dir = b.getAttribute('data-dir');
        if (sel().type !== 'group' || sel().direction === dir) return;
        change(function () { sel().direction = dir; }, { structural: true });
      });
    });
    $('btn-add-block').addEventListener('click', function () { blockTable.add(); });

    // Frame
    Array.prototype.forEach.call(document.querySelectorAll('#frame-mode-seg button'), function (b) {
      b.addEventListener('click', function () {
        var mode = b.getAttribute('data-mode'), n = sel();
        if (n.type !== 'frame' || n.mode === mode) return;
        change(function () {
          n.mode = mode;
          if (mode === 'fixed' && !n.count) n.count = 1;
        }, { structural: true });
      });
    });
    bindNum('frame-w', frameOnly(function (n) { return n.width; }), function (v) { if (sel().type === 'frame') sel().width = v; }, LIM.frameSize);
    bindNum('frame-h', frameOnly(function (n) { return n.height; }), function (v) { if (sel().type === 'frame') sel().height = v; }, LIM.frameSize);
    frameColor = E.bindColor($('frame-color'), $('frame-color-sw'), {
      get: function () { var n = sel(); return n.type === 'frame' ? { color: n.color, ral: n.ral } : { color: '#9da1aa', ral: '' }; },
      set: function (v) { var n = sel(); if (n.type !== 'frame') return; n.color = v.color; n.ral = v.ral; scheduleRecompute(); },
      commit: commit
    });

    // Disposizione / ripetizione
    bindNum('count', function () { return sel().count; }, function (v) { sel().count = v; }, LIM.count);
    bindNum('columns', function () { return sel().columns; }, function (v) { sel().columns = v; }, LIM.columns);
    bindNum('row-gap', function () { return sel().rowGap; }, function (v) { sel().rowGap = v; }, LIM.gap);
    bindNum('col-gap', function () { return sel().colGap; }, function (v) { sel().colGap = v; }, LIM.gap);
    bindSel('order', function () { return sel().order; }, function (v) { sel().order = v; });
    bindSel('align-h', function () { return sel().alignH; }, function (v) { sel().alignH = v; });
    bindSel('align-v', function () { return sel().alignV; }, function (v) { sel().alignV = v; });
  }

  /* ------------------------------------------------------------------ */
  /*  Barra dei comandi                                                  */
  /* ------------------------------------------------------------------ */

  function importFile(file) {
    if (file.size > 2 * 1024 * 1024) { toast('File troppo grande.', { kind: 'err' }); return; }
    DLC.readFile(file).then(function (text) {
      var data = JSON.parse(text);
      var conf = data && data.app === APP_ID && data.config ? data.config : data;
      if (!conf || typeof conf !== 'object' || !conf.display || !(Array.isArray(conf.nodes) || Array.isArray(conf.groups))) {
        throw new Error('formato');
      }
      loadConfig(conf, 'Aperto il file «' + file.name + '»');
    }).catch(function () {
      toast('Il file non contiene un layout valido.', { kind: 'err' });
    });
  }

  function exportConfig() {
    var data = { app: APP_ID, version: 2, exportedAt: new Date().toISOString(), config: cfg() };
    DLC.download(DLC.slug(cfg().name) + '.json', JSON.stringify(data, null, 2), 'application/json');
    toast('File .json scaricato: riaprilo con “Apri file”, anche su un altro PC');
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
    $('save-state').addEventListener('click', function () { openConfigs(false); });
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
    });
    bindAccentMenu();
  }

  /* --- menu Colore dell'interfaccia --------------------------------- */

  function buildAccentMenu() {
    var host = $('accent-swatches');
    host.textContent = '';
    ACCENTS.forEach(function (a) {
      var b = el('button', 'acc-sw');
      b.type = 'button';
      b.style.background = a[0];
      b.title = a[1];
      b.setAttribute('aria-label', a[1]);
      b.setAttribute('data-color', a[0]);
      b.addEventListener('click', function () { setAccent(a[0]); });
      host.appendChild(b);
    });
  }

  function renderAccentMenu() {
    Array.prototype.forEach.call(document.querySelectorAll('#accent-swatches .acc-sw'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-color') === state.ui.accent);
    });
    var code = $('accent-code');
    if (document.activeElement !== code) code.value = state.ui.accent.slice(1).toUpperCase();
    code.classList.remove('invalid');
  }

  function bindAccentMenu() {
    var btn = $('btn-accent'), menu = $('accent-menu');
    function close() {
      menu.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', outside, true);
    }
    function outside(e) {
      if (!menu.contains(e.target) && !btn.contains(e.target)) close();
    }
    btn.addEventListener('click', function () {
      if (!menu.hidden) { close(); return; }
      renderAccentMenu();
      menu.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      var r = btn.getBoundingClientRect();
      menu.style.top = (r.bottom + 6) + 'px';
      menu.style.left = Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8)) + 'px';
      document.addEventListener('mousedown', outside, true);
      var on = menu.querySelector('.acc-sw.on') || menu.querySelector('.acc-sw');
      if (on) on.focus();
    });
    menu.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); btn.focus(); }
    });
    $('accent-code').addEventListener('input', function () {
      var v = R.parse(this.value);
      this.classList.toggle('invalid', !v && this.value.trim() !== '');
      if (v) {
        state.ui.accent = v.color;
        applyAccent();
        saveUISoon();
        Array.prototype.forEach.call(document.querySelectorAll('#accent-swatches .acc-sw'), function (b) {
          b.classList.toggle('on', b.getAttribute('data-color') === v.color);
        });
      }
    });
    $('accent-reset').addEventListener('click', function () { setAccent(DEFAULT_ACCENT); });
  }

  function bindPreviewTools() {
    var z = $('zoom');
    z.value = state.ui.zoom;
    z.addEventListener('change', function () { state.ui.zoom = z.value; saveUISoon(); renderPreview(); });
    [['opt-grid', 'showGrid'], ['opt-names', 'showNames'], ['opt-coords', 'showCoords'], ['opt-solid', 'solid']].forEach(function (p) {
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
        renderSegs();
        renderOutput();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#coord-seg button'), function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-coord');
        if (v === state.ui.coord) return;
        state.ui.coord = v;
        sheets.forEach(function (s) { s.clear(true); });
        onSheetSelect(null);
        saveUISoon();
        renderSegs();
        renderPreview();
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
  /*  Finestra: salva e apri                                             */
  /* ------------------------------------------------------------------ */

  function describe(entry) {
    var c = entry.config || {}, d = c.display || {};
    var list = Array.isArray(c.nodes) ? c.nodes : (Array.isArray(c.groups) ? c.groups : []);
    var n = L.countNodes(list);
    var date = new Date(entry.savedAt), ds = '';
    if (!isNaN(date.getTime())) {
      ds = date.toLocaleDateString('it-IT') + ' ' + date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    }
    return (d.width || '?') + ' × ' + (d.height || '?') + ' px · ' + n + ' ' + plural(n, 'oggetto', 'oggetti') + (ds ? ' · ' + ds : '');
  }

  function renderSavedList() {
    var host = $('saved-list');
    host.textContent = '';
    if (!S.available) {
      host.appendChild(el('p', 'empty', 'Questo browser non permette di salvare (navigazione in incognito o dati del sito bloccati). Usa “Scarica file .json”.'));
      return;
    }
    var list = S.listSaved();
    if (!list.length) {
      host.appendChild(el('p', 'empty', 'Nessun layout salvato in questo browser.'));
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
      toast('Il browser non permette di salvare: usa “Salva file”.', { kind: 'err', timeout: 5000 });
      return;
    }
    saveDraftNow();
    if ($('dlg-configs').open) $('dlg-configs').close();
    toast((r.updated ? 'Aggiornato' : 'Salvato') + ' «' + name + '» in questo browser (lo ritrovi in “Apri”)');
  }

  /* ------------------------------------------------------------------ */
  /*  Finestra: esporta coordinate                                       */
  /* ------------------------------------------------------------------ */

  function openExport() {
    state.ui.exp.table = state.ui.view;
    state.ui.exp.coord = coordMode();
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
    if (L.countNodes(cfg().nodes) > 1) {
      host.appendChild(optSelect('Contenuto', [['all', 'Tutto il layout'], ['active', 'Solo «' + sel().name + '»']], x.scope,
        function (v) { x.scope = v; }));
    }
    if (state.result.hasFrames && x.fmt !== 'json') {
      host.appendChild(optSelect('Coordinate', [['frame', 'Relative al frame (contenuto una volta)'], ['display', 'Assolute sul display (ogni copia)']],
        x.coord, function (v) { x.coord = v; }));
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
    var scoped = L.countNodes(cfg().nodes) > 1 && x.scope === 'active';
    var nodes = scoped ? L.descendantIds(sel()) : null;
    var coord = res.hasFrames ? x.coord : 'display';
    var base = DLC.slug(cfg().name);
    if (x.fmt === 'st') {
      var st = X.toST(res, { typeName: x.stType, base: x.stBase, constant: x.stConst, nodes: nodes, coord: coord });
      host.appendChild(codeBox('1 · DUT — in CODESYS: Aggiungi oggetto › DUT (struttura), poi incolla', st.dut, base + '_DUT.txt'));
      host.appendChild(codeBox('2 · GVL — in CODESYS: Aggiungi oggetto › Lista variabili globali (es. GVL_Layout), poi incolla',
        st.gvl, base + '_GVL.txt'));
      return;
    }
    var text, file, mime = 'text/plain;charset=utf-8', bom = false, label;
    if (x.fmt === 'tsv' || x.fmt === 'csv') {
      var list = X.buildSheets(res, { view: x.table, coord: coord, nodes: nodes });
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
      text = X.toText(res, { coord: coord, nodes: nodes });
      file = base + '_coordinate.txt';
      label = 'Elenco leggibile delle coordinate';
    } else {
      text = X.toJSON(res, { rootId: scoped ? sel().id : null });
      file = base + '_coordinate.json';
      mime = 'application/json';
      label = 'Dati strutturati (JSON): x, y relative al contenitore e displayX, displayY assolute';
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
      d.addEventListener('close', function () { DLC.colorPicker.close(false); });
    });
    $('btn-save-confirm').addEventListener('click', function () { doSave($('save-name').value); });
    $('save-name').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); doSave(this.value); }
    });
    $('dlg-file-save').addEventListener('click', exportConfig);
    $('dlg-file-open').addEventListener('click', function () {
      $('dlg-configs').close();
      $('file-import').click();
    });
    $('dlg-link').addEventListener('click', copyLink);
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
    toastTimer = setTimeout(hide, o.timeout || (o.action ? 5000 : 2600));
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
    applyAccent();

    var stored = S.loadDraft();
    state.config = L.normalizeConfig(stored || L.defaultConfig());
    hist.last = snapshot();

    var link = S.readHash();
    if (link) {
      S.clearHash();
      if (link.config) {
        state.config = L.normalizeConfig(link.config);
        state.ui.selected = state.config.nodes[0].id;
        commit();
      }
    }
    selInfo();

    buildPresets();
    buildAccentMenu();
    preview = new DLC.Preview($('preview-wrap'), $('preview'), {
      onHover: onPreviewHover,
      onMove: onPreviewMove,
      onClick: onPreviewClick,
      onCursor: onCursor
    });
    blockTable = new E.BlockTable($('blocks-editor'), {
      group: sel,
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
    renderSegs();
    renderSheetHint();
    renderAll();
    saveDraftNow();

    if (link && link.config) toast('Layout caricato dal link condiviso', { action: { label: 'Annulla', fn: undo } });
    else if (link && link.error) toast('Il link non contiene un layout valido', { kind: 'err' });
    else if (!S.available) toast('Salvataggio nel browser non disponibile: usa “Salva file” per conservare il lavoro', { kind: 'warn', timeout: 6000 });
  }

  init();
}());
