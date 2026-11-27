/*
 * preview.js — Anteprima SVG del display.
 *
 * Lo stesso disegno serve per l'anteprima interattiva (scalata) e per
 * l'esportazione PNG/SVG in scala 1:1 (1 unità = 1 pixel del display).
 * I colori del tema chiaro sono attributi SVG; il CSS della pagina li
 * sovrascrive per il tema scuro e per evidenziare gli oggetti.
 *
 * Due modi di disegno:
 *   - con una selezione: vista "struttura" (colori tenui, il resto attenuato,
 *     zone escluse dagli offset tratteggiate);
 *   - senza selezione (o con "Colori pieni"): vista "reale", con i colori veri
 *     e tutti i livelli come sul pannello; restano evidenziati i problemi veri
 *     (sovrapposizioni, oggetti fuori area).
 * I livelli si disegnano nell'ordine dell'albero: l'ultimo sta davanti.
 */
(function () {
  'use strict';

  var DLC = window.DLC = window.DLC || {};

  var C = {
    display: '#ffffff',
    border: '#64748b',
    grid: '#e8edf3',
    gridMajor: '#d3dbe5',
    hatch: '#c3ccd8',
    area: '#005eb8',
    text: '#1f2937',
    danger: '#dc2626',
    warn: '#d97706'
  };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[ch];
    });
  }

  function r3(n) { return Math.round(n * 1000) / 1000; }

  function fits(text, size, max) { return text.length * size * 0.58 <= max; }

  function rgb(hex) {
    var n = parseInt(String(hex).slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function luminance(hex) {
    var c = rgb(hex);
    return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
  }

  function darken(hex, f) {
    var c = rgb(hex).map(function (v) { return Math.round(v * (1 - f)); });
    return '#' + c.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
  }

  /* Bordo leggibile anche per colori molto chiari (es. RAL 9010, 7035). */
  function strokeFor(hex) { return luminance(hex) > 0.72 ? darken(hex, 0.38) : hex; }

  /* Testo leggibile sopra un colore pieno. */
  function textOn(hex) { return luminance(hex) > 0.55 ? '#111827' : '#ffffff'; }

  /*
   * o = { scale        pixel dello schermo per unità (testi e tratti restano di dimensione costante),
   *       pixels       moltiplicatore della dimensione dell'immagine (esportazione; predefinito = scale),
   *       selected     id del nodo selezionato o ''/null,
   *       focus        {id: true} oggetti evidenziati (gli altri attenuati) o null,
   *       colorful     vista reale (nessuna selezione): colori pieni, niente attenuazione,
   *       coord        'frame' | 'display',
   *       showGrid, showNames, showCoords, solid,
   *       problems     evidenzia sovrapposizioni e oggetti fuori area,
   *       only         {id: true}: disegna solo questi nodi (esportazione parziale) o null,
   *       frameOutline contorno dei frame trasparenti (predefinito sì),
   *       background   'white' | 'none' (PNG trasparente),
   *       exportMode } */
  function markup(res, o) {
    var W = res.display.width, H = res.display.height, k = 1 / o.scale;
    var px = o.pixels || o.scale;
    var fs = 11.5 * k, fsc = 10 * k, pad = 3 * k, hs = r3(8 * k);
    var ve = o.exportMode ? '' : ' vector-effect="non-scaling-stroke"';
    var solid = !!(o.solid || o.colorful);
    var s = [];
    s.push('<svg xmlns="http://www.w3.org/2000/svg" class="pv-svg" width="', r3(W * px), '" height="', r3(H * px),
      '" viewBox="0 0 ', W, ' ', H, '" font-family="Segoe UI, system-ui, -apple-system, Roboto, Arial, sans-serif">');

    var showBg = o.background !== 'none';
    var minor = showBg && o.showGrid && 10 * o.scale >= 6;
    s.push('<defs><pattern id="pv-hatch" width="', hs, '" height="', hs,
      '" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line class="pv-hatch-line" x1="0" y1="0" x2="0" y2="', hs,
      '" stroke="', C.hatch, '" stroke-width="', r3(2 * k), '"/></pattern>');
    if (o.problems) {
      var oh = r3(7 * k);
      s.push('<pattern id="pv-ovl-hatch" width="', oh, '" height="', oh, '" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">',
        '<rect width="', oh, '" height="', oh, '" fill="', C.danger, '" fill-opacity="0.16"/>',
        '<line x1="0" y1="0" x2="0" y2="', oh, '" stroke="', C.danger, '" stroke-width="', r3(2 * k), '"/></pattern>');
    }
    if (minor) {
      s.push('<pattern id="pv-grid10" width="10" height="10" patternUnits="userSpaceOnUse"><path class="pv-grid-minor" d="M10 0H0V10" fill="none" stroke="',
        C.grid, '" stroke-width="', r3(k), '"/></pattern>');
    }
    if (showBg && o.showGrid) {
      s.push('<pattern id="pv-grid50" width="50" height="50" patternUnits="userSpaceOnUse"><path class="pv-grid-major" d="M50 0H0V50" fill="none" stroke="',
        C.gridMajor, '" stroke-width="', r3(k), '"/></pattern>');
    }
    s.push('</defs>');

    if (showBg) {
      s.push('<rect class="pv-display" width="', W, '" height="', H, '" fill="', C.display, '"/>');
      if (minor) s.push('<rect width="', W, '" height="', H, '" fill="url(#pv-grid10)"/>');
      if (o.showGrid) s.push('<rect width="', W, '" height="', H, '" fill="url(#pv-grid50)"/>');
    }

    var sel = !o.exportMode && !o.colorful && o.selected ? res.nodes[o.selected] : null;
    var labelRows = {};   // frame con lo stesso angolo: le etichette si impilano invece di sovrapporsi

    // Oggetti (in ordine di albero: ogni frame prima del suo contenuto; l'ultimo sta davanti)
    res.items.forEach(function (it) {
      if (it.hidden || (o.only && !o.only[it.node])) return;
      var isFrame = it.kind === 'frame';
      var clear = isFrame && it.transparent;
      var out = !!o.problems && (it.outArea || it.outDisplay);
      var ovl = !!o.problems && it.overlap;
      var dim = o.focus && !o.focus[it.node];
      var cls = 'pv-item ' + (isFrame ? 'pv-frm' : 'pv-blk') + (clear ? ' pv-clear' : '') + (dim ? ' pv-dim' : '') +
        (out ? ' pv-out' : '') + (ovl ? ' pv-ovl' : '');
      var stroke = out ? C.danger : (ovl ? C.warn : strokeFor(it.color));
      var fillOp = solid ? 1 : (isFrame ? 0.07 : 0.22);
      var dash = out ? ' stroke-dasharray="4 3"' : (clear ? ' stroke-dasharray="6 4" stroke-opacity="0.6"' : '');
      var noStroke = clear && o.frameOutline === false && !out;
      s.push('<g class="', cls, '" data-key="', esc(it.key), '">');
      s.push('<rect x="', it.x, '" y="', it.y, '" width="', Math.max(0, it.w), '" height="', Math.max(0, it.h),
        '" fill="', clear ? 'none' : it.color, '" fill-opacity="', fillOp, '" stroke="', noStroke ? 'none' : stroke,
        '" stroke-width="', isFrame ? 1.5 : 1, '"', dash, ve, ' shape-rendering="crispEdges"/>');

      var tcls = solid ? ' class="oc"' : '';
      var tfill = solid ? (clear ? '#111827' : textOn(it.color)) : C.text;
      var halo = clear && solid ? ' stroke="#ffffff" stroke-opacity="0.55" stroke-width="' + r3(2.2 * k) + '" paint-order="stroke"' : '';
      var X = o.coord === 'display' ? it.x : it.rx, Y = o.coord === 'display' ? it.y : it.ry;
      var innerW = it.w - 2 * pad, innerH = it.h - 2 * pad;
      var coord = o.showCoords && fits(X + ',' + Y, fsc, innerW) ? X + ',' + Y : null;

      if (isFrame) {
        var label = o.showNames ? it.label : '';
        var line = label && coord ? label + '  ·  ' + coord : (label || coord || '');
        if (line && !fits(line, fsc, innerW)) line = label && fits(label, fsc, innerW) ? label : (coord || '');
        if (line && innerH >= fsc) {
          var slot = it.x + ',' + it.y, row = labelRows[slot] || 0;
          labelRows[slot] = row + 1;
          s.push('<text', tcls, ' x="', r3(it.x + pad), '" y="', r3(it.y + pad + fsc * 0.82 + row * (fsc + 2 * k)), '" font-size="', r3(fsc),
            '" font-weight="600" fill="', tfill, '" fill-opacity="0.85"', halo, '>', esc(line), '</text>');
        }
        s.push('</g>');
        return;
      }

      var name = null;
      if (o.showNames) {
        var full = it.name + ' ' + it.n;
        if (fits(full, fs, innerW)) name = full;
        else if (fits(String(it.n), fs, innerW)) name = String(it.n);
      }
      var both = name !== null && coord !== null && innerH >= fs + fsc + pad;
      if (!both) {
        if (name !== null && innerH >= fs) coord = null;
        else {
          name = null;
          if (coord !== null && innerH < fsc) coord = null;
        }
      }
      if (coord !== null) {
        s.push('<text', tcls, ' x="', r3(it.x + pad), '" y="', r3(it.y + pad + fsc * 0.82), '" font-size="', r3(fsc),
          '" fill="', tfill, '" fill-opacity="0.8">', esc(coord), '</text>');
      }
      if (name !== null) {
        var top = both ? it.y + pad + fsc : it.y;
        var h = both ? it.h - pad - fsc : it.h;
        s.push('<text', tcls, ' x="', r3(it.x + it.w / 2), '" y="', r3(top + h / 2 + fs * 0.35), '" font-size="', r3(fs),
          '" text-anchor="middle" font-weight="600" fill="', tfill, '">', esc(name), '</text>');
      }
      s.push('</g>');
    });

    // Zone in cui due blocchi si sovrappongono davvero (sopra a tutti i livelli)
    if (o.problems && res.overlapPairs) {
      res.overlapPairs.forEach(function (p) {
        if (p.hidden || (o.only && !(o.only[p.nodeA] && o.only[p.nodeB]))) return;
        s.push('<rect class="pv-ovx" x="', p.x, '" y="', p.y, '" width="', p.w, '" height="', p.h,
          '" fill="url(#pv-ovl-hatch)" stroke="', C.danger, '" stroke-width="1"', ve, ' pointer-events="none"/>');
      });
    }

    // Nodo selezionato: zone escluse dagli offset (tratteggio) e contorno dell'area
    if (sel) {
      sel.contexts.forEach(function (c) {
        var b = c.box, r = c.region;
        var d = 'M' + b.x + ' ' + b.y + 'h' + b.w + 'v' + b.h + 'h' + (-b.w) + 'Z';
        if (r.valid) d += 'M' + r.x + ' ' + r.y + 'v' + r.h + 'h' + r.w + 'v' + (-r.h) + 'Z';
        s.push('<path class="pv-excl" d="', d, '" fill="url(#pv-hatch)" fill-rule="evenodd" pointer-events="none"/>');
        if (r.valid) {
          s.push('<rect class="pv-area" x="', r.x, '" y="', r.y, '" width="', r.w, '" height="', r.h,
            '" fill="none" stroke="', C.area, '" stroke-width="1.5" stroke-dasharray="6 4"', ve, ' pointer-events="none"/>');
        }
      });
    }

    if (showBg) {
      s.push('<rect class="pv-border" x="0" y="0" width="', W, '" height="', H, '" fill="none" stroke="', C.border,
        '" stroke-width="1"', ve, ' shape-rendering="crispEdges" pointer-events="none"/>');
    }
    s.push('</svg>');
    return s.join('');
  }

  /* ------------------------------------------------------------------ */
  /*  Anteprima interattiva                                              */
  /* ------------------------------------------------------------------ */

  /* opts = { onHover(key, e), onMove(e), onClick(key), onBackground(), onCursor(pt) } */
  function Preview(wrap, host, opts) {
    this.wrap = wrap;
    this.host = host;
    this.opts = opts || {};
    this.map = {};
    this.hoverKeys = [];
    this.selKeys = [];
    this._hoverEls = [];
    this._selEls = [];
    this.current = null;
    this.lastWidth = 0;
    var self = this;

    host.addEventListener('mousemove', function (e) {
      if (self.opts.onCursor) self.opts.onCursor(self._point(e));
      if (self.opts.onMove) self.opts.onMove(e);
    });
    host.addEventListener('mouseleave', function () {
      if (self.opts.onCursor) self.opts.onCursor(null);
      self._over(null, null);
    });
    host.addEventListener('mouseover', function (e) {
      var g = e.target.closest ? e.target.closest('g[data-key]') : null;
      self._over(g ? g.getAttribute('data-key') : null, e);
    });
    host.addEventListener('click', function (e) {
      var g = e.target.closest ? e.target.closest('g[data-key]') : null;
      if (g) {
        if (self.opts.onClick) self.opts.onClick(g.getAttribute('data-key'));
      } else if (self.opts.onBackground && e.target.closest && e.target.closest('svg')) {
        self.opts.onBackground();
      }
    });

    if (window.ResizeObserver) {
      new window.ResizeObserver(function () {
        var w = self.wrap.clientWidth;
        if (self.res && self.view && self.view.zoom === 'fit' && Math.abs(w - self.lastWidth) >= 2) {
          self.render(self.res, self.view);
        }
      }).observe(wrap);
    }
  }

  Preview.prototype._scale = function (d) {
    var z = this.view.zoom;
    if (z !== 'fit') return Number(z) || 1;
    var cs = window.getComputedStyle(this.wrap);
    var padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    var availW = Math.max(120, this.wrap.clientWidth - padX - 2);
    var availH = Math.max(220, Math.min(window.innerHeight * 0.62, 760));
    return Math.min(availW / d.width, availH / d.height, 4);
  };

  Preview.prototype.render = function (res, view) {
    this.res = res;
    this.view = view;
    this.lastWidth = this.wrap.clientWidth;
    this.scale = this._scale(res.display);
    this.host.innerHTML = markup(res, {
      scale: this.scale,
      selected: view.selected,
      focus: view.focus,
      colorful: view.colorful,
      coord: view.coord,
      showGrid: view.showGrid,
      showNames: view.showNames,
      showCoords: view.showCoords,
      solid: view.solid,
      problems: view.problems !== false,
      frameOutline: true
    });
    this.svg = this.host.firstChild;
    this.map = {};
    var gs = this.host.querySelectorAll('g[data-key]');
    for (var i = 0; i < gs.length; i++) this.map[gs[i].getAttribute('data-key')] = gs[i];
    this._hoverEls = [];
    this._selEls = [];
    this.setHover(this.hoverKeys);
    this.setSelection(this.selKeys);
  };

  Preview.prototype._apply = function (keys, cls, prop) {
    var prev = this[prop];
    for (var i = 0; i < prev.length; i++) prev[i].classList.remove(cls);
    var now = [];
    (keys || []).forEach(function (k) {
      var g = this.map[k];
      if (g) { g.classList.add(cls); now.push(g); }
    }, this);
    this[prop] = now;
  };

  Preview.prototype.setHover = function (keys) {
    this.hoverKeys = keys || [];
    this._apply(this.hoverKeys, 'hover', '_hoverEls');
  };

  Preview.prototype.setSelection = function (keys) {
    this.selKeys = keys || [];
    this._apply(this.selKeys, 'sel', '_selEls');
  };

  /* Fa lampeggiare per un attimo gli oggetti indicati (es. dopo un clic su un avviso). */
  Preview.prototype.flash = function (keys) {
    var els = [];
    (keys || []).forEach(function (k) { if (this.map[k]) els.push(this.map[k]); }, this);
    els.forEach(function (g) {
      g.classList.remove('flash');
      if (g.getBoundingClientRect) g.getBoundingClientRect();
      g.classList.add('flash');
    });
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(function () {
      els.forEach(function (g) { g.classList.remove('flash'); });
    }, 1800);
  };

  Preview.prototype._over = function (key, e) {
    if (key === this.current) return;
    this.current = key;
    if (this.opts.onHover) this.opts.onHover(key, e);
  };

  Preview.prototype._point = function (e) {
    if (!this.svg || !this.svg.getScreenCTM) return null;
    var m = this.svg.getScreenCTM();
    if (!m) return null;
    var p = this.svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    var q = p.matrixTransform(m.inverse());
    var x = Math.floor(q.x), y = Math.floor(q.y);
    if (x < 0 || y < 0 || x >= this.res.display.width || y >= this.res.display.height) return null;
    return { x: x, y: y };
  };

  /* ------------------------------------------------------------------ */
  /*  Esportazione immagine (senza tratteggi e contorni dell'editor)     */
  /* ------------------------------------------------------------------ */

  /*
   * ex = { pixels (1, 2, 3…), coord, showGrid, showNames, showCoords, solid,
   *        problems, only, frameOutline, background }
   * Ciò che non è indicato segue le impostazioni dell'anteprima (view); gli
   * avvisi dell'editor (bordi arancioni/rossi, zone in collisione) sono esclusi
   * se non richiesti con ex.problems.
   */
  function exportOptions(view, ex) {
    ex = ex || {};
    function pick(name) { return ex[name] != null ? ex[name] : view[name]; }
    return {
      scale: 1,
      pixels: ex.pixels || 1,
      selected: null,
      focus: null,
      colorful: false,
      coord: pick('coord'),
      showGrid: pick('showGrid'),
      showNames: pick('showNames'),
      showCoords: pick('showCoords'),
      solid: pick('solid'),
      problems: !!ex.problems,
      only: ex.only || null,
      frameOutline: ex.frameOutline !== false,
      background: ex.background || 'white',
      exportMode: true
    };
  }

  function exportSVG(res, view, ex) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + markup(res, exportOptions(view, ex));
  }

  function exportPNG(res, view, ex) {
    var o = exportOptions(view, ex);
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(res.display.width * o.pixels);
          canvas.height = Math.round(res.display.height * o.pixels);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(function (blob) {
            if (blob) resolve(blob); else reject(new Error('PNG non generato'));
          }, 'image/png');
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = function () { reject(new Error('Immagine non generata')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup(res, o));
    });
  }

  /* Miniatura (SVG in linea) di ciò che verrebbe esportato, larga al massimo maxWidth pixel. */
  function thumbnail(res, view, ex, maxWidth) {
    var o = exportOptions(view, ex);
    o.pixels = Math.min(1, maxWidth / res.display.width);
    return markup(res, o).replace(/ class="pv-svg"/, ' class="pv-thumb"');
  }

  DLC.Preview = Preview;
  DLC.preview = {
    markup: markup,
    exportSVG: exportSVG,
    exportPNG: exportPNG,
    exportOptions: exportOptions,
    thumbnail: thumbnail,
    luminance: luminance
  };
}());
