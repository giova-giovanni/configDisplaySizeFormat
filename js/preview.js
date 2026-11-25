/*
 * preview.js — Anteprima SVG del display.
 *
 * Lo stesso disegno serve per l'anteprima interattiva (scalata) e per
 * l'esportazione PNG/SVG in scala 1:1 (1 unità = 1 pixel del display).
 * I colori del tema chiaro sono attributi SVG; il CSS della pagina li
 * sovrascrive per il tema scuro e per evidenziare i blocchi.
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
    area: '#107c41',
    areaDim: '#94a3b8',
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

  /* o = { scale, active, showGrid, showNames, showCoords } */
  function markup(res, o) {
    var W = res.display.width, H = res.display.height, k = 1 / o.scale;
    var fs = 11.5 * k, fsc = 10 * k, pad = 3 * k, hs = r3(8 * k);
    var s = [];
    s.push('<svg xmlns="http://www.w3.org/2000/svg" class="pv-svg" width="', r3(W * o.scale), '" height="', r3(H * o.scale),
      '" viewBox="0 0 ', W, ' ', H, '" font-family="Segoe UI, system-ui, -apple-system, Roboto, Arial, sans-serif">');

    var minor = o.showGrid && 10 * o.scale >= 6;
    s.push('<defs><pattern id="pv-hatch" width="', hs, '" height="', hs,
      '" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line class="pv-hatch-line" x1="0" y1="0" x2="0" y2="', hs,
      '" stroke="', C.hatch, '" stroke-width="', r3(2 * k), '"/></pattern>');
    if (minor) {
      s.push('<pattern id="pv-grid10" width="10" height="10" patternUnits="userSpaceOnUse"><path class="pv-grid-minor" d="M10 0H0V10" fill="none" stroke="',
        C.grid, '" stroke-width="', r3(k), '"/></pattern>');
    }
    if (o.showGrid) {
      s.push('<pattern id="pv-grid50" width="50" height="50" patternUnits="userSpaceOnUse"><path class="pv-grid-major" d="M50 0H0V50" fill="none" stroke="',
        C.gridMajor, '" stroke-width="', r3(k), '"/></pattern>');
    }
    s.push('</defs>');

    s.push('<rect class="pv-display" width="', W, '" height="', H, '" fill="', C.display, '"/>');
    if (minor) s.push('<rect width="', W, '" height="', H, '" fill="url(#pv-grid10)"/>');
    if (o.showGrid) s.push('<rect width="', W, '" height="', H, '" fill="url(#pv-grid50)"/>');

    // Zone escluse dagli offset del gruppo attivo (tratteggio)
    var ag = res.groups[o.active];
    if (ag) {
      var a = ag.area;
      var d = 'M0 0H' + W + 'V' + H + 'H0Z';
      if (ag.areaValid) d += 'M' + a.x + ' ' + a.y + 'v' + a.h + 'h' + a.w + 'v' + (-a.h) + 'Z';
      s.push('<path class="pv-excl" d="', d, '" fill="url(#pv-hatch)" fill-rule="evenodd"/>');
    }

    // Contorni delle aree di lavoro
    res.groups.forEach(function (g) {
      if (!g.areaValid) return;
      var act = g.index === o.active;
      s.push('<rect class="pv-area', act ? ' active' : '', '" x="', g.area.x, '" y="', g.area.y, '" width="', g.area.w,
        '" height="', g.area.h, '" fill="none" stroke="', act ? C.area : C.areaDim, '" stroke-width="', act ? 1.5 : 1,
        '" stroke-dasharray="', act ? '6 4' : '3 3', '" vector-effect="non-scaling-stroke"/>');
    });

    // Blocchi
    var multi = res.groups.length > 1;
    res.blocks.forEach(function (b) {
      var out = b.outArea || b.outDisplay;
      var cls = 'pv-blk' + (multi && b.group !== o.active ? ' pv-dim' : '') + (out ? ' pv-out' : '') + (b.overlap ? ' pv-ovl' : '');
      s.push('<g class="', cls, '" data-key="', esc(b.key), '">');
      s.push('<rect x="', b.x, '" y="', b.y, '" width="', b.w, '" height="', b.h, '" fill="', b.color,
        '" fill-opacity="0.22" stroke="', out ? C.danger : (b.overlap ? C.warn : b.color), '" stroke-width="1"',
        out ? ' stroke-dasharray="4 3"' : '', ' vector-effect="non-scaling-stroke" shape-rendering="crispEdges"/>');

      var innerW = b.w - 2 * pad, innerH = b.h - 2 * pad;
      var name = null, coord = null;
      if (o.showNames) {
        var full = b.name + ' ' + b.n;
        if (fits(full, fs, innerW)) name = full;
        else if (fits(String(b.n), fs, innerW)) name = String(b.n);
      }
      if (o.showCoords) {
        var ct = b.x + ',' + b.y;
        if (fits(ct, fsc, innerW)) coord = ct;
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
        s.push('<text class="pv-coord" x="', r3(b.x + pad), '" y="', r3(b.y + pad + fsc * 0.82), '" font-size="', r3(fsc),
          '" fill="', C.text, '" fill-opacity="0.8">', esc(coord), '</text>');
      }
      if (name !== null) {
        var top = both ? b.y + pad + fsc : b.y;
        var h = both ? b.h - pad - fsc : b.h;
        s.push('<text class="pv-name" x="', r3(b.x + b.w / 2), '" y="', r3(top + h / 2 + fs * 0.35), '" font-size="', r3(fs),
          '" text-anchor="middle" font-weight="600" fill="', C.text, '">', esc(name), '</text>');
      }
      s.push('</g>');
    });

    s.push('<rect class="pv-border" x="0" y="0" width="', W, '" height="', H, '" fill="none" stroke="', C.border,
      '" stroke-width="1" vector-effect="non-scaling-stroke" shape-rendering="crispEdges"/>');
    s.push('</svg>');
    return s.join('');
  }

  /* ------------------------------------------------------------------ */
  /*  Anteprima interattiva                                              */
  /* ------------------------------------------------------------------ */

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
      if (g && self.opts.onClick) self.opts.onClick(g.getAttribute('data-key'));
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
      active: view.active,
      showGrid: view.showGrid,
      showNames: view.showNames,
      showCoords: view.showCoords
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
  /*  Esportazione immagine 1:1                                          */
  /* ------------------------------------------------------------------ */

  function exportSVG(res, view) {
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + markup(res, {
      scale: 1,
      active: view.active,
      showGrid: view.showGrid,
      showNames: view.showNames,
      showCoords: view.showCoords
    });
  }

  function exportPNG(res, view) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = res.display.width;
          canvas.height = res.display.height;
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(function (blob) {
            if (blob) resolve(blob); else reject(new Error('PNG non generato'));
          }, 'image/png');
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = function () { reject(new Error('Immagine non generata')); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup(res, {
        scale: 1,
        active: view.active,
        showGrid: view.showGrid,
        showNames: view.showNames,
        showCoords: view.showCoords
      }));
    });
  }

  DLC.Preview = Preview;
  DLC.preview = { markup: markup, exportSVG: exportSVG, exportPNG: exportPNG };
}());
