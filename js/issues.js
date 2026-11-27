/*
 * issues.js — Diagnostica del layout.
 *
 * Trasforma i dati del calcolo (js/layout.js) in problemi spiegati in parole
 * semplici: cosa non va, dove (gruppo o frame responsabile), come correggerlo.
 * Ogni problema indica i nodi coinvolti e gli oggetti da evidenziare, così
 * l'interfaccia può portare l'utente direttamente sul punto giusto.
 *
 * Non dipende dal DOM: funziona nel browser (window.DLC.issues) e in Node.js.
 *
 * Problema = {
 *   id, kind, severity ('error' | 'warn' | 'info'),
 *   node      nodo responsabile (dove portare l'utente),
 *   nodes[]   tutti i nodi coinvolti (node per primo),
 *   keys[]    oggetti (chiavi di result.items) da evidenziare,
 *   count     elementi / coppie / blocchi interessati (per i contatori),
 *   title, detail, fix       testi per l'utente,
 *   action    { id, label, node } correzione con un clic (facoltativa)
 * }
 *
 * kind:
 *   'out-display'  oggetti fuori dal display
 *   'bad-area'     area di lavoro non valida (gli offset superano il contenitore)
 *   'out-area'     oggetti fuori dalla propria area
 *   'overlap'      collisione tra blocchi di gruppi diversi
 *   'covered'      frame con sfondo pieno che nasconde blocchi dei livelli sotto
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./layout.js'));
  else (root.DLC = root.DLC || {}).issues = factory(root.DLC.layout);
}(typeof self !== 'undefined' ? self : this, function (L) {
  'use strict';

  var KINDS = ['out-display', 'bad-area', 'out-area', 'overlap', 'covered'];
  var SEVERITY = { 'out-display': 'error', 'bad-area': 'error', 'out-area': 'warn', overlap: 'warn', covered: 'info' };
  var MAX_KEYS = 60;

  function plural(n, one, many) { return n === 1 ? one : many; }
  function q(name) { return '«' + name + '»'; }
  function px(n) { return n + ' px'; }

  /* Elementi distinti (non blocchi) tra gli oggetti indicati; le copie ripetute dei frame contano una volta. */
  function elementsOf(items) {
    var seen = {}, n = 0;
    items.forEach(function (it) {
      var k = it.kind === 'frame' ? it.key : it.groupKey + ':' + it.n;
      if (!seen[k]) { seen[k] = 1; n++; }
    });
    return n;
  }

  function firstContext(entry, pred) {
    for (var i = 0; i < entry.contexts.length; i++) if (pred(entry.contexts[i])) return entry.contexts[i];
    return entry.contexts[0] || null;
  }

  function spread(keys) { return keys.slice(0, MAX_KEYS); }

  /* ------------------------------------------------------------------ */
  /*  Fuori area / fuori display                                          */
  /* ------------------------------------------------------------------ */

  /* Suggerimenti per far entrare nell'area una griglia più grande. */
  function fitAdvice(node, c) {
    var tips = [], over = { w: -c.free.w, h: -c.free.h }, group = node.type === 'group';
    var what = group ? 'gli elementi' : 'i frame';

    if (over.h > 0) {
      var rowsFit = c.fit.rows;
      if (isFinite(rowsFit)) {
        var keep = Math.max(0, rowsFit) * Math.max(1, node.columns);
        if (rowsFit > 0 && keep < node.count) tips.push('riduci ' + what + ' a ' + keep + ' (' + rowsFit + ' ' + plural(rowsFit, 'riga', 'righe') + ')');
      }
      var side = node.alignV === 'end' ? 'top' : node.alignV === 'start' ? 'bottom' : null;
      if (side && node.area[side] >= over.h) {
        tips.push('riduci l\'offset ' + (side === 'top' ? 'in alto' : 'in basso') + ' da ' + node.area[side] + ' a ' + (node.area[side] - over.h));
      } else {
        tips.push('riduci gli offset in alto/in basso di ' + px(over.h) + ' in totale');
      }
      if (c.rows > 1 && node.rowGap > 0 && node.alignV !== 'distribute') {
        var gapH = node.rowGap - Math.ceil(over.h / (c.rows - 1));
        if (gapH >= 0) tips.push('porta la distanza tra le righe da ' + node.rowGap + ' a ' + gapH);
      }
    }
    if (over.w > 0) {
      var colsFit = c.fit.cols;
      if (isFinite(colsFit) && colsFit > 0 && colsFit < c.cols) {
        tips.push('usa al massimo ' + colsFit + ' ' + plural(colsFit, 'colonna', 'colonne'));
      }
      var sideW = node.alignH === 'end' ? 'left' : node.alignH === 'start' ? 'right' : null;
      if (sideW && node.area[sideW] >= over.w) {
        tips.push('riduci l\'offset a ' + (sideW === 'left' ? 'sinistra' : 'destra') + ' da ' + node.area[sideW] + ' a ' + (node.area[sideW] - over.w));
      } else {
        tips.push('riduci gli offset a sinistra/destra di ' + px(over.w) + ' in totale');
      }
      if (c.cols > 1 && node.colGap > 0 && node.alignH !== 'distribute') {
        var gapW = node.colGap - Math.ceil(over.w / (c.cols - 1));
        if (gapW >= 0) tips.push('porta la distanza tra le colonne da ' + node.colGap + ' a ' + gapW);
      }
    }
    return tips;
  }

  function areaIssue(node, entry, flagged) {
    var c = firstContext(entry, function (x) { return x.items.some(function (it) { return it.outArea && !it.dup; }); });
    var n = elementsOf(flagged);
    var group = entry.type === 'group';
    var inDisplay = flagged.filter(function (it) { return it.outDisplay; });
    var detail, tips = [];
    if (c && c.region.valid && c.count) {
      var over = { w: -c.free.w, h: -c.free.h };
      var parts = [];
      if (over.h > 0) {
        parts.push('in altezza servono ' + px(c.grid.h) + ' ma l\'area è alta ' + px(c.region.h) + ' (mancano ' + px(over.h) +
          '; ci stanno ' + (isFinite(c.fit.rows) ? c.fit.rows : '∞') + ' ' + plural(c.fit.rows, 'riga', 'righe') + ', ne hai ' + c.rows + ')');
      }
      if (over.w > 0) {
        parts.push('in larghezza servono ' + px(c.grid.w) + ' ma l\'area è larga ' + px(c.region.w) + ' (mancano ' + px(over.w) +
          '; ci stanno ' + (isFinite(c.fit.cols) ? c.fit.cols : '∞') + ' ' + plural(c.fit.cols, 'colonna', 'colonne') + ', ne hai ' + c.cols + ')');
      }
      detail = parts.length
        ? 'L\'area di lavoro misura ' + c.region.w + ' × ' + c.region.h + ' px: ' + parts.join('; ') + '.'
        : 'Alcuni blocchi sporgono dall\'area di lavoro (distanze negative o blocchi di altezza diversa).';
      tips = fitAdvice(node, c);
    } else {
      detail = 'Gli oggetti escono dall\'area di lavoro del contenitore.';
    }
    if (inDisplay.length) detail += ' ' + elementsOf(inDisplay) + ' ' + plural(elementsOf(inDisplay), 'esce', 'escono') + ' anche dal display.';
    var title = q(entry.name) + ': ' + n + ' ' + (group ? plural(n, 'elemento fuori', 'elementi fuori') : plural(n, 'copia fuori', 'copie fuori')) +
      ' dalla propria area';
    return {
      id: 'out-area:' + entry.id, kind: 'out-area', severity: SEVERITY['out-area'],
      node: entry.id, nodes: [entry.id], keys: spread(flagged.map(function (it) { return it.key; })), count: n,
      title: title, detail: detail,
      fix: tips.length ? 'Per sistemarlo: ' + tips.join(', oppure ') + '.' : ''
    };
  }

  function displayIssue(entry, flagged, display) {
    var n = elementsOf(flagged), right = 0, bottom = 0, left = 0, top = 0;
    flagged.forEach(function (it) {
      right = Math.max(right, it.x + it.w - display.width);
      bottom = Math.max(bottom, it.y + it.h - display.height);
      left = Math.max(left, -it.x);
      top = Math.max(top, -it.y);
    });
    var sides = [];
    if (right > 0) sides.push(px(right) + ' a destra');
    if (bottom > 0) sides.push(px(bottom) + ' in basso');
    if (left > 0) sides.push(px(left) + ' a sinistra');
    if (top > 0) sides.push(px(top) + ' in alto');
    return {
      id: 'out-display:' + entry.id, kind: 'out-display', severity: SEVERITY['out-display'],
      node: entry.id, nodes: [entry.id], keys: spread(flagged.map(function (it) { return it.key; })), count: n,
      title: q(entry.name) + ': ' + n + ' ' + plural(n, 'elemento esce', 'elementi escono') + ' dal display',
      detail: 'Il display misura ' + display.width + ' × ' + display.height + ' px' + (sides.length ? ' e gli oggetti sporgono di ' + sides.join(', ') : '') + '.',
      fix: 'Controlla gli offset, il numero di elementi e le distanze: la parte fuori dal display non si vedrebbe.'
    };
  }

  function badAreaIssue(node, entry, c) {
    var b = c.box, a = node.area, parts = [];
    if (b.w - a.left - a.right <= 0) parts.push('in orizzontale ' + a.left + ' + ' + a.right + ' px di offset su ' + px(b.w));
    if (b.h - a.top - a.bottom <= 0) parts.push('in verticale ' + a.top + ' + ' + a.bottom + ' px di offset su ' + px(b.h));
    var items = entry.items.filter(function (it) { return !it.dup; });
    return {
      id: 'bad-area:' + entry.id, kind: 'bad-area', severity: SEVERITY['bad-area'],
      node: entry.id, nodes: [entry.id], keys: spread(items.map(function (it) { return it.key; })), count: Math.max(1, elementsOf(items)),
      title: q(entry.name) + ': area di lavoro non valida',
      detail: 'Gli offset superano le dimensioni del contenitore (' + b.w + ' × ' + b.h + ' px): ' + parts.join('; ') + '.',
      fix: 'Riduci gli offset finché l\'area ha una larghezza e un\'altezza positive.'
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Sovrapposizioni e frame che coprono                                 */
  /* ------------------------------------------------------------------ */

  function overlapIssues(config, result, byKey) {
    var groups = {}, order = [];
    (result.overlapPairs || []).forEach(function (p) {
      var k = p.nodeA + '|' + p.nodeB;
      if (!groups[k]) { groups[k] = { a: p.nodeA, b: p.nodeB, pairs: [], twins: {} }; order.push(k); }
      var g = groups[k], A = byKey[p.a], B = byKey[p.b];
      var tw = (A ? A.twin : p.a) + '|' + (B ? B.twin : p.b);
      g.pairs.push(p);
      g.twins[tw] = 1;
    });
    return order.map(function (k) {
      var g = groups[k], ea = result.nodes[g.a], eb = result.nodes[g.b];
      var first = g.pairs[0], A = byKey[first.a], B = byKey[first.b];
      var count = Object.keys(g.twins).length, needX = 0, needY = 0, keys = [];
      g.pairs.forEach(function (p) {
        needX = Math.max(needX, p.w);
        needY = Math.max(needY, p.h);
        keys.push(p.a, p.b);
      });
      var same = g.a === g.b;
      var title = same ? q(ea.name) + ': i blocchi di copie diverse si sovrappongono'
        : q(ea.name) + ' e ' + q(eb.name) + ' si sovrappongono';
      var detail = count + ' ' + plural(count, 'collisione', 'collisioni') + '. Esempio: ' +
        q(A ? A.name + ' ' + A.n : first.a) + ' (sul display X ' + (A ? A.x : '?') + ', Y ' + (A ? A.y : '?') + ', ' + (A ? A.w + ' × ' + A.h : '') + ') e ' +
        q(B ? B.name + ' ' + B.n : first.b) + ' (X ' + (B ? B.x : '?') + ', Y ' + (B ? B.y : '?') + ', ' + (B ? B.w + ' × ' + B.h : '') + '): ' +
        'hanno in comune ' + first.w + ' × ' + first.h + ' px a X ' + first.x + ', Y ' + first.y + '.';
      return {
        id: 'overlap:' + k, kind: 'overlap', severity: SEVERITY.overlap,
        node: g.a, nodes: same ? [g.a] : [g.a, g.b], keys: spread(keys), count: count,
        title: title, detail: detail,
        fix: 'Per separarli basta spostare uno dei due di almeno ' + px(needX) + ' in orizzontale (o ' + px(needY) +
          ' in verticale), oppure ridurne la dimensione. Se la sovrapposizione è voluta, attiva «Sovrapposizione voluta» su uno dei due.'
      };
    });
  }

  function coveredIssues(result) {
    var by = {}, order = [];
    result.items.forEach(function (it) {
      if (it.kind !== 'frame' || it.fill !== 'solid' || !it.covers || it.hidden) return;
      if (!by[it.node]) { by[it.node] = { covers: 0, keys: [] }; order.push(it.node); }
      by[it.node].covers = Math.max(by[it.node].covers, it.covers);
      by[it.node].keys.push(it.key);
    });
    return order.map(function (id) {
      var e = result.nodes[id], n = by[id].covers;
      return {
        id: 'covered:' + id, kind: 'covered', severity: SEVERITY.covered,
        node: id, nodes: [id], keys: spread(by[id].keys), count: n,
        title: 'Il frame ' + q(e.name) + ' nasconde ' + n + ' ' + plural(n, 'blocco', 'blocchi') + ' dei livelli sotto',
        detail: 'Ha lo sfondo pieno ed è davanti ad altri livelli: nella vista reale e nelle immagini esportate i blocchi coperti non si vedono.',
        fix: 'Rendi il suo sfondo trasparente (o «Automatico»), oppure portalo dietro con «Porta indietro».',
        action: { id: 'transparent', label: 'Rendi trasparente', node: id }
      };
    });
  }

  /* ------------------------------------------------------------------ */
  /*  API                                                                 */
  /* ------------------------------------------------------------------ */

  /* Tutti i problemi del layout, dal più grave: prima errori, poi avvisi, poi note; a parità, nell'ordine dell'albero. */
  function build(config, result) {
    var out = [], byKey = {};
    result.items.forEach(function (it) { byKey[it.key] = it; });
    var treeIndex = {};
    result.order.forEach(function (id, i) { treeIndex[id] = i; });

    result.order.forEach(function (id) {
      var e = result.nodes[id], f = L.findNode(config, id);
      if (!e || !f || !e.contexts.length) return;
      var own = e.items.filter(function (it) { return !it.dup; });
      var invalid = firstContext(e, function (c) { return !c.region.valid; });
      if (invalid && !invalid.region.valid) {
        out.push(badAreaIssue(f.node, e, invalid));
      }
      var inDisplay = own.filter(function (it) { return it.outDisplay; });
      if (inDisplay.length) out.push(displayIssue(e, inDisplay, result.display));
      var inArea = own.filter(function (it) { return it.outArea && !(invalid && !invalid.region.valid); });
      if (inArea.length) out.push(areaIssue(f.node, e, inArea));
    });
    out = out.concat(overlapIssues(config, result, byKey), coveredIssues(result));

    var rank = { error: 0, warn: 1, info: 2 };
    out.forEach(function (it, i) { it.seq = i; });
    out.sort(function (p, q2) {
      return rank[p.severity] - rank[q2.severity] ||
        (treeIndex[p.node] || 0) - (treeIndex[q2.node] || 0) || p.seq - q2.seq;
    });
    out.forEach(function (it) { delete it.seq; });
    return out;
  }

  /* Problemi che riguardano almeno uno dei nodi indicati ({id: true}); senza filtro, tutti. */
  function forNodes(issues, filter) {
    if (!filter) return issues;
    return issues.filter(function (it) { return it.nodes.some(function (id) { return filter[id]; }); });
  }

  /* Totali per tipo: { kind: { issues, count } }. */
  function totals(issues) {
    var t = {};
    KINDS.forEach(function (k) { t[k] = { issues: 0, count: 0, list: [] }; });
    issues.forEach(function (it) {
      var x = t[it.kind];
      x.issues++;
      x.count += it.count;
      x.list.push(it);
    });
    return t;
  }

  return {
    KINDS: KINDS,
    build: build,
    forNodes: forNodes,
    totals: totals
  };
}));
