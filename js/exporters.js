/*
 * exporters.js — Tabelle e formati di esportazione delle coordinate.
 *
 *   buildSheets  → righe/colonne per la tabella stile Excel
 *                  (vista "per blocco" o "per elemento")
 *   sheetsToTSV  → testo con tabulazioni: si incolla direttamente in Excel
 *   sheetsToCSV  → file CSV (separatore ";" per Excel in italiano)
 *   toST         → codice Structured Text per CODESYS (DUT + GVL)
 *   toText       → elenco leggibile
 *   toJSON       → dati strutturati (albero con frame e gruppi)
 *
 * Opzione "coord":
 *   'frame'   coordinate relative al frame che contiene l'oggetto (come dentro
 *             la visualizzazione di un Frame CODESYS); il contenuto dei frame
 *             ripetuti compare una volta sola, perché è identico in ogni copia
 *   'display' coordinate assolute sul display, per ogni copia
 *
 * Non dipende dal DOM (testabile in Node.js).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ral.js'));
  else (root.DLC = root.DLC || {}).exporters = factory(root.DLC.ral);
}(typeof self !== 'undefined' ? self : this, function (RAL) {
  'use strict';

  function coordOf(opts) { return opts && opts.coord === 'display' ? 'display' : 'frame'; }

  /* Oggetti da esportare: filtro per nodi e, con coordinate relative, senza
     le copie identiche dei frame ripetuti. */
  function pickItems(result, opts) {
    var coord = coordOf(opts), filter = opts && opts.nodes;
    return result.items.filter(function (it) {
      if (coord === 'frame' && it.dup) return false;
      return !filter || !!filter[it.node];
    });
  }

  function X(it, coord) { return coord === 'display' ? it.x : it.rx; }
  function Y(it, coord) { return coord === 'display' ? it.y : it.ry; }
  function pathOf(it, coord) { return coord === 'display' ? it.path : it.relPath; }
  function colorText(it) { return RAL.format(it.color, it.ral); }

  function hasWarning(it) { return !!(it.outArea || it.outDisplay || it.overlap); }

  function uniqueLabels(names) {
    var seen = {};
    return names.map(function (n) {
      var k = n.toLowerCase();
      seen[k] = (seen[k] || 0) + 1;
      return seen[k] > 1 ? n + ' (' + seen[k] + ')' : n;
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Tabelle                                                            */
  /* ------------------------------------------------------------------ */

  /*
   * Restituisce un elenco di fogli { title, node, columns[], rows[] }.
   *   columns[i] = { label, field, num, coord, blockIdx, title }
   *   rows[i]    = { values[], keys[] (oggetti della riga), warn, kind }
   * opts = { view: 'long'|'wide', coord: 'frame'|'display', nodes: {id: true} }
   */
  function buildSheets(result, opts) {
    opts = opts || {};
    var coord = coordOf(opts);
    var items = pickItems(result, opts);
    var showPath = result.hasFrames || result.order.length > 1;
    var xTitle = coord === 'display' ? 'rispetto al display' : 'rispetto al frame che lo contiene (o al display)';

    if (opts.view === 'wide') {
      var sheets = [];
      result.order.forEach(function (id) {
        var e = result.nodes[id];
        if (opts.nodes && !opts.nodes[id]) return;
        var contexts = e.contexts.filter(function (c) { return coord === 'display' || !c.dup; });
        if (!contexts.length) return;
        var withCtx = e.depth > 0;
        var columns = [];
        if (withCtx) columns.push({ label: 'Frame', field: 'ctx', title: 'Frame che contiene l\'elemento' });
        columns.push(
          { label: 'Elem.', field: 'n', num: true, title: 'Numero dell\'elemento' },
          { label: 'Riga', field: 'row', num: true, title: 'Riga della griglia' },
          { label: 'Col.', field: 'col', num: true, title: 'Colonna della griglia' }
        );
        var rows = [];
        if (e.type === 'group') {
          uniqueLabels(e.blockNames).forEach(function (name, bi) {
            var size = contexts[0].element.blocks[bi];
            var title = name + ': ' + size.w + ' × ' + size.h + ' px, ' + xTitle;
            columns.push({ label: name + ' X', field: 'x', blockIdx: bi, num: true, coord: true, title: title });
            columns.push({ label: name + ' Y', field: 'y', blockIdx: bi, num: true, coord: true, title: title });
          });
          contexts.forEach(function (c) {
            c.items.forEach(function (el) {
              var values = withCtx ? [coord === 'display' ? c.parentPath : c.parentRelPath] : [];
              var warn = false;
              values.push(el.n, el.row, el.col);
              el.blocks.forEach(function (b) {
                values.push(X(b, coord), Y(b, coord));
                if (hasWarning(b)) warn = true;
              });
              rows.push({ values: values, keys: el.blocks.map(function (b) { return b.key; }), warn: warn, kind: 'block' });
            });
          });
        } else {
          columns.push(
            { label: 'X', field: 'x', num: true, coord: true, title: 'X ' + xTitle },
            { label: 'Y', field: 'y', num: true, coord: true, title: 'Y ' + xTitle },
            { label: 'Larg.', field: 'w', num: true, title: 'Larghezza (px)' },
            { label: 'Alt.', field: 'h', num: true, title: 'Altezza (px)' }
          );
          contexts.forEach(function (c) {
            c.items.forEach(function (f) {
              var values = withCtx ? [coord === 'display' ? c.parentPath : c.parentRelPath] : [];
              values.push(f.n, f.row, f.col, X(f, coord), Y(f, coord), f.w, f.h);
              rows.push({ values: values, keys: [f.key], warn: hasWarning(f), kind: 'frame' });
            });
          });
        }
        sheets.push({
          title: contexts[0].relPath + (e.type === 'frame' ? ' (frame)' : ''),
          node: id,
          columns: columns,
          rows: rows
        });
      });
      if (sheets.length === 1) sheets[0].title = '';
      return sheets;
    }

    var columns = [];
    if (showPath) columns.push({ label: 'Percorso', field: 'path', title: 'Frame e gruppo a cui appartiene' });
    columns.push(
      { label: 'Elem.', field: 'n', num: true, title: 'Numero dell\'elemento (o della copia del frame)' },
      { label: 'Riga', field: 'row', num: true, title: 'Riga della griglia' },
      { label: 'Col.', field: 'col', num: true, title: 'Colonna della griglia' },
      { label: 'Blocco', field: 'name' },
      { label: 'X', field: 'x', num: true, coord: true, title: 'X dell\'angolo in alto a sinistra, ' + xTitle },
      { label: 'Y', field: 'y', num: true, coord: true, title: 'Y dell\'angolo in alto a sinistra, ' + xTitle },
      { label: 'Larg.', field: 'w', num: true, title: 'Larghezza (px)' },
      { label: 'Alt.', field: 'h', num: true, title: 'Altezza (px)' },
      { label: 'Colore', field: 'color', title: 'Codice RAL o esadecimale' }
    );
    var rows = items.map(function (it) {
      var values = showPath ? [pathOf(it, coord)] : [];
      values.push(it.n, it.row, it.col, it.kind === 'frame' ? 'Frame' : it.name, X(it, coord), Y(it, coord), it.w, it.h, colorText(it));
      return { values: values, keys: [it.key], warn: hasWarning(it), kind: it.kind };
    });
    return [{ title: '', node: null, columns: columns, rows: rows }];
  }

  /* Testo sicuro per una cella di Excel: niente tabulazioni o a capo e
     nessun testo che Excel potrebbe interpretare come formula. */
  function cellText(value) {
    if (typeof value === 'number') return String(value);
    var s = String(value == null ? '' : value).replace(/[\t\r\n]+/g, ' ');
    return /^[=+\-@]/.test(s) ? '\'' + s : s;
  }

  function sheetsToTSV(sheets, opts) {
    opts = opts || {};
    var headers = opts.headers !== false, out = [];
    sheets.forEach(function (s, i) {
      if (i > 0) out.push('');
      if (s.title && sheets.length > 1) out.push(cellText(s.title));
      if (headers) out.push(s.columns.map(function (c) { return cellText(c.label); }).join('\t'));
      s.rows.forEach(function (r) { out.push(r.values.map(cellText).join('\t')); });
    });
    return out.join(opts.eol || '\n');
  }

  function csvCell(value, sep) {
    var s = cellText(value);
    if (s.indexOf(sep) !== -1 || s.indexOf('"') !== -1 || /^\s|\s$/.test(s)) {
      s = '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function sheetsToCSV(sheets, opts) {
    opts = opts || {};
    var sep = opts.sep || ';', headers = opts.headers !== false, out = [];
    sheets.forEach(function (s, i) {
      if (i > 0) out.push('');
      if (s.title && sheets.length > 1) out.push(csvCell(s.title, sep));
      if (headers) out.push(s.columns.map(function (c) { return csvCell(c.label, sep); }).join(sep));
      s.rows.forEach(function (r) {
        out.push(r.values.map(function (v) { return csvCell(v, sep); }).join(sep));
      });
    });
    return out.join('\r\n');
  }

  /* ------------------------------------------------------------------ */
  /*  CODESYS Structured Text                                            */
  /* ------------------------------------------------------------------ */

  /* Identificatore IEC 61131-3 valido: lettere/cifre/underscore, senza
     accenti, senza "__" e senza underscore iniziali o finali. */
  function identifier(text, fallback) {
    var s = String(text == null ? '' : text);
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    s = s.replace(/[^A-Za-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return s || fallback;
  }

  function commentText(s) {
    return String(s).replace(/\(\*|\*\)/g, '').replace(/[\r\n]+/g, ' ');
  }

  function toST(result, opts) {
    opts = opts || {};
    var coord = coordOf(opts);
    var typeName = identifier(opts.typeName, 'ST_VisuRect');
    if (/^[0-9]/.test(typeName)) typeName = 'ST_' + typeName;
    var base = Number(opts.base) === 0 ? 0 : 1;
    var items = pickItems(result, opts);
    var W = result.display.width, H = result.display.height;
    var ids = result.order.filter(function (id) { return !opts.nodes || opts.nodes[id]; });
    var withPrefix = ids.length > 1;

    var dut = [
      '(* Rettangolo di un elemento di visualizzazione [px] *)',
      'TYPE ' + typeName + ' :',
      'STRUCT',
      '\tiX : INT;\t(* X dell\'angolo in alto a sinistra *)',
      '\tiY : INT;\t(* Y dell\'angolo in alto a sinistra *)',
      '\tiW : INT;\t(* larghezza *)',
      '\tiH : INT;\t(* altezza *)',
      'END_STRUCT',
      'END_TYPE'
    ].join('\n');

    var used = {};
    used[typeName.toLowerCase()] = true;
    function unique(name) {
      var n = name, i = 2;
      while (used[n.toLowerCase()]) n = name + '_' + (i++);
      used[n.toLowerCase()] = true;
      return n;
    }

    function array(name, list, label) {
      var out = ['\t' + name + ' : ARRAY[' + base + '..' + (base + list.length - 1) + '] OF ' + typeName + ' := ['];
      list.forEach(function (it, ii) {
        var sep = ii < list.length - 1 ? ',' : '';
        out.push('\t\t(iX := ' + X(it, coord) + ', iY := ' + Y(it, coord) + ', iW := ' + it.w + ', iH := ' + it.h + ')' + sep +
          '\t(* [' + (base + ii) + '] ' + commentText(label(it)) + ' *)');
      });
      out.push('\t];');
      return out;
    }

    var gvl = [];
    gvl.push('(* Layout display ' + W + ' x ' + H + ' px: angolo in alto a sinistra di ogni blocco, ' +
      (coord === 'display' ? 'coordinate assolute sul display' : 'coordinate relative al frame che lo contiene') + ' *)');
    gvl.push('{attribute \'qualified_only\'}');
    gvl.push(opts.constant === false ? 'VAR_GLOBAL' : 'VAR_GLOBAL CONSTANT');
    var any = false;
    ids.forEach(function (id) {
      var e = result.nodes[id];
      var mine = items.filter(function (it) { return it.node === id; });
      if (!mine.length) return;
      any = true;
      var prefix = withPrefix ? e.names.map(function (n, i) { return identifier(n, 'N' + (i + 1)); }).join('_') : '';
      var repeated = coord === 'frame' && e.contexts.length > 1;
      gvl.push('\t(* ' + commentText(mine[0].relPath) + (e.type === 'frame' ? ' (frame)' : '') + ': ' +
        (repeated ? 'coordinate relative al frame, uguali in tutte le ' + e.contexts.length + ' copie' : mine.length + ' oggetti') + ' *)');
      if (e.type === 'frame') {
        var fname = unique('a' + (prefix || identifier(e.name, 'Frame')) + '_Frame');
        gvl.push.apply(gvl, array(fname, mine, function (it) {
          return pathOf(it, coord) + ' ' + it.n + ': riga ' + it.row + ', col. ' + it.col;
        }));
      } else {
        e.blockNames.forEach(function (bname, bi) {
          var list = mine.filter(function (it) { return it.index === bi; });
          if (!list.length) return;
          var name = unique('a' + (prefix ? prefix + '_' : '') + identifier(bname, 'Blocco' + (bi + 1)));
          gvl.push.apply(gvl, array(name, list, function (it) {
            return (withPrefix ? pathOf(it, coord) + ', ' : '') + 'elem. ' + it.n + ': riga ' + it.row + ', col. ' + it.col;
          }));
        });
      }
    });
    if (!any) gvl.push('\t(* nessun elemento da esportare *)');
    gvl.push('END_VAR');

    return { dut: dut, gvl: gvl.join('\n') };
  }

  /* ------------------------------------------------------------------ */
  /*  Testo e JSON                                                       */
  /* ------------------------------------------------------------------ */

  function padEnd(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
  function padStart(s, n) { s = String(s); while (s.length < n) s = ' ' + s; return s; }

  function toText(result, opts) {
    var coord = coordOf(opts);
    var items = pickItems(result, opts);
    var lines = [
      'Layout display ' + result.display.width + ' x ' + result.display.height + ' px',
      'X, Y = angolo in alto a sinistra, ' + (coord === 'display'
        ? 'coordinate assolute sul display (origine 0,0 in alto a sinistra)'
        : 'coordinate relative al frame che contiene l\'oggetto (sul display coincidono con quelle assolute)'),
      ''
    ];
    var pad = 0;
    items.forEach(function (it) { if (it.kind === 'block') pad = Math.max(pad, it.name.length); });
    pad = Math.max(pad, 5);
    var lastCtx = null, lastEl = null;
    items.forEach(function (it) {
      var ctxId = it.ctxKey;
      if (ctxId !== lastCtx) {
        if (lastCtx !== null) lines.push('');
        lines.push('== ' + pathOf(it, coord) + (it.kind === 'frame' ? ' (frame)' : '') + ' ==');
        lastCtx = ctxId;
        lastEl = null;
      }
      var pos = 'X ' + padStart(X(it, coord), 5) + '   Y ' + padStart(Y(it, coord), 5);
      var abs = coord === 'frame' && it.depth > 0 ? '   (display: X ' + it.x + ', Y ' + it.y + ')' : '';
      if (it.kind === 'frame') {
        lines.push('Frame ' + it.n + ' (riga ' + it.row + ', col. ' + it.col + ')   ' + pos + '   ' + it.w + ' x ' + it.h +
          '   ' + colorText(it) + abs);
        return;
      }
      if (lastEl !== it.n) {
        lines.push('Elemento ' + it.n + ' (riga ' + it.row + ', col. ' + it.col + ')');
        lastEl = it.n;
      }
      lines.push('  ' + padEnd(it.name, pad) + '   ' + pos + '   ' + it.w + ' x ' + it.h + '   ' + colorText(it) + abs);
    });
    lines.push('');
    return lines.join('\n');
  }

  function jsonColor(it) {
    return { color: '#' + it.color.replace('#', '').toUpperCase(), ral: it.ral ? 'RAL ' + it.ral : null };
  }

  function jsonNode(result, id, key) {
    var e = result.nodes[id];
    var c = e.contexts.filter(function (x) { return x.key === key; })[0];
    var out = { type: e.type === 'frame' ? 'frame' : 'group', name: e.name };
    if (!c) return out;
    out.area = { x: c.region.x - c.origin.x, y: c.region.y - c.origin.y, width: c.region.w, height: c.region.h };
    if (e.type === 'group') {
      out.elements = c.items.map(function (el) {
        return {
          n: el.n, row: el.row, col: el.col,
          blocks: el.blocks.map(function (b) {
            var col = jsonColor(b);
            return {
              name: b.name, x: b.rx, y: b.ry, displayX: b.x, displayY: b.y,
              width: b.w, height: b.h, color: col.color, ral: col.ral
            };
          })
        };
      });
    } else {
      out.instances = c.items.map(function (f) {
        var col = jsonColor(f);
        return {
          n: f.n, row: f.row, col: f.col, x: f.rx, y: f.ry, displayX: f.x, displayY: f.y,
          width: f.w, height: f.h, color: col.color, ral: col.ral,
          children: e.children.map(function (cid) { return jsonNode(result, cid, f.key + '/'); })
        };
      });
    }
    return out;
  }

  /* opts.rootId: esporta solo quel nodo (prima copia). */
  function toJSON(result, opts) {
    var roots;
    if (opts && opts.rootId && result.nodes[opts.rootId]) {
      var e = result.nodes[opts.rootId];
      roots = e.contexts.length ? [jsonNode(result, opts.rootId, e.contexts[0].key)] : [];
    } else {
      roots = result.roots.map(function (id) { return jsonNode(result, id, ''); });
    }
    return JSON.stringify({
      display: { width: result.display.width, height: result.display.height },
      origin: 'top-left',
      note: 'x, y relative al contenitore (display o frame); displayX, displayY assolute sul display',
      nodes: roots
    }, null, 2);
  }

  return {
    buildSheets: buildSheets,
    cellText: cellText,
    sheetsToTSV: sheetsToTSV,
    sheetsToCSV: sheetsToCSV,
    identifier: identifier,
    toST: toST,
    toText: toText,
    toJSON: toJSON,
    pickItems: pickItems
  };
}));
