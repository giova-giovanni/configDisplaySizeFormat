/*
 * exporters.js — Tabelle e formati di esportazione delle coordinate.
 *
 *   buildSheets  → righe/colonne per la tabella stile Excel
 *                  (vista "per blocco" o "per elemento")
 *   sheetsToTSV  → testo con tabulazioni: si incolla direttamente in Excel
 *   sheetsToCSV  → file CSV (separatore ";" per Excel in italiano)
 *   toST         → codice Structured Text per CODESYS (DUT + GVL)
 *   toText       → elenco leggibile
 *   toJSON       → dati strutturati
 *
 * Non dipende dal DOM (testabile in Node.js).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.DLC = root.DLC || {}).exporters = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function pickGroups(result, filter) {
    if (!filter) return result.groups;
    return result.groups.filter(function (g) { return filter.indexOf(g.index) !== -1; });
  }

  function uniqueLabels(names) {
    var seen = {};
    return names.map(function (n) {
      var k = n.toLowerCase();
      seen[k] = (seen[k] || 0) + 1;
      return seen[k] > 1 ? n + ' (' + seen[k] + ')' : n;
    });
  }

  function hasWarning(b) {
    return !!(b.outArea || b.outDisplay || b.overlap);
  }

  /* ------------------------------------------------------------------ */
  /*  Tabelle                                                            */
  /* ------------------------------------------------------------------ */

  /*
   * Restituisce un elenco di fogli { title, group, columns[], rows[] }.
   *   columns[i] = { label, field, num, coord, blockIdx, title }
   *   rows[i]    = { values[], keys[] (blocchi della riga), warn }
   * Vista 'long' (per blocco): un solo foglio, una riga per blocco.
   * Vista 'wide' (per elemento): un foglio per gruppo, una riga per elemento.
   */
  function buildSheets(result, opts) {
    opts = opts || {};
    var groups = pickGroups(result, opts.groups);
    var multi = groups.length > 1;

    if (opts.view === 'wide') {
      return groups.map(function (g) {
        var columns = [
          { label: 'Elem.', field: 'n', num: true, title: 'Numero dell\'elemento' },
          { label: 'Riga', field: 'row', num: true, title: 'Riga della griglia' },
          { label: 'Col.', field: 'col', num: true, title: 'Colonna della griglia' }
        ];
        uniqueLabels(g.blockNames).forEach(function (name, bi) {
          var size = g.element.blocks[bi];
          var title = name + ': ' + size.w + ' × ' + size.h + ' px';
          columns.push({ label: name + ' X', field: 'x', blockIdx: bi, num: true, coord: true, title: title });
          columns.push({ label: name + ' Y', field: 'y', blockIdx: bi, num: true, coord: true, title: title });
        });
        var rows = g.items.map(function (it) {
          var values = [it.n, it.row, it.col], warn = false;
          it.blocks.forEach(function (b) {
            values.push(b.x, b.y);
            if (hasWarning(b)) warn = true;
          });
          return { values: values, keys: it.blocks.map(function (b) { return b.key; }), warn: warn };
        });
        return { title: multi ? g.name : '', group: g.index, columns: columns, rows: rows };
      });
    }

    var columns = [];
    if (multi) columns.push({ label: 'Gruppo', field: 'group' });
    columns.push(
      { label: 'Elem.', field: 'n', num: true, title: 'Numero dell\'elemento' },
      { label: 'Riga', field: 'row', num: true, title: 'Riga della griglia' },
      { label: 'Col.', field: 'col', num: true, title: 'Colonna della griglia' },
      { label: 'Blocco', field: 'name' },
      { label: 'X', field: 'x', num: true, coord: true, title: 'X dell\'angolo in alto a sinistra (px)' },
      { label: 'Y', field: 'y', num: true, coord: true, title: 'Y dell\'angolo in alto a sinistra (px)' },
      { label: 'Larg.', field: 'w', num: true, title: 'Larghezza (px)' },
      { label: 'Alt.', field: 'h', num: true, title: 'Altezza (px)' }
    );
    var rows = [];
    groups.forEach(function (g) {
      g.blocks.forEach(function (b) {
        var values = multi ? [g.name] : [];
        values.push(b.n, b.row, b.col, b.name, b.x, b.y, b.w, b.h);
        rows.push({ values: values, keys: [b.key], warn: hasWarning(b) });
      });
    });
    return [{ title: '', group: null, columns: columns, rows: rows }];
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
    var typeName = identifier(opts.typeName, 'ST_VisuRect');
    if (/^[0-9]/.test(typeName)) typeName = 'ST_' + typeName;
    var base = Number(opts.base) === 0 ? 0 : 1;
    var groups = pickGroups(result, opts.groups);
    var withGroupPrefix = groups.length > 1;
    var W = result.display.width, H = result.display.height;

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

    var gvl = [];
    gvl.push('(* Layout display ' + W + ' x ' + H + ' px: coordinate dell\'angolo in alto a sinistra di ogni blocco *)');
    gvl.push('{attribute \'qualified_only\'}');
    gvl.push(opts.constant === false ? 'VAR_GLOBAL' : 'VAR_GLOBAL CONSTANT');
    var any = false;
    groups.forEach(function (g) {
      if (!g.items.length) return;
      any = true;
      gvl.push('\t(* ' + commentText(g.name) + ': ' + g.items.length + ' elementi, area X=' + g.area.x +
        ' Y=' + g.area.y + ' ' + g.area.w + 'x' + g.area.h + ' px *)');
      g.blockNames.forEach(function (bname, bi) {
        var prefix = withGroupPrefix ? identifier(g.name, 'Gruppo' + (g.index + 1)) + '_' : '';
        var name = unique('a' + prefix + identifier(bname, 'Blocco' + (bi + 1)));
        gvl.push('\t' + name + ' : ARRAY[' + base + '..' + (base + g.items.length - 1) + '] OF ' + typeName + ' := [');
        g.items.forEach(function (it, ii) {
          var b = it.blocks[bi];
          var sep = ii < g.items.length - 1 ? ',' : '';
          gvl.push('\t\t(iX := ' + b.x + ', iY := ' + b.y + ', iW := ' + b.w + ', iH := ' + b.h + ')' + sep +
            '\t(* [' + (base + ii) + '] elem. ' + it.n + ': riga ' + it.row + ', col. ' + it.col + ' *)');
        });
        gvl.push('\t];');
      });
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
    var groups = pickGroups(result, opts && opts.groups);
    var lines = [
      'Layout display ' + result.display.width + ' x ' + result.display.height + ' px',
      'X, Y = angolo in alto a sinistra di ogni blocco (origine 0,0 in alto a sinistra)',
      ''
    ];
    groups.forEach(function (g) {
      lines.push('== ' + g.name + ' ==');
      lines.push('Area di lavoro: X ' + g.area.x + ', Y ' + g.area.y + ', ' + g.area.w + ' x ' + g.area.h + ' px');
      lines.push('Elementi: ' + g.items.length + ' (' + g.rows + ' righe x ' + g.cols + ' colonne)');
      lines.push('');
      var pad = 0;
      g.blockNames.forEach(function (n) { pad = Math.max(pad, n.length); });
      g.items.forEach(function (it) {
        lines.push('Elemento ' + it.n + ' (riga ' + it.row + ', col. ' + it.col + ')');
        it.blocks.forEach(function (b) {
          lines.push('  ' + padEnd(b.name, pad) + '   X ' + padStart(b.x, 5) + '   Y ' + padStart(b.y, 5) +
            '   ' + b.w + ' x ' + b.h);
        });
      });
      lines.push('');
    });
    return lines.join('\n');
  }

  function toJSON(result, opts) {
    var groups = pickGroups(result, opts && opts.groups);
    return JSON.stringify({
      display: { width: result.display.width, height: result.display.height },
      origin: 'top-left',
      groups: groups.map(function (g) {
        return {
          name: g.name,
          area: { x: g.area.x, y: g.area.y, width: g.area.w, height: g.area.h },
          rows: g.rows,
          columns: g.cols,
          elements: g.items.map(function (it) {
            return {
              n: it.n,
              row: it.row,
              col: it.col,
              blocks: it.blocks.map(function (b) {
                return { name: b.name, x: b.x, y: b.y, width: b.w, height: b.h };
              })
            };
          })
        };
      })
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
    toJSON: toJSON
  };
}));
