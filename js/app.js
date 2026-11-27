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
  var I = DLC.issues, Z = DLC.zip, M = DLC.menu;
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
      selected: null,        // null = mai scelto (si seleziona il primo oggetto), '' = nessuna selezione
      view: 'long',
      coord: 'frame',
      zoom: 'fit',
      showGrid: true,
      showNames: true,
      showCoords: true,
      solid: false,
      focusDim: true,
      autoCopy: true,
      onlyActive: false,
      sizes: true,
      colWidths: {},
      hiddenCols: {},
      theme: 'auto',
      accent: DEFAULT_ACCENT,
      exp: { fmt: 'tsv', table: 'long', headers: true, sep: ';', stType: 'ST_VisuRect', stBase: 1, stConst: true, scope: 'all', coord: 'frame', sizes: true },
      img: { scope: 'all', format: 'png', pixels: 1, solid: true, names: true, coords: false, grid: false, problems: false, frameOutline: true, coord: 'frame', bg: 'white' }
    };
  }

  var state = { config: null, ui: null, result: null, itemMap: {}, sheetsData: [], issues: [], issuePanel: null, issueCursor: {}, issueActive: '' };
  var hist = { past: [], future: [], last: '' };
  var fields = [];
  var sheets = [];
  var preview = null, tree = null, blockTable = null, frameColor = null;
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

  /* Nodo selezionato nella struttura, oppure null se non c'è nessuna selezione
     (in quel caso l'anteprima mostra tutto con i colori reali). */
  function selInfo() {
    var id = state.ui.selected;
    if (!id) return null;
    var f = L.findNode(cfg(), id);
    if (!f) state.ui.selected = '';
    return f;
  }
  function sel() { var f = selInfo(); return f ? f.node : null; }
  function selEntry() { var n = sel(); return n && state.result ? state.result.nodes[n.id] : null; }

  /* Valore di un campo dell'oggetto selezionato (stringa vuota se non c'è). */
  function ofSel(fn, fallback) {
    return function () { var n = sel(); return n ? fn(n) : (fallback == null ? '' : fallback); };
  }

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
    ['showGrid', 'showNames', 'showCoords', 'solid', 'focusDim', 'autoCopy', 'onlyActive', 'sizes'].forEach(function (k) {
      if (typeof u[k] === 'boolean') d[k] = u[k];
    });
    if (THEMES.indexOf(u.theme) !== -1) d.theme = u.theme;
    d.accent = L.cleanColor(u.accent, DEFAULT_ACCENT);
    if (u.colWidths && typeof u.colWidths === 'object') {
      Object.keys(u.colWidths).slice(0, 200).forEach(function (k) {
        var w = u.colWidths[k];
        if (typeof w === 'number' && isFinite(w) && w >= 20 && w <= 800 && k.length < 80) d.colWidths[k] = Math.round(w);
      });
    }
    if (u.hiddenCols && typeof u.hiddenCols === 'object') {
      X.HIDEABLE.forEach(function (k) { if (u.hiddenCols[k] === true) d.hiddenCols[k] = true; });
    }
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
      if (typeof x.sizes === 'boolean') d.exp.sizes = x.sizes;
    }
    var im = u.img;
    if (im && typeof im === 'object') {
      if (['all', 'sel', 'layers'].indexOf(im.scope) !== -1) d.img.scope = im.scope;
      if (im.format === 'png' || im.format === 'svg') d.img.format = im.format;
      if ([1, 2, 3].indexOf(im.pixels) !== -1) d.img.pixels = im.pixels;
      ['solid', 'names', 'coords', 'grid', 'problems', 'frameOutline'].forEach(function (k) {
        if (typeof im[k] === 'boolean') d.img[k] = im[k];
      });
      if (im.coord === 'frame' || im.coord === 'display') d.img.coord = im.coord;
      if (im.bg === 'white' || im.bg === 'none') d.img.bg = im.bg;
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
    state.issues = I.build(state.config, state.result);
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
    var n = sel();
    if (frameColor && n && n.type === 'frame' && document.activeElement !== $('frame-color')) frameColor.refresh();
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

  function issuesOf(id) {
    return state.issues.filter(function (i) { return i.nodes.indexOf(id) !== -1; });
  }

  function renderTree() {
    tree.render();
    var info = selInfo(), total = L.countNodes(cfg().nodes), has = !!info;
    var atFront = !has || info.index === info.list.length - 1, atBack = !has || info.index === 0;
    $('btn-node-front').disabled = atFront;
    $('btn-node-up').disabled = atFront;
    $('btn-node-down').disabled = atBack;
    $('btn-node-back').disabled = atBack;
    $('btn-node-del').disabled = !has || total <= 1;
    $('btn-node-dup').disabled = !has || total + L.countNodes([info.node]) > LIM.maxNodes;
    $('btn-node-wrap').disabled = !has || total >= LIM.maxNodes || info.depth + 1 + L.subtreeHeight(info.node) > LIM.maxDepth;
    $('btn-add-group').disabled = total >= LIM.maxNodes;
    $('btn-add-frame').disabled = total >= LIM.maxNodes ||
      (has && (info.node.type === 'frame' ? info.depth + 1 : info.depth) > LIM.maxDepth);
  }

  /* --- editor del nodo selezionato --------------------------------- */

  function fillOf(n) { return n.transparent === true ? 'none' : n.transparent === false ? 'solid' : 'auto'; }

  function renderNodeEditor() {
    var info = selInfo(), n = info ? info.node : null;
    $('node-panel').hidden = !n;
    $('node-empty').hidden = !!n;
    if (!n) return;
    var isFrame = n.type === 'frame';
    var kind = $('node-kind');
    kind.textContent = isFrame ? 'Frame' : 'Gruppo';
    kind.className = 'kind-badge ' + (isFrame ? 'frame' : 'group');

    var parentSel = $('node-parent');
    parentSel.textContent = '';
    L.containers(cfg(), n.id).forEach(function (c) {
      var o = el('option', null, c.depth < 0 ? 'Display' : new Array(c.depth + 2).join('  ') + '▣ ' + c.name);
      o.value = c.id;
      parentSel.appendChild(o);
    });
    parentSel.value = info.parent ? info.parent.id : '';
    $('opt-allow').checked = !!n.allowOverlap;

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
    Array.prototype.forEach.call(document.querySelectorAll('#frame-fill-seg button'), function (b) {
      var on = isFrame && b.getAttribute('data-fill') === fillOf(n);
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

  /* Quando nulla è selezionato: riepilogo di tutta la pagina. */
  function renderEmptyState() {
    var box = $('empty-summary'), t = state.result.totals, frames = 0, groups = 0;
    box.textContent = '';
    L.walk(cfg().nodes, function (n) { if (n.type === 'frame') frames++; else groups++; });
    box.appendChild(fitLine('Struttura', frames + ' ' + plural(frames, 'frame', 'frame') + ' · ' + groups + ' ' + plural(groups, 'gruppo', 'gruppi')));
    box.appendChild(fitLine('Contenuto', t.elements + ' ' + plural(t.elements, 'elemento', 'elementi') + ' · ' + t.blocks + ' ' + plural(t.blocks, 'blocco', 'blocchi')));
    var tot = I.totals(state.issues), parts = [];
    if (tot['out-display'].issues + tot['bad-area'].issues) parts.push((tot['out-display'].issues + tot['bad-area'].issues) + ' da correggere');
    if (tot['out-area'].issues) parts.push(tot['out-area'].issues + ' fuori area');
    if (tot.overlap.issues) parts.push(tot.overlap.count + ' ' + plural(tot.overlap.count, 'collisione', 'collisioni'));
    if (tot.covered.issues) parts.push(tot.covered.issues + ' ' + plural(tot.covered.issues, 'frame che copre', 'frame che coprono') + ' altri livelli');
    if (parts.length) {
      var line = fitLine('Problemi', parts.join(' · '));
      var b = el('button', 'link-btn small', 'Mostra i dettagli');
      b.type = 'button';
      b.addEventListener('click', function () { openIssuePanel('all'); });
      line.appendChild(b);
      box.appendChild(line);
    } else {
      var ok = el('p', 'fit-line ok');
      ok.innerHTML = DLC.icons.get('check');
      ok.appendChild(document.createTextNode('Nessun problema: nessuna collisione e tutto dentro le aree'));
      box.appendChild(ok);
    }
  }

  /* Disegno in scala di un elemento: i suoi blocchi affiancati o impilati. */
  function renderElementPreview(n, c) {
    var host = $('element-preview'), g = c ? c.element : L.elementGeometry(n);
    host.textContent = '';
    if (!g.w || !g.h) return;
    var k = Math.min(380 / g.w, 70 / g.h, 2), s = [];
    s.push('<svg xmlns="http://www.w3.org/2000/svg" width="', Math.max(1, g.w * k), '" height="', Math.max(1, g.h * k),
      '" viewBox="0 0 ', g.w, ' ', g.h, '" role="img" aria-label="Disegno di un elemento">');
    g.blocks.forEach(function (b, i) {
      var src = n.blocks[i], dark = DLC.preview.luminance(src.color) <= 0.55;
      s.push('<rect x="', b.x, '" y="', b.y, '" width="', b.w, '" height="', b.h, '" fill="', src.color,
        '" stroke="rgba(0,0,0,.4)" stroke-width="', 1 / k, '"/>');
      var label = (src.name || '') + ' ' + b.w + '×' + b.h;
      if (label.length * 6 <= b.w * k && b.h * k >= 14) {
        s.push('<text x="', b.x + b.w / 2, '" y="', b.y + b.h / 2 + 3.5 / k, '" text-anchor="middle" font-size="', 10.5 / k,
          '" fill="', dark ? '#fff' : '#111827', '" font-family="Segoe UI, system-ui, sans-serif">', label.replace(/[&<>"]/g, ''), '</text>');
      }
    });
    s.push('</svg>');
    host.innerHTML = s.join('');
  }

  function renderNodeInfo() {
    var info = selInfo();
    if (!info) { renderEmptyState(); return; }
    var n = info.node, e = selEntry(), c = e && e.contexts[0];
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

    // Gruppo: ingombro dell'elemento; frame: dimensione, copie e sfondo
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
      renderElementPreview(n, c);
    } else {
      var fi = $('frame-info');
      fi.textContent = '';
      if (c) {
        var line = 'Frame: ' + c.size.w + ' × ' + c.size.h + ' px';
        line += n.mode === 'fixed' ? ' · ' + c.count + ' ' + plural(c.count, 'copia', 'copie') : ' (riempie l\'area)';
        fi.appendChild(el('span', null, line));
      }
      fi.appendChild(el('span', 'muted', ' · contiene ' + n.children.length + ' ' + plural(n.children.length, 'oggetto', 'oggetti')));
      var first = e && e.items[0], fill = fillOf(n), msg = '';
      if (fill === 'auto') {
        msg = !first ? '' : first.transparent
          ? 'Automatico: ora è trasparente, perché con il colore pieno nasconderebbe ' + first.covers + ' ' + plural(first.covers, 'blocco', 'blocchi') + ' dei livelli sotto.'
          : 'Automatico: ora ha il colore pieno (non copre blocchi dei livelli sotto; se lo facesse diventerebbe trasparente).';
      } else if (fill === 'none') {
        msg = 'Trasparente: si vedono i livelli sotto, resta solo il contorno.';
      } else {
        msg = first && first.covers
          ? 'Colore pieno: ora nasconde ' + first.covers + ' ' + plural(first.covers, 'blocco', 'blocchi') + ' dei livelli sotto. Scegli «Trasparente» o «Auto» per vederli.'
          : 'Colore pieno: copre ciò che sta sotto.';
      }
      $('frame-fill-info').textContent = msg;
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

  /* Senza selezione l'anteprima è "reale": colori pieni, tutti i livelli, nessuna attenuazione. */
  function previewView() {
    var n = sel();
    return {
      selected: n ? n.id : '',
      colorful: !n,
      focus: n && state.ui.focusDim && L.countNodes(cfg().nodes) > 1 ? L.descendantIds(n) : null,
      coord: coordMode(),
      zoom: state.ui.zoom,
      showGrid: state.ui.showGrid,
      showNames: state.ui.showNames,
      showCoords: state.ui.showCoords,
      solid: state.ui.solid,
      problems: true
    };
  }

  function renderPreview() {
    var n = sel();
    $('preview-size').textContent = cfg().display.width + ' × ' + cfg().display.height + ' px';
    var chip = $('preview-mode');
    chip.textContent = n ? 'Selezione: «' + n.name + '»' : 'Vista reale · nessuna selezione';
    chip.classList.toggle('real', !n);
    $('btn-deselect').hidden = !n;
    $('opt-focus-wrap').hidden = !n || L.countNodes(cfg().nodes) < 2;
    preview.render(state.result, previewView());
  }

  function outputFilter() {
    var n = sel();
    if (!state.ui.onlyActive || !n || L.countNodes(cfg().nodes) < 2) return null;
    return L.descendantIds(n);
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
    var multi = L.countNodes(cfg().nodes) > 1, n = sel();
    $('only-active-wrap').hidden = !multi || !n;
    if (n) $('only-active-label').textContent = 'Solo «' + n.name + '»';
    $('coord-wrap').hidden = !state.result.hasFrames;
    var data = X.buildSheets(state.result, {
      view: state.ui.view, coord: coordMode(), nodes: outputFilter(), sizes: state.ui.sizes, hide: state.ui.hiddenCols
    });
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

  /* Avviso cliccabile: porta al gruppo o frame responsabile. */
  function issueBadge(host, kind, cls, text, icon) {
    var count = issuesFor(kind).length;
    var b = el('button', 'badge clickable ' + cls);
    b.type = 'button';
    b.innerHTML = DLC.icons.get(icon);
    b.appendChild(document.createTextNode(text));
    b.title = 'Clic: vai al gruppo o frame responsabile' + (count > 1 ? ' (clic ancora: il successivo, ' + count + ' in tutto)' : '');
    if (state.issuePanel === kind) b.classList.add('open');
    b.addEventListener('click', function () { goIssueKind(kind); });
    host.appendChild(b);
  }

  var KIND_TITLE = {
    all: 'Tutti i problemi',
    'out-display': 'Oggetti fuori dal display',
    'bad-area': 'Aree di lavoro non valide',
    'out-area': 'Oggetti fuori dalla propria area',
    overlap: 'Sovrapposizioni tra blocchi',
    covered: 'Frame che coprono altri livelli'
  };

  function issuesFor(kind) {
    var list = I.forNodes(state.issues, outputFilter());
    return kind === 'all' ? list : list.filter(function (i) { return i.kind === kind; });
  }

  function renderSummary() {
    var host = $('summary');
    host.textContent = '';
    var coord = coordMode(), filter = outputFilter();
    var items = X.pickItems(state.result, { coord: coord, nodes: filter });
    var blocks = 0, frames = 0, elements = {};
    items.forEach(function (it) {
      if (it.kind === 'frame') frames++;
      else { blocks++; elements[it.groupKey + ':' + it.n] = 1; }
    });
    var nEl = Object.keys(elements).length;
    badge(host, '', nEl + ' ' + plural(nEl, 'elemento', 'elementi') + ' · ' + blocks + ' ' + plural(blocks, 'blocco', 'blocchi') +
      (frames ? ' · ' + frames + ' frame' : ''), 'table');

    var tot = I.totals(I.forNodes(state.issues, filter)), serious = 0;
    if (tot['out-display'].issues) { issueBadge(host, 'out-display', 'err', tot['out-display'].count + ' fuori dal display', 'warn'); serious++; }
    if (tot['bad-area'].issues) { issueBadge(host, 'bad-area', 'err', tot['bad-area'].issues + ' ' + plural(tot['bad-area'].issues, 'area non valida', 'aree non valide'), 'warn'); serious++; }
    if (tot['out-area'].issues) { issueBadge(host, 'out-area', 'warn', tot['out-area'].count + ' fuori dalla propria area', 'warn'); serious++; }
    if (tot.overlap.issues) {
      issueBadge(host, 'overlap', 'warn', tot.overlap.count + ' ' + plural(tot.overlap.count, 'sovrapposizione', 'sovrapposizioni') + ' tra blocchi', 'warn');
      serious++;
    }
    if (tot.covered.issues) {
      var cv = tot.covered.issues;
      issueBadge(host, 'covered', 'info', cv + ' ' + plural(cv, 'frame copre', 'frame coprono') + ' altri livelli', 'info');
    }
    if (state.result.truncated) badge(host, 'err', 'Mostrati solo i primi ' + LIM.maxTotalItems + ' oggetti', 'warn');
    if (items.length && !serious) badge(host, 'ok', 'Nessuna collisione, tutto dentro le aree', 'check');
    if (coord === 'frame' && state.result.items.some(function (it) { return it.dup; })) {
      badge(host, 'info', 'Contenuto dei frame ripetuti mostrato una volta (coordinate uguali in ogni copia)', 'frame');
    }
    var all = issuesFor('all');
    if (all.length) {
      var more = el('button', 'link-btn small', state.issuePanel ? 'Nascondi i dettagli' : 'Dettagli dei problemi');
      more.type = 'button';
      more.addEventListener('click', function () { if (state.issuePanel) closeIssuePanel(); else openIssuePanel('all'); });
      host.appendChild(more);
    }
    renderIssues();
  }

  /* --- problemi: elenco con spiegazione e vai-a ----------------------- */

  function openIssuePanel(kind) {
    state.issuePanel = kind;
    renderSummary();
  }

  function closeIssuePanel() {
    state.issuePanel = null;
    renderSummary();
  }

  /* Clic su un avviso: porta al gruppo o frame responsabile; clic ancora = il successivo. */
  function goIssueKind(kind) {
    var list = issuesFor(kind);
    if (!list.length) return;
    var cur = state.issueCursor[kind];
    var i = cur == null || cur >= list.length - 1 ? 0 : cur + 1;
    state.issueCursor[kind] = i;
    state.issuePanel = kind;
    openIssue(list[i], null);
  }

  /* Un nodo nascosto (o dentro un frame nascosto) renderebbe invisibile il problema: lo mostra. */
  function ensureVisible(id) {
    var changed = [], f = L.findNode(cfg(), id);
    while (f) {
      if (f.node.hidden) { delete f.node.hidden; changed.push(f.node.name); }
      f = f.parent ? L.findNode(cfg(), f.parent.id) : null;
    }
    if (changed.length) toast('«' + changed.join('», «') + '» era nascosto: l\'ho reso visibile', { timeout: 3200 });
    return changed.length > 0;
  }

  function revealPreview() {
    var card = $('preview-card'), r = card.getBoundingClientRect();
    var visible = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 60);
    if (visible < r.height * 0.6 && visible < window.innerHeight * 0.6) {
      window.scrollTo({ top: Math.max(0, window.scrollY + r.top - 64), behavior: 'smooth' });
    }
  }

  /* Porta l'utente sul nodo indicato (o sul responsabile) e fa lampeggiare gli oggetti del problema. */
  function openIssue(issue, nodeId) {
    var id = nodeId || issue.node, keys = issue.keys;
    if (nodeId) {
      keys = issue.keys.filter(function (k) { return state.itemMap[k] && state.itemMap[k].node === nodeId; });
      if (!keys.length) keys = issue.keys;
    }
    state.issueActive = issue.id;
    var unhid = ensureVisible(id);
    if (unhid) { commit(); recompute(); }
    if (state.ui.selected !== id) select(id); else renderSummary();
    preview.setSelection(keys);
    preview.flash(keys);
    revealPreview();
  }

  function applyIssueAction(issue) {
    var a = issue.action;
    if (!a) return;
    var f = L.findNode(cfg(), a.node);
    if (!f) return;
    commit();
    if (a.id === 'transparent') f.node.transparent = true;
    renderAll();
    commit();
    toast('«' + f.node.name + '» ora ha lo sfondo trasparente', { action: { label: 'Annulla', fn: undo } });
  }

  function issueCard(it) {
    var card = el('div', 'issue sev-' + it.severity + (state.issueActive === it.id ? ' active' : ''));
    var ico = el('span', 'issue-ico');
    ico.innerHTML = DLC.icons.get(it.severity === 'info' ? 'info' : 'warn');
    card.appendChild(ico);
    var body = el('div', 'issue-body');
    body.appendChild(el('div', 'issue-title', it.title));
    body.appendChild(el('div', 'issue-detail', it.detail));
    if (it.fix) body.appendChild(el('div', 'issue-fix', it.fix));
    var acts = el('div', 'issue-actions');
    it.nodes.slice(0, 3).forEach(function (nid) {
      var f = L.findNode(cfg(), nid);
      if (!f) return;
      var b = iconButton('link-btn', 'target', 'Vai a «' + f.node.name + '»');
      b.addEventListener('click', function () { openIssue(it, nid); });
      acts.appendChild(b);
    });
    if (it.action) {
      var fix = el('button', 'btn primary small', it.action.label);
      fix.type = 'button';
      fix.addEventListener('click', function () { applyIssueAction(it); });
      acts.appendChild(fix);
    }
    body.appendChild(acts);
    card.appendChild(body);
    return card;
  }

  function renderIssues() {
    var host = $('issues'), kind = state.issuePanel, list = kind ? issuesFor(kind) : [];
    host.textContent = '';
    if (kind && !list.length) { state.issuePanel = null; kind = null; }
    host.hidden = !kind;
    if (!kind) return;
    var head = el('div', 'issues-head');
    head.appendChild(el('strong', null, KIND_TITLE[kind] + ' (' + list.length + ')'));
    if (kind !== 'all') {
      var all = el('button', 'link-btn small', 'Mostra tutti');
      all.type = 'button';
      all.addEventListener('click', function () { openIssuePanel('all'); });
      head.appendChild(all);
    }
    var close = iconButton('icon-btn', 'close');
    close.title = 'Chiudi l\'elenco';
    close.setAttribute('aria-label', 'Chiudi l\'elenco dei problemi');
    close.addEventListener('click', closeIssuePanel);
    head.appendChild(close);
    host.appendChild(head);
    list.forEach(function (it) { host.appendChild(issueCard(it)); });
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
      onCopy: onSheetCopy,
      widths: state.ui.colWidths,
      keyPrefix: function () { return state.ui.view; },
      onWidths: saveUISoon
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

  /* Clic su una zona vuota del display: nessuna selezione (vista reale con tutti i livelli). */
  function onPreviewBackground() {
    if (state.ui.selected) select('');
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
    if (it.overlap) t.appendChild(el('div', 'tip-warn', 'Si sovrappone ad un altro blocco'));
    if (it.hidden) t.appendChild(el('div', 'tip-dim', 'Nascosto nell\'anteprima'));
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

  /* id = '' → nessuna selezione. */
  function select(id) {
    id = id || '';
    if (id === (state.ui.selected || '')) return;
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
    var info = selInfo();                       // null = nessuna selezione: si aggiunge in primo piano sul display
    var parent = info ? (info.node.type === 'frame' ? info.node : info.parent) : null;
    var node = kind === 'frame' ? L.newFrame(cfg())
      : L.newGroup(cfg(), parent ? parent.id : '', info && info.node.type !== 'frame' ? info.node.id : '');
    var res = L.insertNode(cfg(), node, info ? info.node.id : '');
    if (!res) {
      toast('Non si possono annidare più di ' + LIM.maxDepth + ' livelli di frame', { kind: 'warn' });
      return;
    }
    state.ui.selected = node.id;
    saveUISoon();
    renderAll();
    commit();
    toast((kind === 'frame' ? 'Aggiunto il frame «' : 'Aggiunto il gruppo «') + node.name + '» ' +
      (res.parent ? 'dentro «' + res.parent.name + '»' : 'sul display') + ' (in primo piano)', { action: { label: 'Annulla', fn: undo } });
  }

  var ORDER_LABEL = { front: 'in primo piano', forward: 'avanti', backward: 'indietro', back: 'in secondo piano' };

  /* Azioni sull'oggetto selezionato (o su quello indicato da id): ordine dei livelli, racchiudi, duplica, elimina. */
  function nodeAction(action, id) {
    var info = id ? L.findNode(cfg(), id) : selInfo();
    if (!info) return;
    id = info.node.id;
    var name = info.node.name;
    commit();
    if (ORDER_LABEL[action]) {
      if (!L.reorder(cfg(), id, action)) return;
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
      state.ui.selected = next ? next.id : '';
      saveUISoon();
      renderAll();
      commit();
      toast('Eliminato «' + name + '»' + (info.node.type === 'frame' && info.node.children.length ? ' con il suo contenuto' : ''),
        { action: { label: 'Annulla', fn: undo } });
    }
  }

  /* Nasconde o mostra un oggetto nell'anteprima e nelle immagini (non cambia le coordinate). */
  function toggleHidden(id) {
    var f = L.findNode(cfg(), id);
    if (!f) return;
    change(function () { if (f.node.hidden) delete f.node.hidden; else f.node.hidden = true; });
  }

  /* Spostamento (trascinamento nell'elenco o "Si trova in"): l'oggetto resta dov'è sul display. */
  function moveNodeUI(id, parentId, index) {
    var f = L.findNode(cfg(), id);
    if (!f) return;
    var name = f.node.name;
    commit();
    var r = L.moveNode(cfg(), id, parentId || '', index, { keepPosition: true });
    if (!r.ok) {
      renderNodeEditor();
      toast(r.reason || 'Spostamento non possibile', { kind: 'warn' });
      return;
    }
    if (!r.moved) { renderNodeEditor(); return; }
    state.ui.selected = id;
    saveUISoon();
    renderAll();
    commit();
    var msg;
    if (r.changedContainer) {
      var target = parentId ? L.findNode(cfg(), parentId).node.name : 'Display';
      msg = '«' + name + '» spostato in «' + target + '»: ' + (!r.kept ? 'gli offset ora si riferiscono al nuovo contenitore'
        : r.exact ? 'la posizione sul display non cambia'
          : 'non entra nel nuovo contenitore, gli offset sono stati limitati: controlla l\'area');
    } else {
      msg = '«' + name + '»: cambiato livello';
    }
    toast(msg, { action: { label: 'Annulla', fn: undo }, timeout: 5200 });
  }

  /* Unisce un altro gruppo in quello selezionato: i suoi blocchi diventano colonne dello stesso elemento. */
  function mergeWith(otherId) {
    var n = sel(), other = L.findNode(cfg(), otherId);
    if (!n || !other) return;
    var name = n.name, otherName = other.node.name;
    commit();
    var r = L.mergeGroups(cfg(), n.id, otherId);
    if (!r.ok) {
      toast('Unione non possibile: ' + r.reason, { kind: 'warn', timeout: 5000 });
      return;
    }
    renderAll();
    commit();
    toast('«' + otherName + '» unito in «' + name + '»: ora ogni elemento ha ' + r.node.blocks.length +
      ' blocchi affiancati e le posizioni non sono cambiate', { action: { label: 'Annulla', fn: undo }, timeout: 7000 });
  }

  function mergeMenuItems(n) {
    var cands = L.mergeCandidates(cfg(), n.id);
    var items = [{ title: 'Unisci «' + n.name + '» con…' }];
    if (!cands.length) items.push({ label: 'Nessun altro gruppo nello stesso contenitore', disabled: true });
    cands.forEach(function (c) {
      items.push({
        label: c.name, icon: 'merge', disabled: !c.ok, sub: c.ok ? 'diventa una colonna dell\'elemento' : c.reason,
        hint: c.ok ? 'I blocchi di «' + c.name + '» diventano colonne di «' + n.name + '»' : c.reason,
        fn: function () { mergeWith(c.id); }
      });
    });
    return items;
  }

  function openMergeMenu(anchor, x, y) {
    var n = sel();
    if (!n || n.type !== 'group') return;
    M.open({ items: mergeMenuItems(n), anchor: anchor, x: x, y: y });
  }

  /* Menu del tasto destro su un livello. */
  function openNodeMenu(id, x, y) {
    var info = L.findNode(cfg(), id);
    if (!info) return;
    var n = info.node, total = L.countNodes(cfg().nodes);
    var atFront = info.index === info.list.length - 1, atBack = info.index === 0;
    var items = [
      { title: n.name },
      { label: 'Porta in primo piano', icon: 'front', disabled: atFront, fn: function () { nodeAction('front', id); } },
      { label: 'Porta avanti', icon: 'up', kbd: 'Alt+↑', disabled: atFront, fn: function () { nodeAction('forward', id); } },
      { label: 'Porta indietro', icon: 'down', kbd: 'Alt+↓', disabled: atBack, fn: function () { nodeAction('backward', id); } },
      { label: 'Porta in secondo piano', icon: 'back', disabled: atBack, fn: function () { nodeAction('back', id); } },
      { sep: true },
      { label: n.hidden ? 'Mostra nell\'anteprima' : 'Nascondi nell\'anteprima', icon: n.hidden ? 'eye' : 'eyeOff', fn: function () { toggleHidden(id); } },
      { label: 'Duplica', icon: 'copy', disabled: total + L.countNodes([n]) > LIM.maxNodes, fn: function () { nodeAction('dup', id); } },
      { label: 'Racchiudi in un frame', icon: 'wrap',
        disabled: total >= LIM.maxNodes || info.depth + 1 + L.subtreeHeight(n) > LIM.maxDepth, fn: function () { nodeAction('wrap', id); } }
    ];
    if (n.type === 'group') {
      items.push({ label: 'Unisci con un altro gruppo…', icon: 'merge', fn: function () { openMergeMenu(null, x, y); } });
    }
    items.push({ sep: true });
    items.push({ label: 'Elimina', icon: 'trash', danger: true, disabled: total <= 1, fn: function () { nodeAction('del', id); } });
    M.open({ items: items, x: x, y: y });
  }

  function loadConfig(config, message) {
    commit();
    state.config = L.normalizeConfig(JSON.parse(JSON.stringify(config)));
    // con più oggetti si parte dalla vista reale (nessuna selezione); con uno solo lo si seleziona per modificarlo
    state.ui.selected = state.config.nodes.length === 1 && state.config.nodes[0].type === 'group' ? state.config.nodes[0].id : '';
    sheets.forEach(function (s) { s.clear(true); });
    state.issueActive = '';
    state.issueCursor = {};
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
    return function () { var n = sel(); return n && n.type === 'frame' ? fn(n) : ''; };
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
    [['btn-node-front', 'front'], ['btn-node-up', 'forward'], ['btn-node-down', 'backward'], ['btn-node-back', 'back'],
      ['btn-node-wrap', 'wrap'], ['btn-node-dup', 'dup'], ['btn-node-del', 'del']]
      .forEach(function (p) { $(p[0]).addEventListener('click', function () { nodeAction(p[1]); }); });
    $('btn-deselect').addEventListener('click', function () { select(''); });

    // Nodo selezionato
    bindTxt('node-name', ofSel(function (n) { return n.name; }), function (v) { var n = sel(); if (n) n.name = v; },
      function () { var n = sel(); return n && n.type === 'frame' ? 'Frame' : 'Gruppo'; }, LIM.nameLength);
    $('node-parent').addEventListener('change', function () {
      var n = sel();
      if (n) moveNodeUI(n.id, this.value, null);
    });
    $('opt-allow').addEventListener('change', function () {
      var on = this.checked;
      change(function () { var n = sel(); if (!n) return; if (on) n.allowOverlap = true; else delete n.allowOverlap; });
      toast(on ? 'Sovrapposizione voluta: non verrà più segnalata per questo oggetto' : 'Le sovrapposizioni di questo oggetto tornano a essere segnalate');
    });

    ['top', 'left', 'right', 'bottom'].forEach(function (side) {
      bindNum('off-' + side, ofSel(function (n) { return n.area[side]; }), function (v) { var n = sel(); if (n) n.area[side] = v; }, LIM.offset);
    });

    // Gruppo: blocchi
    Array.prototype.forEach.call(document.querySelectorAll('#dir-seg button'), function (b) {
      b.addEventListener('click', function () {
        var dir = b.getAttribute('data-dir'), n = sel();
        if (!n || n.type !== 'group' || n.direction === dir) return;
        change(function () { n.direction = dir; }, { structural: true });
      });
    });
    $('btn-add-block').addEventListener('click', function () { blockTable.add(); });
    $('btn-merge').addEventListener('click', function () { openMergeMenu($('btn-merge')); });

    // Frame
    Array.prototype.forEach.call(document.querySelectorAll('#frame-mode-seg button'), function (b) {
      b.addEventListener('click', function () {
        var mode = b.getAttribute('data-mode'), n = sel();
        if (!n || n.type !== 'frame' || n.mode === mode) return;
        change(function () {
          n.mode = mode;
          if (mode === 'fixed' && !n.count) n.count = 1;
        }, { structural: true });
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#frame-fill-seg button'), function (b) {
      b.addEventListener('click', function () {
        var fill = b.getAttribute('data-fill'), n = sel();
        if (!n || n.type !== 'frame' || fillOf(n) === fill) return;
        change(function () {
          if (fill === 'auto') delete n.transparent;
          else n.transparent = fill === 'none';
        }, { structural: true });
      });
    });
    bindNum('frame-w', frameOnly(function (n) { return n.width; }), function (v) { var n = sel(); if (n && n.type === 'frame') n.width = v; }, LIM.frameSize);
    bindNum('frame-h', frameOnly(function (n) { return n.height; }), function (v) { var n = sel(); if (n && n.type === 'frame') n.height = v; }, LIM.frameSize);
    frameColor = E.bindColor($('frame-color'), $('frame-color-sw'), {
      get: function () { var n = sel(); return n && n.type === 'frame' ? { color: n.color, ral: n.ral } : { color: '#9da1aa', ral: '' }; },
      set: function (v) { var n = sel(); if (!n || n.type !== 'frame') return; n.color = v.color; n.ral = v.ral; scheduleRecompute(); },
      commit: commit
    });

    // Disposizione / ripetizione
    bindNum('count', ofSel(function (n) { return n.count; }), function (v) { var n = sel(); if (n) n.count = v; }, LIM.count);
    bindNum('columns', ofSel(function (n) { return n.columns; }), function (v) { var n = sel(); if (n) n.columns = v; }, LIM.columns);
    bindNum('row-gap', ofSel(function (n) { return n.rowGap; }), function (v) { var n = sel(); if (n) n.rowGap = v; }, LIM.gap);
    bindNum('col-gap', ofSel(function (n) { return n.colGap; }), function (v) { var n = sel(); if (n) n.colGap = v; }, LIM.gap);
    bindSel('order', ofSel(function (n) { return n.order; }), function (v) { var n = sel(); if (n) n.order = v; });
    bindSel('align-h', ofSel(function (n) { return n.alignH; }), function (v) { var n = sel(); if (n) n.alignH = v; });
    bindSel('align-v', ofSel(function (n) { return n.alignV; }), function (v) { var n = sel(); if (n) n.alignV = v; });
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
    [['opt-grid', 'showGrid'], ['opt-names', 'showNames'], ['opt-coords', 'showCoords'], ['opt-solid', 'solid'], ['opt-focus', 'focusDim']].forEach(function (p) {
      var c = $(p[0]);
      c.checked = state.ui[p[1]];
      c.addEventListener('change', function () { state.ui[p[1]] = c.checked; saveUISoon(); renderPreview(); });
    });
    $('btn-image').addEventListener('click', openImageDialog);
    $('btn-image-go').addEventListener('click', doExportImage);
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
    $('btn-cols').addEventListener('click', function () { openColumnsMenu(this); });
  }

  var COL_NAMES = {
    path: 'Percorso (frame e gruppo)', ctx: 'Frame che contiene l\'elemento', n: 'Numero dell\'elemento (Elem.)',
    row: 'Riga della griglia', col: 'Colonna della griglia', color: 'Colore (RAL / esadecimale)'
  };

  /* Menu "Colonne": larghezze e colonne descrittive da mostrare (X, Y, larghezza e altezza restano sempre). */
  function openColumnsMenu(anchor) {
    var hide = state.ui.hiddenCols, present = {};
    state.sheetsData.forEach(function (d) { d.columns.forEach(function (c) { present[c.field] = true; }); });
    function refresh() {
      sheets.forEach(function (s) { s.clear(true); });
      onSheetSelect(null);
      saveUISoon();
      renderOutput();
    }
    var items = [
      { title: 'Larghezza delle colonne' },
      { label: 'Adatta al contenuto', icon: 'columns', sub: 'oppure trascina il bordo della lettera di colonna',
        fn: function () { sheets.forEach(function (s) { s.fitAll(); }); } },
      { label: 'Larghezze automatiche', icon: 'undo', fn: function () { sheets.forEach(function (s) { s.resetWidths(); }); } },
      { sep: true },
      { title: 'Colonne da mostrare' }
    ];
    X.HIDEABLE.filter(function (k) { return present[k] || hide[k]; }).forEach(function (k) {
      items.push({
        label: COL_NAMES[k], checked: !hide[k], keepOpen: true,
        fn: function () { if (hide[k]) delete hide[k]; else hide[k] = true; refresh(); }
      });
    });
    if (state.ui.view === 'wide') {
      items.push({ sep: true });
      items.push({
        label: 'Larghezza e altezza di ogni blocco', checked: state.ui.sizes, keepOpen: true,
        fn: function () { state.ui.sizes = !state.ui.sizes; refresh(); }
      });
    }
    items.push({ sep: true });
    items.push({ title: 'X, Y, larghezza e altezza restano sempre visibili' });
    M.open({ items: items, anchor: anchor, align: 'right' });
  }

  /* ------------------------------------------------------------------ */
  /*  Finestra: esporta immagine                                         */
  /* ------------------------------------------------------------------ */

  /* Livelli = oggetti di primo livello visibili, dallo sfondo al primo piano. */
  function layerNodes() {
    return cfg().nodes.filter(function (n) { return !n.hidden; });
  }

  function imageScope() {
    var im = state.ui.img;
    if (im.scope === 'sel' && !sel()) return 'all';
    if (im.scope === 'layers' && cfg().nodes.length < 2) return 'all';
    return im.scope;
  }

  function imageExtras(only) {
    var im = state.ui.img;
    return {
      pixels: im.pixels, coord: im.coord, showGrid: im.grid, showNames: im.names, showCoords: im.coords,
      solid: im.solid, problems: im.problems, frameOutline: im.frameOutline,
      background: im.format === 'png' ? im.bg : 'white', only: only || null
    };
  }

  function openImageDialog() {
    state.ui.img.coord = coordMode();
    renderImageDialog();
    $('dlg-image').showModal();
  }

  function imgSelect(label, options, value, onChange) {
    var wrap = el('label', 'opt');
    wrap.appendChild(el('span', null, label));
    var s = el('select', 'cell');
    options.forEach(function (o) {
      var op = el('option', null, o[1]);
      op.value = String(o[0]);
      s.appendChild(op);
    });
    s.value = String(value);
    s.addEventListener('change', function () { onChange(s.value); saveUISoon(); renderImageDialog(); });
    wrap.appendChild(s);
    return wrap;
  }

  function imgCheck(label, value, onChange, title) {
    var wrap = el('label', 'chk');
    if (title) wrap.title = title;
    var c = el('input');
    c.type = 'checkbox';
    c.checked = value;
    c.addEventListener('change', function () { onChange(c.checked); saveUISoon(); renderImageDialog(); });
    wrap.appendChild(c);
    wrap.appendChild(document.createTextNode(label));
    return wrap;
  }

  function renderImageDialog() {
    var im = state.ui.img, host = $('image-opts'), n = sel(), scope = imageScope();
    host.textContent = '';
    var scopes = [['all', 'Tutto il display: tutti i livelli sovrapposti']];
    if (n) scopes.push(['sel', 'Solo «' + n.name + '» e il suo contenuto']);
    if (cfg().nodes.length > 1) scopes.push(['layers', 'Un file per ogni livello (archivio .zip)']);
    host.appendChild(imgSelect('Contenuto', scopes, scope, function (v) { im.scope = v; }));
    host.appendChild(imgSelect('Formato', [['png', 'PNG (immagine)'], ['svg', 'SVG (disegno vettoriale)']], im.format, function (v) { im.format = v; }));
    host.appendChild(imgSelect('Dimensione', [[1, 'Reale: 1 pixel per pixel del display'], [2, 'Doppia (×2)'], [3, 'Tripla (×3)']], im.pixels,
      function (v) { im.pixels = Number(v); }));
    if (state.result.hasFrames) {
      host.appendChild(imgSelect('Coordinate scritte', [['frame', 'Relative al frame'], ['display', 'Assolute sul display']], im.coord,
        function (v) { im.coord = v; }));
    }
    var checks = el('div', 'img-checks');
    checks.appendChild(imgCheck('Colori pieni (come sul pannello)', im.solid, function (v) { im.solid = v; }));
    checks.appendChild(imgCheck('Nomi', im.names, function (v) { im.names = v; }));
    checks.appendChild(imgCheck('Coordinate', im.coords, function (v) { im.coords = v; }));
    checks.appendChild(imgCheck('Griglia', im.grid, function (v) { im.grid = v; }));
    checks.appendChild(imgCheck('Contorno dei frame', im.frameOutline, function (v) { im.frameOutline = v; }, 'Bordo tratteggiato dei frame trasparenti'));
    checks.appendChild(imgCheck('Evidenzia i problemi', im.problems, function (v) { im.problems = v; },
      'Mostra le collisioni e gli oggetti fuori area come nell\'anteprima'));
    if (im.format === 'png') {
      checks.appendChild(imgCheck('Sfondo trasparente', im.bg === 'none', function (v) { im.bg = v ? 'none' : 'white'; },
        'PNG con lo sfondo del display trasparente (senza griglia)'));
    }
    host.appendChild(checks);

    var only = scope === 'sel' && n ? L.descendantIds(n) : null;
    $('image-thumb').innerHTML = DLC.preview.thumbnail(state.result, previewView(), imageExtras(only), 440);
    var W = cfg().display.width * im.pixels, H = cfg().display.height * im.pixels, info;
    if (scope === 'layers') {
      var names = layerNodes().map(function (x) { return '«' + x.name + '»'; });
      info = names.length
        ? names.length + ' ' + plural(names.length, 'file', 'file') + ' da ' + W + ' × ' + H + ' px, dallo sfondo al primo piano: ' + names.join(', ') +
          '. L\'anteprima mostra la somma dei livelli.'
        : 'Tutti i livelli sono nascosti.';
    } else {
      var hidden = [];
      L.walk(cfg().nodes, function (x) { if (x.hidden) hidden.push('«' + x.name + '»'); });
      info = 'Immagine di ' + W + ' × ' + H + ' px' + (scope === 'sel' ? ' con «' + n.name + '».' : ' con tutti i livelli visibili.') +
        (hidden.length ? ' Nascosti, quindi non inclusi: ' + hidden.join(', ') + '.' : '');
    }
    $('image-info').textContent = info;
    $('btn-image-go').disabled = scope === 'layers' && !layerNodes().length;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function doExportImage() {
    var im = state.ui.img, scope = imageScope(), res = state.result, view = previewView(), base = fileBase();
    var btn = $('btn-image-go');
    btn.disabled = true;
    function done() { btn.disabled = false; }
    function fail() { done(); toast('Impossibile creare l\'immagine', { kind: 'err' }); }
    function one(only) {
      var ex = imageExtras(only);
      if (im.format === 'svg') {
        return Promise.resolve(new Blob([DLC.preview.exportSVG(res, view, ex)], { type: 'image/svg+xml' }));
      }
      return DLC.preview.exportPNG(res, view, ex);
    }

    if (scope === 'layers') {
      var layers = layerNodes();
      Promise.all(layers.map(function (n, i) {
        return one(L.descendantIds(n)).then(function (blob) { return blob.arrayBuffer(); }).then(function (buf) {
          return { name: pad2(i + 1) + '-' + DLC.slug(n.name) + '.' + im.format, data: new Uint8Array(buf) };
        });
      })).then(function (files) {
        DLC.downloadBlob(base + '_livelli.zip', new Blob([Z.build(files)], { type: 'application/zip' }));
        done();
        toast(files.length + ' immagini ' + im.format.toUpperCase() + ' (una per livello) scaricate in ' + base + '_livelli.zip');
      }, fail);
      return;
    }
    var n = sel(), only = scope === 'sel' && n ? L.descendantIds(n) : null;
    var file = base + (only ? '_' + DLC.slug(n.name) : '') + '.' + im.format;
    one(only).then(function (blob) {
      DLC.downloadBlob(file, blob);
      done();
      toast('Immagine ' + im.format.toUpperCase() + ' scaricata (' + res.display.width * im.pixels + ' × ' + res.display.height * im.pixels + ' px' +
        (only ? ', solo «' + n.name + '»' : ', tutti i livelli') + ')');
    }, fail);
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
    var cur = sel();
    if (L.countNodes(cfg().nodes) > 1 && cur) {
      host.appendChild(optSelect('Contenuto', [['all', 'Tutto il layout'], ['active', 'Solo «' + cur.name + '»']], x.scope,
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
      if (x.table === 'wide') host.appendChild(optCheck('Larghezza e altezza di ogni blocco', x.sizes, function (v) { x.sizes = v; }));
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
    var cur = sel();
    var scoped = L.countNodes(cfg().nodes) > 1 && x.scope === 'active' && !!cur;
    var nodes = scoped ? L.descendantIds(cur) : null;
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
      var list = X.buildSheets(res, { view: x.table, coord: coord, nodes: nodes, sizes: x.sizes });
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
      text = X.toJSON(res, { rootId: scoped ? cur.id : null });
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
    ['dlg-configs', 'dlg-export', 'dlg-image', 'dlg-help'].forEach(function (id) {
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
      var t = e.target;
      var inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      if (e.key === 'Escape' && !e.defaultPrevented && !inField && !M.isOpen() && !document.querySelector('dialog[open]')) {
        if (state.issuePanel) closeIssuePanel();
        else if (state.ui.selected) select('');
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      var k = (e.key || '').toLowerCase();
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
        state.ui.selected = state.config.nodes.length === 1 && state.config.nodes[0].type === 'group' ? state.config.nodes[0].id : '';
        commit();
      }
    }
    // prima apertura (nessuna scelta salvata): con un solo gruppo lo si seleziona; poi si ricorda anche "nessuna selezione"
    if (state.ui.selected === null) {
      state.ui.selected = state.config.nodes.length === 1 && state.config.nodes[0].type === 'group' ? state.config.nodes[0].id : '';
    }
    selInfo();

    buildPresets();
    buildAccentMenu();
    preview = new DLC.Preview($('preview-wrap'), $('preview'), {
      onHover: onPreviewHover,
      onMove: onPreviewMove,
      onClick: onPreviewClick,
      onBackground: onPreviewBackground,
      onCursor: onCursor
    });
    tree = new DLC.Tree($('tree'), {
      config: cfg,
      result: function () { return state.result; },
      selected: function () { return state.ui.selected || ''; },
      meta: nodeMeta,
      issues: issuesOf,
      select: select,
      toggleHidden: toggleHidden,
      order: function (id, how) { nodeAction(how, id); },
      move: moveNodeUI,
      context: openNodeMenu
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
