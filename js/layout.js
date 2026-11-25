/*
 * layout.js — Motore di calcolo del layout del display.
 *
 * Non dipende dal DOM: funziona nel browser (window.DLC.layout) e in Node.js
 * (require) per i test automatici.
 *
 * Modello della configurazione
 * ----------------------------
 *   display  : { width, height }                 dimensioni del display in pixel
 *   groups[] : gruppi di elementi, ognuno con:
 *     area      : { top, bottom, left, right }  offset dai bordi del display
 *                                                (delimitano l'area di lavoro)
 *     direction : 'h' blocchi affiancati | 'v' blocchi impilati
 *     blocks[]  : { name, width, height, gap, align, color }
 *                 gap   = distanza PRIMA del blocco: dal blocco precedente,
 *                         per il primo blocco dal bordo dell'elemento
 *                 align = allineamento trasversale 'start' | 'center' | 'end'
 *                         (es. LED più basso della scritta → centrato)
 *     count     : numero di elementi (un elemento = la sequenza di blocchi)
 *     columns   : colonne della griglia di elementi
 *     order     : numerazione 'rows' (per righe) | 'cols' (per colonne)
 *     rowGap    : distanza verticale tra le righe
 *     colGap    : distanza orizzontale tra le colonne
 *     alignH/V  : posizione della griglia nell'area:
 *                 'start' | 'center' | 'end' | 'distribute'
 *
 * Le coordinate calcolate sono intere e riferite all'angolo in alto a sinistra
 * del display (0, 0), come la "Posizione X/Y" degli elementi CODESYS.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.DLC = root.DLC || {}).layout = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LIMITS = {
    displaySize: [1, 10000],
    offset: [0, 10000],
    blockSize: [1, 10000],
    gap: [-10000, 10000],
    count: [0, 1000],
    columns: [1, 100],
    maxBlocks: 12,
    maxGroups: 12,
    maxTotalBlocks: 5000,
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

  /* ------------------------------------------------------------------ */
  /*  Valori predefiniti                                                 */
  /* ------------------------------------------------------------------ */

  function makeBlock(name, width, height, gap, color, align) {
    return { name: name, width: width, height: height, gap: gap, align: align || 'center', color: color };
  }

  /* L'esempio di partenza: LED 50×50 + Scritta 300×50, distanza 15 px,
     6 righe a 20 px una dall'altra, area ridotta di 30 px in alto e 50 in basso. */
  function defaultGroup(index) {
    return {
      name: 'Gruppo ' + ((index || 0) + 1),
      area: { top: 30, bottom: 50, left: 0, right: 0 },
      direction: 'h',
      blocks: [
        makeBlock('LED', 50, 50, 15, PALETTE[0]),
        makeBlock('Scritta', 300, 50, 15, PALETTE[1])
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
      v: 1,
      name: 'Layout display',
      display: { width: 800, height: 480 },
      groups: [defaultGroup(0)]
    };
  }

  function usedColors(config) {
    var out = [];
    (config && config.groups || []).forEach(function (g) {
      (g.blocks || []).forEach(function (b) { if (b && b.color) out.push(b.color); });
    });
    return out;
  }

  function pickColor(used) {
    for (var i = 0; i < PALETTE.length; i++) {
      if (used.indexOf(PALETTE[i]) === -1) return PALETTE[i];
    }
    return PALETTE[used.length % PALETTE.length];
  }

  /* Nuovo blocco da aggiungere a un gruppo: stessa altezza dell'ultimo. */
  function newBlock(group, config) {
    var blocks = group.blocks || [];
    var last = blocks[blocks.length - 1];
    return makeBlock(
      'Blocco ' + (blocks.length + 1),
      100,
      last ? last.height : 50,
      blocks.length > 1 ? last.gap : 10,
      pickColor(usedColors(config || { groups: [group] })),
      'center'
    );
  }

  /* Nuovo gruppo "intelligente": se il gruppo di partenza lascia libera una
     fascia in basso (o in alto), il nuovo gruppo la occupa con una fila di
     pulsanti centrati; altrimenti usa tutto il display. */
  function suggestGroup(config, fromIndex) {
    var d = config.display;
    var src = config.groups[fromIndex] || config.groups[0];
    var g = {
      name: 'Gruppo ' + (config.groups.length + 1),
      area: { top: 0, bottom: 0, left: 0, right: 0 },
      direction: 'h',
      blocks: [makeBlock('Pulsante', 120, 40, 0, pickColor(usedColors(config)), 'center')],
      count: 4,
      columns: 4,
      order: 'rows',
      rowGap: 10,
      colGap: 20,
      alignH: 'start',
      alignV: 'start'
    };
    if (src) {
      var strip = null;
      if (src.area.bottom >= 20) strip = { top: d.height - src.area.bottom, bottom: 0 };
      else if (src.area.top >= 20) strip = { top: 0, bottom: d.height - src.area.top };
      if (strip) {
        var stripH = d.height - strip.top - strip.bottom;
        g.area.top = strip.top;
        g.area.bottom = strip.bottom;
        g.area.left = src.area.left;
        g.area.right = src.area.right;
        g.blocks[0].height = Math.max(10, Math.min(40, stripH - 10));
        g.alignH = 'center';
        g.alignV = 'center';
      }
    }
    return g;
  }

  /* ------------------------------------------------------------------ */
  /*  Normalizzazione (dati caricati da file, link o memoria locale)     */
  /* ------------------------------------------------------------------ */

  function normalizeBlock(raw, index) {
    raw = isObject(raw) ? raw : {};
    return {
      name: cleanName(raw.name, 'Blocco ' + (index + 1)),
      width: toInt(raw.width, LIMITS.blockSize, 50),
      height: toInt(raw.height, LIMITS.blockSize, 50),
      gap: toInt(raw.gap, LIMITS.gap, 0),
      align: oneOf(raw.align, BLOCK_ALIGN, 'center'),
      color: cleanColor(raw.color, PALETTE[index % PALETTE.length])
    };
  }

  function normalizeGroup(raw, index) {
    raw = isObject(raw) ? raw : {};
    var area = isObject(raw.area) ? raw.area : {};
    var blocks = Array.isArray(raw.blocks)
      ? raw.blocks.slice(0, LIMITS.maxBlocks).map(normalizeBlock)
      : [];
    if (!blocks.length) blocks = [normalizeBlock({}, 0)];
    return {
      name: cleanName(raw.name, 'Gruppo ' + (index + 1)),
      area: {
        top: toInt(area.top, LIMITS.offset, 0),
        bottom: toInt(area.bottom, LIMITS.offset, 0),
        left: toInt(area.left, LIMITS.offset, 0),
        right: toInt(area.right, LIMITS.offset, 0)
      },
      direction: oneOf(raw.direction, DIRECTIONS, 'h'),
      blocks: blocks,
      count: toInt(raw.count, LIMITS.count, 1),
      columns: toInt(raw.columns, LIMITS.columns, 1),
      order: oneOf(raw.order, ORDERS, 'rows'),
      rowGap: toInt(raw.rowGap, LIMITS.gap, 0),
      colGap: toInt(raw.colGap, LIMITS.gap, 0),
      alignH: oneOf(raw.alignH, GRID_ALIGN, 'start'),
      alignV: oneOf(raw.alignV, GRID_ALIGN, 'start')
    };
  }

  function normalizeConfig(raw) {
    raw = isObject(raw) ? raw : {};
    var d = isObject(raw.display) ? raw.display : {};
    var groups = Array.isArray(raw.groups)
      ? raw.groups.slice(0, LIMITS.maxGroups).map(normalizeGroup)
      : [];
    if (!groups.length) groups = [defaultGroup(0)];
    return {
      v: 1,
      name: cleanName(raw.name, 'Layout display', LIMITS.configNameLength),
      display: {
        width: toInt(d.width, LIMITS.displaySize, 800),
        height: toInt(d.height, LIMITS.displaySize, 480)
      },
      groups: groups
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
      if (n === 1) {
        return { pos: [start + Math.floor((avail - size) / 2)], gap: 0, span: size };
      }
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

  function computeGroup(g, gi, display, budget) {
    var rawW = display.width - g.area.left - g.area.right;
    var rawH = display.height - g.area.top - g.area.bottom;
    var area = { x: g.area.left, y: g.area.top, w: Math.max(0, rawW), h: Math.max(0, rawH) };
    var areaValid = rawW > 0 && rawH > 0;
    var el = elementGeometry(g);
    var blockNames = g.blocks.map(function (b, i) { return b.name || ('Blocco ' + (i + 1)); });

    var n = g.count, C = Math.max(1, g.columns), rows = 0, cols = 0;
    if (n > 0) {
      if (g.order === 'cols') { rows = Math.ceil(n / C); cols = Math.ceil(n / rows); }
      else { cols = Math.min(C, n); rows = Math.ceil(n / C); }
    }

    var ax = axisPositions(cols, el.w, g.colGap, area.x, area.w, g.alignH);
    var ay = axisPositions(rows, el.h, g.rowGap, area.y, area.h, g.alignV);

    var items = [], blocks = [], outArea = 0, outDisplay = 0;
    for (var i = 0; i < n; i++) {
      if (budget.left < el.blocks.length) { budget.truncated = true; break; }
      budget.left -= el.blocks.length;
      var r = g.order === 'cols' ? i % rows : Math.floor(i / C);
      var c = g.order === 'cols' ? Math.floor(i / rows) : i % C;
      var ex = ax.pos[c], ey = ay.pos[r];
      var item = { n: i + 1, row: r + 1, col: c + 1, x: ex, y: ey, w: el.w, h: el.h, blocks: [] };
      for (var bi = 0; bi < el.blocks.length; bi++) {
        var t = el.blocks[bi];
        var b = {
          key: gi + ':' + (i + 1) + ':' + bi,
          group: gi,
          n: i + 1,
          row: r + 1,
          col: c + 1,
          index: bi,
          name: blockNames[bi],
          color: g.blocks[bi].color,
          x: ex + t.x,
          y: ey + t.y,
          w: t.w,
          h: t.h,
          overlap: false
        };
        b.outDisplay = b.x < 0 || b.y < 0 || b.x + b.w > display.width || b.y + b.h > display.height;
        b.outArea = !areaValid || b.x < area.x || b.y < area.y ||
          b.x + b.w > area.x + area.w || b.y + b.h > area.y + area.h;
        if (b.outArea) outArea++;
        if (b.outDisplay) outDisplay++;
        item.blocks.push(b);
        blocks.push(b);
      }
      items.push(item);
    }

    var gx = cols ? Math.min.apply(null, ax.pos) : area.x;
    var gy = rows ? Math.min.apply(null, ay.pos) : area.y;
    var gw = cols ? Math.max.apply(null, ax.pos) + el.w - gx : 0;
    var gh = rows ? Math.max.apply(null, ay.pos) + el.h - gy : 0;

    return {
      index: gi,
      name: g.name || ('Gruppo ' + (gi + 1)),
      area: area,
      areaValid: areaValid,
      element: el,
      blockNames: blockNames,
      rows: rows,
      cols: cols,
      count: items.length,
      gaps: { col: ax.gap, row: ay.gap },
      grid: { x: gx, y: gy, w: gw, h: gh },
      free: { w: area.w - gw, h: area.h - gh },
      fit: {
        cols: maxFit(area.w, el.w, g.alignH === 'distribute' ? 0 : g.colGap),
        rows: maxFit(area.h, el.h, g.alignV === 'distribute' ? 0 : g.rowGap)
      },
      items: items,
      blocks: blocks,
      out: { area: outArea, display: outDisplay }
    };
  }

  /* Segnala i blocchi che si sovrappongono a blocchi di ALTRI gruppi
     (dentro lo stesso gruppo le sovrapposizioni sono volute: distanze negative). */
  function markOverlaps(blocks) {
    if (blocks.length > 2500) return -1;
    var count = 0, i, j;
    for (i = 0; i < blocks.length; i++) {
      var a = blocks[i];
      for (j = i + 1; j < blocks.length; j++) {
        var b = blocks[j];
        if (a.group === b.group) continue;
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
          a.overlap = true;
          b.overlap = true;
        }
      }
    }
    for (i = 0; i < blocks.length; i++) if (blocks[i].overlap) count++;
    return count;
  }

  function computeLayout(config) {
    var display = { width: config.display.width, height: config.display.height };
    var budget = { left: LIMITS.maxTotalBlocks, truncated: false };
    var groups = config.groups.map(function (g, gi) { return computeGroup(g, gi, display, budget); });
    var blocks = [];
    groups.forEach(function (g) { for (var i = 0; i < g.blocks.length; i++) blocks.push(g.blocks[i]); });
    var overlaps = markOverlaps(blocks);
    var totals = { elements: 0, blocks: blocks.length, outArea: 0, outDisplay: 0, overlaps: overlaps };
    groups.forEach(function (g) {
      totals.elements += g.items.length;
      totals.outArea += g.out.area;
      totals.outDisplay += g.out.display;
    });
    return { display: display, groups: groups, blocks: blocks, totals: totals, truncated: budget.truncated };
  }

  return {
    LIMITS: LIMITS,
    PALETTE: PALETTE,
    toInt: toInt,
    cleanName: cleanName,
    cleanColor: cleanColor,
    defaultConfig: defaultConfig,
    defaultGroup: defaultGroup,
    suggestGroup: suggestGroup,
    newBlock: newBlock,
    normalizeConfig: normalizeConfig,
    elementGeometry: elementGeometry,
    axisPositions: axisPositions,
    maxFit: maxFit,
    computeLayout: computeLayout
  };
}));
