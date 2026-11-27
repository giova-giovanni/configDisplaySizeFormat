/*
 * layout.js — Motore di calcolo del layout del display.
 *
 * Non dipende dal DOM: funziona nel browser (window.DLC.layout) e in Node.js
 * (require) per i test automatici.
 *
 * Struttura della configurazione (versione 2)
 * -------------------------------------------
 *   display : { width, height }   dimensioni del display in pixel
 *   nodes[] : elenco ad albero di
 *     GRUPPO  { type: 'group', area, direction, blocks[], count, columns, ... }
 *             una griglia di elementi uguali; ogni elemento è una sequenza di
 *             blocchi (es. LED + Scritta)
 *     FRAME   { type: 'frame', area, mode, width, height, color, children[], count, ... }
 *             un contenitore: riempie la sua area (mode 'fill') oppure ha
 *             dimensione fissa e può essere ripetuto in griglia (mode 'fixed');
 *             dentro contiene altri gruppi e frame (children)
 *
 *   area      : { top, bottom, left, right } offset dai bordi del contenitore
 *               (il display o il frame che contiene il nodo)
 *   blocks[]  : { name, width, height, gap, align, color, ral }
 *               gap   = distanza PRIMA del blocco (dal blocco precedente,
 *                       per il primo blocco dal bordo dell'elemento)
 *               align = allineamento trasversale 'start' | 'center' | 'end'
 *   count, columns, order ('rows'|'cols'), rowGap, colGap,
 *   alignH / alignV ('start'|'center'|'end'|'distribute') = disposizione
 *
 *   Opzioni facoltative (presenti solo se impostate):
 *   hidden        true  = nodo nascosto nell'anteprima e nelle immagini
 *   allowOverlap  true  = sovrapposizione voluta: non viene segnalata
 *   transparent   (solo frame) true = sfondo trasparente, false = sfondo pieno;
 *                 se assente il frame è "automatico": trasparente solo se
 *                 altrimenti nasconderebbe blocchi dei livelli sottostanti
 *
 * Livelli (ordine di sovrapposizione): in ogni elenco il primo nodo è il più
 * lontano (sfondo), l'ultimo il più vicino (primo piano), come in PowerPoint.
 *
 * Ogni oggetto posizionato (blocco o frame) ha coordinate intere:
 *   x, y    assolute, rispetto all'angolo in alto a sinistra del display
 *   rx, ry  relative al frame che lo contiene (come dentro una
 *           visualizzazione referenziata da un Frame CODESYS)
 *   z       posizione nell'ordine di disegno (0 = il più sotto)
 *
 * Sovrapposizioni: un frame è un contenitore/livello e può stare sopra altri
 * livelli senza errori. Si segnalano solo le collisioni tra BLOCCHI di gruppi
 * diversi (overlapPairs, con il rettangolo in comune).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ral.js'));
  else (root.DLC = root.DLC || {}).layout = factory(root.DLC.ral);
}(typeof self !== 'undefined' ? self : this, function (RAL) {
  'use strict';

  var LIMITS = {
    displaySize: [1, 10000],
    offset: [0, 10000],
    blockSize: [1, 10000],
    frameSize: [1, 10000],
    gap: [-10000, 10000],
    count: [0, 1000],
    columns: [1, 100],
    maxBlocks: 12,
    maxNodes: 40,
    maxDepth: 4,
    maxTotalItems: 5000,
    maxPairs: 500,
    nameLength: 40,
    configNameLength: 60
  };

  var PALETTE = [
    '#16a34a', '#2563eb', '#ea580c', '#9333ea', '#0891b2', '#db2777',
    '#ca8a04', '#4f46e5', '#0d9488', '#dc2626', '#65a30d', '#64748b'
  ];

  var DIRECTIONS = ['h', 'v'];
  var BLOCK_ALIGN = ['start', 'center', 'end'];
  var GRID_ALIGN = ['start', 'center', 'end', 'distribute'];
  var ORDERS = ['rows', 'cols'];
  var FRAME_MODES = ['fill', 'fixed'];

  /* ------------------------------------------------------------------ */
  /*  Validazione                                                        */
  /* ------------------------------------------------------------------ */

  function isObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function toInt(value, range, fallback) {
    var n = typeof value === 'number' ? value
      : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);
    if (!isFinite(n)) return fallback;
    n = Math.round(n);
    return Math.min(range[1], Math.max(range[0], n));
  }

  function oneOf(value, list, fallback) {
    return list.indexOf(value) !== -1 ? value : fallback;
  }

  function cleanName(value, fallback, maxLength) {
    if (typeof value !== 'string') return fallback;
    var s = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, maxLength || LIMITS.nameLength);
    return s || fallback;
  }

  function cleanColor(value, fallback) {
    if (typeof value !== 'string') return fallback;
    var v = value.trim();
    var short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
    if (short) v = '#' + short[1] + short[1] + short[2] + short[2] + short[3] + short[3];
    return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback;
  }

  /* Colore + eventuale codice RAL coerente con il colore. */
  function colorPair(color, ral, fallback) {
    var c = cleanColor(color, null);
    var code = typeof ral === 'number' ? String(ral) : (typeof ral === 'string' ? ral.replace(/^RAL\s*/i, '').trim() : '');
    var e = code ? RAL.lookup(code) : null;
    if (e) {
      if (!c) c = e.color;
      if (c !== e.color) e = null;
    }
    return { color: c || fallback, ral: e ? e.code : '' };
  }

  /* ------------------------------------------------------------------ */
  /*  Struttura ad albero                                                */
  /* ------------------------------------------------------------------ */

  function makeId(used) {
    var id;
    do { id = 'n' + Math.random().toString(36).slice(2, 8); } while (used && used[id]);
    if (used) used[id] = true;
    return id;
  }

  /* Visita in profondità: fn(nodo, genitore, lista, indice, profondità). */
  function walk(nodes, fn, parent, depth) {
    (nodes || []).forEach(function (n, i, list) {
      fn(n, parent || null, list, i, depth || 0);
      if (n.type === 'frame') walk(n.children, fn, n, (depth || 0) + 1);
    });
  }

  /* Come walk, ma i fratelli dal primo piano al fondo: è l'ordine dell'elenco
     dei livelli (in alto = davanti), come il "Riquadro selezione" di PowerPoint. */
  function walkFront(nodes, fn, parent, depth) {
    var list = nodes || [];
    for (var i = list.length - 1; i >= 0; i--) {
      fn(list[i], parent || null, list, i, depth || 0);
      if (list[i].type === 'frame') walkFront(list[i].children, fn, list[i], (depth || 0) + 1);
    }
  }

  function listNodesFront(config) {
    var out = [];
    walkFront(config.nodes, function (n, parent, list, index, depth) {
      out.push({ node: n, parent: parent, list: list, index: index, depth: depth });
    });
    return out;
  }

  function findNode(config, id) {
    var found = null;
    walk(config.nodes, function (n, parent, list, index, depth) {
      if (!found && n.id === id) found = { node: n, parent: parent, list: list, index: index, depth: depth };
    });
    return found;
  }

  function listNodes(config) {
    var out = [];
    walk(config.nodes, function (n, parent, list, index, depth) { out.push({ node: n, parent: parent, depth: depth }); });
    return out;
  }

  function countNodes(nodes) {
    var c = 0;
    walk(nodes, function () { c++; });
    return c;
  }

  function usedIds(config) {
    var u = {};
    walk(config.nodes, function (n) { u[n.id] = true; });
    return u;
  }

  function descendantIds(node) {
    var ids = {};
    walk([node], function (n) { ids[n.id] = true; });
    return ids;
  }

  /* Livelli sotto il nodo: 0 per un gruppo o un frame vuoto. */
  function subtreeHeight(node) {
    if (node.type !== 'frame' || !node.children.length) return 0;
    return 1 + Math.max.apply(null, node.children.map(subtreeHeight));
  }

  /* Contenitori in cui il nodo può essere spostato ('' = display). */
  function containers(config, movingId) {
    var moving = movingId ? findNode(config, movingId) : null;
    var h = moving ? subtreeHeight(moving.node) : 0;
    var banned = moving ? descendantIds(moving.node) : {};
    var out = [{ id: '', name: 'Display', depth: -1 }];
    walk(config.nodes, function (n, parent, list, index, depth) {
      if (n.type !== 'frame' || banned[n.id]) return;
      if (depth + 1 + h > LIMITS.maxDepth) return;
      out.push({ id: n.id, name: n.name, depth: depth });
    });
    return out;
  }

  function moveTo(config, id, targetId) {
    var f = findNode(config, id);
    if (!f) return false;
    var target = targetId ? findNode(config, targetId) : null;
    if (targetId && (!target || target.node.type !== 'frame' || descendantIds(f.node)[targetId])) return false;
    if ((target ? target.depth + 1 : 0) + subtreeHeight(f.node) > LIMITS.maxDepth) return false;
    f.list.splice(f.index, 1);
    (target ? target.node.children : config.nodes).push(f.node);
    return true;
  }

  function moveSibling(config, id, dir) {
    var f = findNode(config, id);
    if (!f) return false;
    var j = f.index + dir;
    if (j < 0 || j >= f.list.length) return false;
    var t = f.list[j];
    f.list[j] = f.list[f.index];
    f.list[f.index] = t;
    return true;
  }

  var ORDER_MOVES = ['front', 'forward', 'backward', 'back'];

  /* Ordine di sovrapposizione come in PowerPoint:
     'front' primo piano, 'forward' avanti di uno, 'backward' indietro di uno, 'back' sfondo. */
  function reorder(config, id, how) {
    var f = findNode(config, id);
    if (!f || ORDER_MOVES.indexOf(how) === -1) return false;
    var last = f.list.length - 1;
    var to = how === 'front' ? last : how === 'back' ? 0
      : how === 'forward' ? Math.min(last, f.index + 1) : Math.max(0, f.index - 1);
    if (to === f.index) return false;
    f.list.splice(f.index, 1);
    f.list.splice(to, 0, f.node);
    return true;
  }

  /* Perché un nodo non può essere spostato in un contenitore ('' = si può). */
  function canMove(config, id, parentId) {
    var f = findNode(config, id);
    if (!f) return 'Oggetto non trovato';
    var target = parentId ? findNode(config, parentId) : null;
    if (parentId && (!target || target.node.type !== 'frame')) return 'Si può inserire solo dentro un frame';
    if (target && descendantIds(f.node)[parentId]) return 'Un frame non può stare dentro se stesso';
    if ((target ? target.depth + 1 : 0) + subtreeHeight(f.node) > LIMITS.maxDepth) {
      return 'Non si possono annidare più di ' + LIMITS.maxDepth + ' livelli di frame';
    }
    return '';
  }

  /* Dove sta (in coordinate del display) la regione di lavoro di un nodo e il
     contenitore di destinazione: serve a mantenere la posizione dopo uno spostamento. */
  function snapshotPosition(config, id, parentId) {
    var res = computeLayout(config);
    var e = res.nodes[id], c = e && e.contexts[0];
    if (!c || !c.region.valid) return null;
    var box;
    if (!parentId) box = { x: 0, y: 0, w: res.display.width, h: res.display.height };
    else {
      var pe = res.nodes[parentId], first = pe && pe.contexts[0] && pe.contexts[0].items[0];
      if (!first) return null;
      box = { x: first.x, y: first.y, w: first.w, h: first.h };
    }
    return { region: c.region, box: box };
  }

  /* Imposta gli offset in modo che la regione resti dove si trovava sul display.
     Restituisce false se qualche offset è stato limitato (la regione non entra nel contenitore). */
  function applyPosition(node, pos) {
    var r = pos.region, b = pos.box, exact = true;
    var want = {
      top: r.y - b.y,
      left: r.x - b.x,
      bottom: (b.y + b.h) - (r.y + r.h),
      right: (b.x + b.w) - (r.x + r.w)
    };
    Object.keys(want).forEach(function (k) {
      var v = Math.round(want[k]);
      var c = Math.min(LIMITS.offset[1], Math.max(LIMITS.offset[0], v));
      if (c !== v) exact = false;
      node.area[k] = c;
    });
    return exact;
  }

  /*
   * Sposta un nodo (anche con il trascinamento) dentro parentId ('' = display),
   * nella posizione "index" dell'elenco di destinazione (0 = sfondo, length = primo piano).
   * Con opts.keepPosition, cambiando contenitore gli offset vengono ricalcolati
   * perché l'oggetto resti dov'è sul display.
   * Restituisce { ok, reason, exact, changedContainer, moved }.
   */
  function moveNode(config, id, parentId, index, opts) {
    var why = canMove(config, id, parentId || '');
    if (why) return { ok: false, reason: why };
    var f = findNode(config, id);
    var target = parentId ? findNode(config, parentId) : null;
    var oldParent = f.parent ? f.parent.id : '';
    var changed = oldParent !== (parentId || '');
    var pos = changed && opts && opts.keepPosition ? snapshotPosition(config, id, parentId || '') : null;
    var list = target ? target.node.children : config.nodes;
    var oldIndex = f.index;
    f.list.splice(f.index, 1);
    var at = index == null ? list.length : index;
    if (f.list === list && oldIndex < at) at--;
    at = Math.max(0, Math.min(list.length, at));
    list.splice(at, 0, f.node);
    var exact = pos ? applyPosition(f.node, pos) : true;
    return { ok: true, exact: exact, changedContainer: changed, moved: changed || at !== oldIndex, kept: !!pos };
  }

  function removeNode(config, id) {
    var f = findNode(config, id);
    if (!f || countNodes(config.nodes) - countNodes([f.node]) < 1) return null;
    f.list.splice(f.index, 1);
    return f;
  }

  /* Inserisce un nodo: dentro il frame selezionato, oppure subito dopo il nodo selezionato. */
  function insertNode(config, node, selectedId) {
    if (countNodes(config.nodes) + countNodes([node]) > LIMITS.maxNodes) return null;
    var f = selectedId ? findNode(config, selectedId) : null;
    var h = subtreeHeight(node);
    if (f && f.node.type === 'frame') {
      if (f.depth + 1 + h > LIMITS.maxDepth) return null;
      f.node.children.push(node);
      return { parent: f.node };
    }
    if (f) {
      if (f.depth + h > LIMITS.maxDepth) return null;
      f.list.splice(f.index + 1, 0, node);
      return { parent: f.parent };
    }
    config.nodes.push(node);
    return { parent: null };
  }

  function duplicateNode(config, id) {
    var f = findNode(config, id);
    if (!f || countNodes(config.nodes) + countNodes([f.node]) > LIMITS.maxNodes) return null;
    var used = usedIds(config);
    var copy = JSON.parse(JSON.stringify(f.node));
    walk([copy], function (n) { n.id = makeId(used); });
    copy.name = (copy.name + ' (copia)').slice(0, LIMITS.nameLength);
    f.list.splice(f.index + 1, 0, copy);
    return copy;
  }

  /* Racchiude un nodo in un nuovo frame che prende la sua area. */
  function wrapInFrame(config, id) {
    var f = findNode(config, id);
    if (!f || countNodes(config.nodes) + 1 > LIMITS.maxNodes) return null;
    if (f.depth + 1 + subtreeHeight(f.node) > LIMITS.maxDepth) return null;
    var frame = newFrame(config);
    frame.name = ('Frame ' + f.node.name).slice(0, LIMITS.nameLength);
    frame.area = { top: f.node.area.top, bottom: f.node.area.bottom, left: f.node.area.left, right: f.node.area.right };
    f.node.area = { top: 0, bottom: 0, left: 0, right: 0 };
    frame.children = [f.node];
    f.list.splice(f.index, 1, frame);
    return frame;
  }

  /* ------------------------------------------------------------------ */
  /*  Unione di due gruppi (colonne di larghezza diversa)                */
  /* ------------------------------------------------------------------ */

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function mainStart(b, horiz) { return horiz ? b.x : b.y; }
  function mainEnd(b, horiz) { return horiz ? b.x + b.w : b.y + b.h; }
  function sameRect(p, q) { return p.x === q.x && p.y === q.y && p.w === q.w && p.h === q.h; }

  /* Il gruppo unito deve ricostruire ESATTAMENTE la posizione di ogni blocco dei due gruppi. */
  function mergeMatches(cm, firstEls, secondEls) {
    if (cm.items.length !== firstEls.length) return false;
    for (var i = 0; i < cm.items.length; i++) {
      var me = cm.items[i].blocks, fe = firstEls[i].blocks, se = secondEls[i].blocks, k;
      if (me.length !== fe.length + se.length) return false;
      for (k = 0; k < fe.length; k++) if (!sameRect(me[k], fe[k])) return false;
      for (k = 0; k < se.length; k++) if (!sameRect(me[fe.length + k], se[k])) return false;
    }
    return true;
  }

  /* Configurazione di prova in cui "merged" prende il posto di idA e idB sparisce. */
  function trialConfig(config, idA, idB, merged) {
    var trial = clone(config), f = findNode(trial, idA);
    f.list[f.index] = merged;
    for (var i = 0; i < f.list.length; i++) {
      if (f.list[i].id === idB) { f.list.splice(i, 1); break; }
    }
    return trial;
  }

  /*
   * Prova a unire due gruppi fratelli in uno solo: i blocchi del secondo vengono
   * messi dopo quelli del primo (nell'ordine in cui compaiono sul display) e la
   * distanza tra i due è ricavata dalle posizioni reali. L'unione è accettata solo
   * se ogni blocco resta dove si trovava; altrimenti restituisce il motivo.
   */
  function tryMerge(config, idA, idB) {
    var fa = findNode(config, idA), fb = findNode(config, idB);
    if (!fa || !fb || idA === idB) return { ok: false, reason: 'Oggetti non validi' };
    if (fa.node.type !== 'group' || fb.node.type !== 'group') return { ok: false, reason: 'Si possono unire solo gruppi' };
    if (fa.list !== fb.list) return { ok: false, reason: 'Stanno in contenitori diversi' };
    var A = fa.node, B = fb.node;
    if (A.direction !== B.direction) return { ok: false, reason: 'Blocchi disposti in modo diverso (affiancati / impilati)' };
    if (A.count !== B.count) return { ok: false, reason: 'Numero di elementi diverso (' + A.count + ' e ' + B.count + ')' };
    if (A.blocks.length + B.blocks.length > LIMITS.maxBlocks) {
      return { ok: false, reason: 'Troppi blocchi (massimo ' + LIMITS.maxBlocks + ' per elemento)' };
    }
    var res = computeLayout(config);
    var ca = res.nodes[idA].contexts[0], cb = res.nodes[idB].contexts[0];
    if (!ca || !cb || !ca.items.length || ca.items.length !== cb.items.length) {
      return { ok: false, reason: 'Nessun elemento da unire' };
    }
    var horiz = A.direction !== 'v';
    var aFirst = mainStart(ca.items[0].blocks[0], horiz) <= mainStart(cb.items[0].blocks[0], horiz);
    var first = aFirst ? A : B, second = aFirst ? B : A;
    var firstEls = aFirst ? ca.items : cb.items, secondEls = aFirst ? cb.items : ca.items;
    var e1 = firstEls[0].blocks, e2 = secondEls[0].blocks;
    var gap = mainStart(e2[0], horiz) - mainEnd(e1[e1.length - 1], horiz);
    if (gap < LIMITS.gap[0] || gap > LIMITS.gap[1]) return { ok: false, reason: 'Distanza tra i gruppi fuori limite' };

    function build(base, aligns) {
      var m = clone(base);
      m.id = A.id;
      m.name = A.name;
      m.blocks = clone(first.blocks).concat(clone(second.blocks));
      m.blocks[first.blocks.length].gap = gap;
      if (aligns) m.blocks.forEach(function (b, i) { b.align = aligns[i]; });
      return m;
    }

    var bases = [first, second];
    for (var bi = 0; bi < bases.length; bi++) {
      var merged = build(bases[bi]);
      var cm = computeLayout(trialConfig(config, idA, idB, merged)).nodes[A.id].contexts[0];
      if (cm && mergeMatches(cm, firstEls, secondEls)) return { ok: true, node: merged, removeId: B.id };
      if (!cm || !cm.items.length) continue;
      // secondo tentativo: allineamento trasversale dedotto dalle posizioni originali
      var cross = horiz ? cm.element.h : cm.element.w, el0 = cm.items[0];
      var origin = horiz ? el0.y : el0.x, aligns = [], okAlign = true;
      e1.concat(e2).forEach(function (b) {
        var size = horiz ? b.h : b.w, want = (horiz ? b.y : b.x) - origin;
        aligns.push(want === 0 ? 'start' : want === cross - size ? 'end'
          : want === Math.floor((cross - size) / 2) ? 'center' : null);
        if (aligns[aligns.length - 1] === null) okAlign = false;
      });
      if (!okAlign) continue;
      merged = build(bases[bi], aligns);
      cm = computeLayout(trialConfig(config, idA, idB, merged)).nodes[A.id].contexts[0];
      if (cm && mergeMatches(cm, firstEls, secondEls)) return { ok: true, node: merged, removeId: B.id };
    }
    return { ok: false, reason: 'Posizioni, righe o allineamenti non compatibili: i blocchi non resterebbero dove sono' };
  }

  /* Gruppi con cui si può unire idA: ogni fratello con l'esito e, se no, il motivo. */
  function mergeCandidates(config, id) {
    var f = findNode(config, id), out = [];
    if (!f || f.node.type !== 'group') return out;
    f.list.forEach(function (n) {
      if (n.id === id || n.type !== 'group') return;
      var r = tryMerge(config, id, n.id);
      out.push({ id: n.id, name: n.name, ok: r.ok, reason: r.reason || '' });
    });
    return out;
  }

  /* Unisce idB dentro idA (il gruppo unito mantiene id, nome e posizione di idA). */
  function mergeGroups(config, idA, idB) {
    var r = tryMerge(config, idA, idB);
    if (!r.ok) return r;
    var f = findNode(config, idA);
    f.list[f.index] = r.node;
    for (var i = 0; i < f.list.length; i++) {
      if (f.list[i].id === idB) { f.list.splice(i, 1); break; }
    }
    return { ok: true, node: r.node, removed: idB };
  }

  /* ------------------------------------------------------------------ */
  /*  Valori predefiniti                                                 */
  /* ------------------------------------------------------------------ */

  function makeBlock(name, width, height, gap, color, ral, align) {
    return { name: name, width: width, height: height, gap: gap, align: align || 'center', color: color, ral: ral || '' };
  }

  /* L'esempio di partenza: LED 50×50 + Scritta 300×50, distanza 15 px,
     6 righe a 20 px una dall'altra, area ridotta di 30 px in alto e 50 in basso. */
  function defaultGroup(id) {
    return {
      id: id || 'n1',
      type: 'group',
      name: 'Gruppo 1',
      area: { top: 30, bottom: 50, left: 0, right: 0 },
      direction: 'h',
      blocks: [
        makeBlock('LED', 50, 50, 15, '#308446', '6024'),
        makeBlock('Scritta', 300, 50, 15, '#2271b3', '5015')
      ],
      count: 6,
      columns: 1,
      order: 'rows',
      rowGap: 20,
      colGap: 20,
      alignH: 'start',
      alignV: 'start'
    };
  }

  function defaultConfig() {
    return {
      v: 2,
      name: 'Layout display',
      display: { width: 800, height: 480 },
      nodes: [defaultGroup('n1')]
    };
  }

  function usedColors(config) {
    var out = [];
    walk(config && config.nodes, function (n) {
      (n.blocks || []).forEach(function (b) { if (b && b.color) out.push(b.color); });
    });
    return out;
  }

  function pickColor(used) {
    for (var i = 0; i < PALETTE.length; i++) {
      if (used.indexOf(PALETTE[i]) === -1) return PALETTE[i];
    }
    return PALETTE[used.length % PALETTE.length];
  }

  function nextName(config, base) {
    var names = {}, n = 1;
    walk(config.nodes, function (x) { names[x.name.toLowerCase()] = true; });
    while (names[(base + ' ' + n).toLowerCase()]) n++;
    return base + ' ' + n;
  }

  /* Nuovo blocco di un gruppo: stessa altezza dell'ultimo. */
  function newBlock(group, config) {
    var blocks = group.blocks || [];
    var last = blocks[blocks.length - 1];
    return makeBlock(
      'Blocco ' + (blocks.length + 1),
      100,
      last ? last.height : 50,
      blocks.length > 1 ? last.gap : 10,
      pickColor(usedColors(config || { nodes: [group] })),
      '',
      'center'
    );
  }

  /* Nuovo gruppo. Se viene aggiunto sul display accanto a un gruppo che lascia
     libera una fascia in basso (o in alto), la occupa con una fila di pulsanti. */
  function newGroup(config, parentId, refId) {
    var d = config.display;
    var g = {
      id: makeId(usedIds(config)),
      type: 'group',
      name: nextName(config, 'Gruppo'),
      area: { top: 0, bottom: 0, left: 0, right: 0 },
      direction: 'h',
      blocks: [makeBlock('Pulsante', 120, 40, 0, pickColor(usedColors(config)), '', 'center')],
      count: 4,
      columns: 4,
      order: 'rows',
      rowGap: 10,
      colGap: 20,
      alignH: 'start',
      alignV: 'start'
    };
    var ref = refId ? findNode(config, refId) : null;
    if (!parentId && ref && !ref.parent) {
      var a = ref.node.area, strip = null;
      if (a.bottom >= 20) strip = { top: d.height - a.bottom, bottom: 0 };
      else if (a.top >= 20) strip = { top: 0, bottom: d.height - a.top };
      if (strip) {
        var stripH = d.height - strip.top - strip.bottom;
        g.area = { top: strip.top, bottom: strip.bottom, left: a.left, right: a.right };
        g.blocks[0].height = Math.max(10, Math.min(40, stripH - 10));
        g.alignH = 'center';
        g.alignV = 'center';
      }
    }
    return g;
  }

  function newFrame(config) {
    return {
      id: makeId(usedIds(config)),
      type: 'frame',
      name: nextName(config, 'Frame'),
      area: { top: 0, bottom: 0, left: 0, right: 0 },
      mode: 'fill',
      width: 300,
      height: 150,
      color: '#9da1aa',
      ral: '7040',
      children: [],
      count: 1,
      columns: 1,
      order: 'rows',
      rowGap: 10,
      colGap: 10,
      alignH: 'start',
      alignV: 'start'
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Normalizzazione (dati caricati da file, link o memoria locale)     */
  /* ------------------------------------------------------------------ */

  function normalizeBlock(raw, index) {
    raw = isObject(raw) ? raw : {};
    var c = colorPair(raw.color, raw.ral, PALETTE[index % PALETTE.length]);
    return {
      name: cleanName(raw.name, 'Blocco ' + (index + 1)),
      width: toInt(raw.width, LIMITS.blockSize, 50),
      height: toInt(raw.height, LIMITS.blockSize, 50),
      gap: toInt(raw.gap, LIMITS.gap, 0),
      align: oneOf(raw.align, BLOCK_ALIGN, 'center'),
      color: c.color,
      ral: c.ral
    };
  }

  function normalizeNode(raw, index, depth, st) {
    if (!isObject(raw) || st.count >= LIMITS.maxNodes || depth > LIMITS.maxDepth) return null;
    st.count++;
    var type = raw.type === 'frame' ? 'frame' : 'group';
    var id = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(raw.id) && !st.ids[raw.id]
      ? raw.id : makeId(st.ids);
    st.ids[id] = true;
    var area = isObject(raw.area) ? raw.area : {};
    var node = {
      id: id,
      type: type,
      name: cleanName(raw.name, (type === 'frame' ? 'Frame ' : 'Gruppo ') + (index + 1)),
      area: {
        top: toInt(area.top, LIMITS.offset, 0),
        bottom: toInt(area.bottom, LIMITS.offset, 0),
        left: toInt(area.left, LIMITS.offset, 0),
        right: toInt(area.right, LIMITS.offset, 0)
      },
      count: toInt(raw.count, LIMITS.count, 1),
      columns: toInt(raw.columns, LIMITS.columns, 1),
      order: oneOf(raw.order, ORDERS, 'rows'),
      rowGap: toInt(raw.rowGap, LIMITS.gap, 0),
      colGap: toInt(raw.colGap, LIMITS.gap, 0),
      alignH: oneOf(raw.alignH, GRID_ALIGN, 'start'),
      alignV: oneOf(raw.alignV, GRID_ALIGN, 'start')
    };
    if (raw.hidden === true) node.hidden = true;
    if (raw.allowOverlap === true) node.allowOverlap = true;
    if (type === 'group') {
      node.direction = oneOf(raw.direction, DIRECTIONS, 'h');
      var blocks = Array.isArray(raw.blocks) ? raw.blocks.slice(0, LIMITS.maxBlocks).map(normalizeBlock) : [];
      node.blocks = blocks.length ? blocks : [normalizeBlock({}, 0)];
    } else {
      var c = colorPair(raw.color, raw.ral, '#9da1aa');
      node.mode = oneOf(raw.mode, FRAME_MODES, 'fill');
      if (raw.transparent === true || raw.transparent === false) node.transparent = raw.transparent;
      node.width = toInt(raw.width, LIMITS.frameSize, 300);
      node.height = toInt(raw.height, LIMITS.frameSize, 150);
      node.color = c.color;
      node.ral = c.ral;
      node.children = [];
      (Array.isArray(raw.children) ? raw.children : []).forEach(function (ch, i) {
        var n = normalizeNode(ch, i, depth + 1, st);
        if (n) node.children.push(n);
      });
    }
    return node;
  }

  /* Accetta anche il formato della versione 1 (elenco piatto "groups"). */
  function normalizeConfig(raw) {
    raw = isObject(raw) ? raw : {};
    var d = isObject(raw.display) ? raw.display : {};
    var source = Array.isArray(raw.nodes) ? raw.nodes : (Array.isArray(raw.groups) ? raw.groups : []);
    var st = { count: 0, ids: {} };
    var nodes = [];
    source.forEach(function (n, i) {
      var x = normalizeNode(n, i, 0, st);
      if (x) nodes.push(x);
    });
    if (!nodes.length) nodes = [defaultGroup(makeId(st.ids))];
    return {
      v: 2,
      name: cleanName(raw.name, 'Layout display', LIMITS.configNameLength),
      display: {
        width: toInt(d.width, LIMITS.displaySize, 800),
        height: toInt(d.height, LIMITS.displaySize, 480)
      },
      nodes: nodes
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Calcolo                                                            */
  /* ------------------------------------------------------------------ */

  /* Geometria di un elemento: posizione relativa di ogni blocco e ingombro. */
  function elementGeometry(group) {
    var horiz = group.direction !== 'v';
    var cursor = 0, mainEnd = 0, cross = 0, parts = [];
    group.blocks.forEach(function (b) {
      var along = horiz ? b.width : b.height;
      var across = horiz ? b.height : b.width;
      cursor += b.gap;
      parts.push({ main: cursor, along: along, across: across, align: b.align });
      cursor += along;
      if (cursor > mainEnd) mainEnd = cursor;
      if (across > cross) cross = across;
    });
    var blocks = parts.map(function (p) {
      var off = p.align === 'center' ? Math.floor((cross - p.across) / 2)
        : p.align === 'end' ? cross - p.across : 0;
      return horiz
        ? { x: p.main, y: off, w: p.along, h: p.across }
        : { x: off, y: p.main, w: p.across, h: p.along };
    });
    return { w: horiz ? mainEnd : cross, h: horiz ? cross : mainEnd, blocks: blocks };
  }

  /* Posizioni di partenza di n celle lungo un asse. */
  function axisPositions(n, size, gap, start, avail, align) {
    var pos = [], i;
    if (n <= 0) return { pos: pos, gap: gap, span: 0 };
    if (align === 'distribute') {
      if (n === 1) return { pos: [start + Math.floor((avail - size) / 2)], gap: 0, span: size };
      var free = avail - size;
      for (i = 0; i < n; i++) pos.push(start + Math.round(i * free / (n - 1)));
      return { pos: pos, gap: (avail - n * size) / (n - 1), span: pos[n - 1] + size - pos[0] };
    }
    var span = n * size + (n - 1) * gap;
    var s = start;
    if (align === 'center') s = start + Math.floor((avail - span) / 2);
    else if (align === 'end') s = start + avail - span;
    for (i = 0; i < n; i++) pos.push(s + i * (size + gap));
    return { pos: pos, gap: gap, span: span };
  }

  /* Quante celle di dimensione "size" entrano in "avail" con distanza "gap". */
  function maxFit(avail, size, gap) {
    if (size <= 0 || avail < size) return 0;
    if (size + gap <= 0) return Infinity;
    return Math.floor((avail + gap) / (size + gap));
  }

  function region(box, area) {
    var rawW = box.w - area.left - area.right, rawH = box.h - area.top - area.bottom;
    return {
      x: box.x + area.left,
      y: box.y + area.top,
      w: Math.max(0, rawW),
      h: Math.max(0, rawH),
      valid: rawW > 0 && rawH > 0
    };
  }

  /* Griglia di "count" celle cellW × cellH nella regione, secondo le impostazioni del nodo. */
  function gridCells(node, cellW, cellH, reg) {
    var n = node.count, C = Math.max(1, node.columns), rows = 0, cols = 0;
    if (n > 0) {
      if (node.order === 'cols') { rows = Math.ceil(n / C); cols = Math.ceil(n / rows); }
      else { cols = Math.min(C, n); rows = Math.ceil(n / C); }
    }
    var ax = axisPositions(cols, cellW, node.colGap, reg.x, reg.w, node.alignH);
    var ay = axisPositions(rows, cellH, node.rowGap, reg.y, reg.h, node.alignV);
    var cells = [];
    for (var i = 0; i < n; i++) {
      var r = node.order === 'cols' ? i % rows : Math.floor(i / C);
      var c = node.order === 'cols' ? Math.floor(i / rows) : i % C;
      cells.push({ n: i + 1, row: r + 1, col: c + 1, x: ax.pos[c], y: ay.pos[r] });
    }
    var gx = cols ? Math.min.apply(null, ax.pos) : reg.x;
    var gy = rows ? Math.min.apply(null, ay.pos) : reg.y;
    var gw = cols ? Math.max.apply(null, ax.pos) + cellW - gx : 0;
    var gh = rows ? Math.max.apply(null, ay.pos) + cellH - gy : 0;
    return {
      rows: rows,
      cols: cols,
      cells: cells,
      gaps: { col: ax.gap, row: ay.gap },
      grid: { x: gx, y: gy, w: gw, h: gh },
      free: { w: reg.w - gw, h: reg.h - gh },
      fit: {
        cols: maxFit(reg.w, cellW, node.alignH === 'distribute' ? 0 : node.colGap),
        rows: maxFit(reg.h, cellH, node.alignV === 'distribute' ? 0 : node.rowGap)
      }
    };
  }

  function join(a, b) { return a ? a + ' › ' + b : b; }

  /* Chiave del primo frame equivalente (per i frame ripetuti). */
  function frameTwin(key) {
    var i = key.lastIndexOf('#');
    return key.slice(0, i).replace(/#\d+/g, '#1') + key.slice(i);
  }

  function nodeEntry(ctx, node, env) {
    var e = ctx.nodes[node.id];
    if (!e) {
      e = ctx.nodes[node.id] = {
        id: node.id,
        type: node.type,
        name: node.name,
        depth: env.depth,
        parent: '',
        names: (env.names || []).concat([node.name]),
        children: node.type === 'frame' ? node.children.map(function (c) { return c.id; }) : [],
        blockNames: node.type === 'group' ? node.blocks.map(function (b, i) { return b.name || ('Blocco ' + (i + 1)); }) : [],
        hidden: !!node.hidden,
        contexts: [],
        items: [],
        out: { area: 0, display: 0 }
      };
    }
    return e;
  }

  function place(ctx, entry, it, reg) {
    it.outArea = !reg.valid || it.x < reg.x || it.y < reg.y || it.x + it.w > reg.x + reg.w || it.y + it.h > reg.y + reg.h;
    it.outDisplay = it.x < 0 || it.y < 0 || it.x + it.w > ctx.display.width || it.y + it.h > ctx.display.height;
    if (it.outArea) entry.out.area++;
    if (it.outDisplay) entry.out.display++;
    it.z = ctx.items.length;
    ctx.items.push(it);
    entry.items.push(it);
  }

  function newContext(node, env, box, reg, g) {
    return {
      key: env.prefix,
      dup: env.dup,
      path: join(env.path, node.name),
      relPath: join(env.relPath, node.name),
      parentPath: env.path,
      parentRelPath: env.relPath,
      origin: env.origin,
      box: box,
      region: reg,
      rows: g.rows,
      cols: g.cols,
      gaps: g.gaps,
      grid: g.grid,
      free: g.free,
      fit: g.fit,
      items: []
    };
  }

  function computeGroup(node, box, env, ctx) {
    var entry = nodeEntry(ctx, node, env);
    var reg = region(box, node.area);
    var el = elementGeometry(node);
    var g = gridCells(node, el.w, el.h, reg);
    var context = newContext(node, env, box, reg, g);
    var allow = !!env.allow || !!node.allowOverlap, hidden = !!env.hidden || !!node.hidden;
    context.element = el;
    entry.contexts.push(context);
    for (var i = 0; i < g.cells.length; i++) {
      var cell = g.cells[i];
      if (ctx.budget.left < el.blocks.length) { ctx.budget.truncated = true; break; }
      ctx.budget.left -= el.blocks.length;
      var element = { n: cell.n, row: cell.row, col: cell.col, x: cell.x, y: cell.y, blocks: [] };
      for (var bi = 0; bi < el.blocks.length; bi++) {
        var t = el.blocks[bi], src = node.blocks[bi];
        var key = env.prefix + node.id + ':' + cell.n + ':' + bi;
        var b = {
          key: key,
          twin: key.replace(/#\d+/g, '#1'),
          kind: 'block',
          node: node.id,
          ctxKey: env.prefix + node.id,
          groupKey: env.prefix + node.id,
          ancestors: env.ancestors,
          depth: env.depth,
          dup: env.dup,
          path: context.path,
          relPath: context.relPath,
          n: cell.n,
          row: cell.row,
          col: cell.col,
          index: bi,
          name: entry.blockNames[bi],
          color: src.color,
          ral: src.ral || '',
          x: cell.x + t.x,
          y: cell.y + t.y,
          w: t.w,
          h: t.h,
          allow: allow,
          hidden: hidden,
          overlap: false
        };
        b.rx = b.x - env.origin.x;
        b.ry = b.y - env.origin.y;
        place(ctx, entry, b, reg);
        element.blocks.push(b);
      }
      context.items.push(element);
    }
    context.count = context.items.length;
  }

  function computeFrame(node, box, env, ctx) {
    var entry = nodeEntry(ctx, node, env);
    var reg = region(box, node.area);
    var fixed = node.mode === 'fixed';
    var g = fixed ? gridCells(node, node.width, node.height, reg) : {
      rows: 1,
      cols: 1,
      cells: [{ n: 1, row: 1, col: 1, x: reg.x, y: reg.y }],
      gaps: { col: 0, row: 0 },
      grid: { x: reg.x, y: reg.y, w: reg.w, h: reg.h },
      free: { w: 0, h: 0 },
      fit: { cols: 1, rows: 1 }
    };
    var fw = fixed ? node.width : reg.w, fh = fixed ? node.height : reg.h;
    var multi = g.cells.length > 1;
    var context = newContext(node, env, box, reg, g);
    var allow = !!env.allow || !!node.allowOverlap, hidden = !!env.hidden || !!node.hidden;
    var fill = node.transparent === true ? 'none' : node.transparent === false ? 'solid' : 'auto';
    context.size = { w: fw, h: fh };
    entry.contexts.push(context);
    for (var i = 0; i < g.cells.length; i++) {
      var cell = g.cells[i];
      if (ctx.budget.left < 1) { ctx.budget.truncated = true; break; }
      ctx.budget.left--;
      var key = env.prefix + node.id + '#' + cell.n;
      var label = node.name + (multi ? ' ' + cell.n : '');
      var f = {
        key: key,
        twin: frameTwin(key),
        kind: 'frame',
        node: node.id,
        ctxKey: env.prefix + node.id,
        groupKey: key,
        ancestors: env.ancestors,
        depth: env.depth,
        dup: env.dup,
        path: context.path,
        relPath: context.relPath,
        label: label,
        n: cell.n,
        row: cell.row,
        col: cell.col,
        index: -1,
        name: node.name,
        color: node.color,
        ral: node.ral || '',
        x: cell.x,
        y: cell.y,
        w: fw,
        h: fh,
        fill: fill,
        transparent: fill === 'none',
        covers: 0,
        allow: allow,
        hidden: hidden,
        overlap: false
      };
      f.rx = f.x - env.origin.x;
      f.ry = f.y - env.origin.y;
      place(ctx, entry, f, reg);
      context.items.push(f);
      computeNodes(node.children, { x: f.x, y: f.y, w: fw, h: fh }, {
        origin: { x: f.x, y: f.y },
        path: join(env.path, label),
        relPath: join(env.relPath, node.name + (multi ? ' ×' + g.cells.length : '')),
        prefix: key + '/',
        ancestors: env.ancestors.concat([key]),
        dup: env.dup || cell.n > 1,
        depth: env.depth + 1,
        names: (env.names || []).concat([node.name]),
        allow: allow,
        hidden: hidden
      }, ctx);
    }
    context.count = context.items.length;
  }

  function computeNodes(list, box, env, ctx) {
    list.forEach(function (node) {
      if (node.type === 'frame') computeFrame(node, box, env, ctx);
      else computeGroup(node, box, env, ctx);
    });
  }

  /*
   * Sovrapposizioni VERE: due blocchi di gruppi diversi che occupano gli stessi pixel.
   * I frame non contano: sono contenitori/livelli e possono stare uno sopra l'altro
   * (es. sfondo, menu, pagina a schermo intero). Un nodo con "sovrapposizione voluta"
   * (o dentro un frame che la ha) non viene segnalato.
   * Restituisce { items, total, pairs[] }: pairs contiene l'oggetto sotto (a), quello
   * sopra (b) e il rettangolo in comune; sono limitati a LIMITS.maxPairs.
   */
  function markOverlaps(items) {
    var blocks = items.filter(function (it) { return it.kind === 'block' && it.w > 0 && it.h > 0; });
    blocks.sort(function (p, q) { return p.x - q.x || p.z - q.z; });
    var pairs = [], total = 0;
    for (var i = 0; i < blocks.length; i++) {
      var a = blocks[i], aEnd = a.x + a.w;
      for (var j = i + 1; j < blocks.length; j++) {
        var b = blocks[j];
        if (b.x >= aEnd) break;
        if (a.groupKey === b.groupKey || a.allow || b.allow) continue;
        var y1 = Math.max(a.y, b.y), y2 = Math.min(a.y + a.h, b.y + b.h);
        if (y2 <= y1) continue;
        var x1 = Math.max(a.x, b.x), x2 = Math.min(aEnd, b.x + b.w);
        a.overlap = true;
        b.overlap = true;
        total++;
        if (pairs.length < LIMITS.maxPairs) {
          var under = a.z < b.z ? a : b, over = under === a ? b : a;
          pairs.push({
            a: under.key, b: over.key, nodeA: under.node, nodeB: over.node,
            x: x1, y: y1, w: x2 - x1, h: y2 - y1, hidden: !!(a.hidden || b.hidden)
          });
        }
      }
    }
    var count = 0;
    for (var k = 0; k < items.length; k++) if (items[k].overlap) count++;
    return { items: count, total: total, pairs: pairs };
  }

  /*
   * Sfondo dei frame: 'solid' (colore pieno), 'none' (trasparente) o 'auto'.
   * Un frame automatico diventa trasparente solo se, essendo pieno, nasconderebbe
   * blocchi disegnati prima (livelli sotto). Per ogni frame si conta quanti blocchi
   * visibili copre (campo covers), così la diagnostica può spiegarlo.
   */
  function resolveFills(items) {
    var blocks = items.filter(function (it) { return it.kind === 'block' && !it.hidden && it.w > 0 && it.h > 0; });
    items.forEach(function (f) {
      if (f.kind !== 'frame') return;
      var n = 0;
      if (!f.hidden && f.fill !== 'none' && f.w > 0 && f.h > 0) {
        for (var i = 0; i < blocks.length; i++) {
          var b = blocks[i];
          if (b.z < f.z && b.x < f.x + f.w && f.x < b.x + b.w && b.y < f.y + f.h && f.y < b.y + b.h) n++;
        }
      }
      f.covers = n;
      if (f.fill === 'auto') f.transparent = n > 0;
    });
  }

  function computeLayout(config) {
    var display = { width: config.display.width, height: config.display.height };
    var ctx = {
      display: display,
      budget: { left: LIMITS.maxTotalItems, truncated: false },
      items: [],
      nodes: {}
    };
    computeNodes(config.nodes, { x: 0, y: 0, w: display.width, h: display.height }, {
      origin: { x: 0, y: 0 }, path: '', relPath: '', prefix: '', ancestors: [], dup: false, depth: 0, names: [],
      allow: false, hidden: false
    }, ctx);

    // Ordine dell'albero e nodi senza istanze (es. dentro un frame con 0 ripetizioni)
    var order = [], hasFrames = false;
    walk(config.nodes, function (n, parent, list, index, depth) {
      var e = ctx.nodes[n.id] || nodeEntry(ctx, n, { depth: depth, names: [] });
      e.parent = parent ? parent.id : '';
      e.depth = depth;
      order.push(n.id);
      if (n.type === 'frame') hasFrames = true;
    });

    var ov = markOverlaps(ctx.items);
    resolveFills(ctx.items);
    var totals = {
      elements: 0, blocks: 0, frames: 0, outArea: 0, outDisplay: 0,
      overlaps: ov.items,        // oggetti coinvolti in una sovrapposizione
      overlapPairs: ov.total     // coppie di blocchi che si sovrappongono
    };
    ctx.items.forEach(function (it) {
      if (it.kind === 'frame') totals.frames++; else totals.blocks++;
      if (it.outArea) totals.outArea++;
      if (it.outDisplay) totals.outDisplay++;
    });
    order.forEach(function (id) {
      var e = ctx.nodes[id];
      if (e.type === 'group') e.contexts.forEach(function (c) { totals.elements += c.count || 0; });
    });

    return {
      display: display,
      items: ctx.items,
      nodes: ctx.nodes,
      order: order,
      roots: config.nodes.map(function (n) { return n.id; }),
      hasFrames: hasFrames,
      totals: totals,
      overlapPairs: ov.pairs,
      truncated: ctx.budget.truncated
    };
  }

  return {
    LIMITS: LIMITS,
    PALETTE: PALETTE,
    toInt: toInt,
    cleanName: cleanName,
    cleanColor: cleanColor,
    colorPair: colorPair,
    defaultConfig: defaultConfig,
    normalizeConfig: normalizeConfig,
    newBlock: newBlock,
    newGroup: newGroup,
    newFrame: newFrame,
    walk: walk,
    walkFront: walkFront,
    findNode: findNode,
    listNodes: listNodes,
    listNodesFront: listNodesFront,
    countNodes: countNodes,
    descendantIds: descendantIds,
    subtreeHeight: subtreeHeight,
    containers: containers,
    insertNode: insertNode,
    moveTo: moveTo,
    moveSibling: moveSibling,
    reorder: reorder,
    canMove: canMove,
    moveNode: moveNode,
    removeNode: removeNode,
    duplicateNode: duplicateNode,
    wrapInFrame: wrapInFrame,
    mergeCandidates: mergeCandidates,
    mergeGroups: mergeGroups,
    elementGeometry: elementGeometry,
    axisPositions: axisPositions,
    maxFit: maxFit,
    computeLayout: computeLayout
  };
}));
