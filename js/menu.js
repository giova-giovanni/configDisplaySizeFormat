/*
 * menu.js — Menu a comparsa generico (tasto destro, "Ordine", "Colonne"…).
 *
 *   DLC.menu.open({ items, anchor | x, y, align, onClose })
 *   items: [{ label, sub, icon, kbd, hint, disabled, checked, keepOpen, danger, fn }]   (sub = riga di spiegazione sotto il testo)
 *          oppure { sep: true } (linea) / { title: 'Testo' } (intestazione)
 *
 * Tastiera: ↑ ↓ Home Fine per spostarsi, Invio o Spazio per scegliere, Esc per chiudere.
 * Un elemento disattivato (disabled) resta visibile con la spiegazione in "hint".
 */
(function () {
  'use strict';

  var DLC = window.DLC = window.DLC || {};
  var current = null;

  function close(refocus) {
    if (!current) return;
    var c = current;
    current = null;
    document.removeEventListener('mousedown', c.outside, true);
    document.removeEventListener('keydown', c.key, true);
    window.removeEventListener('resize', c.dismiss);
    window.removeEventListener('scroll', c.scroll, true);
    if (c.el.parentNode) c.el.parentNode.removeChild(c.el);
    if (refocus && c.opener && c.opener.focus && document.contains(c.opener)) {
      try { c.opener.focus({ preventScroll: true }); } catch (e) { c.opener.focus(); }
    }
    if (c.onClose) c.onClose();
  }

  function enabledItems(el) {
    return Array.prototype.filter.call(el.querySelectorAll('.popup-item'), function (b) {
      return b.getAttribute('aria-disabled') !== 'true';
    });
  }

  function open(o) {
    close(false);
    var opener = document.activeElement;
    var el = document.createElement('div');
    el.className = 'popup';
    el.setAttribute('role', 'menu');
    el.tabIndex = -1;

    (o.items || []).forEach(function (it) {
      if (it.sep) {
        var sep = document.createElement('div');
        sep.className = 'popup-sep';
        sep.setAttribute('role', 'separator');
        el.appendChild(sep);
        return;
      }
      if (it.title) {
        var t = document.createElement('div');
        t.className = 'popup-title';
        t.textContent = it.title;
        el.appendChild(t);
        return;
      }
      var b = document.createElement('button');
      var isCheck = it.checked != null;
      b.type = 'button';
      b.className = 'popup-item' + (it.danger ? ' danger' : '') + (it.disabled ? ' disabled' : '');
      b.setAttribute('role', isCheck ? 'menuitemcheckbox' : 'menuitem');
      if (isCheck) b.setAttribute('aria-checked', String(!!it.checked));
      if (it.disabled) b.setAttribute('aria-disabled', 'true');
      if (it.hint) b.title = it.hint;
      var lead = document.createElement('span');
      lead.className = 'popup-lead';
      if (isCheck) lead.textContent = it.checked ? '✓' : '';
      else if (it.icon && DLC.icons) lead.innerHTML = DLC.icons.get(it.icon);
      b.appendChild(lead);
      var label = document.createElement('span');
      label.className = 'popup-label';
      label.textContent = it.label;
      if (it.sub) {
        var sub = document.createElement('small');
        sub.className = 'popup-sub';
        sub.textContent = it.sub;
        label.appendChild(sub);
      }
      b.appendChild(label);
      if (it.kbd) {
        var k = document.createElement('span');
        k.className = 'popup-kbd';
        k.textContent = it.kbd;
        b.appendChild(k);
      }
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        if (it.disabled) return;
        if (it.keepOpen && isCheck) {          // spunta: il menu resta aperto per cambiarne altre
          it.checked = !it.checked;
          b.setAttribute('aria-checked', String(it.checked));
          lead.textContent = it.checked ? '✓' : '';
          if (it.fn) it.fn(it.checked);
          return;
        }
        close(true);
        if (it.fn) it.fn();
      });
      el.appendChild(b);
    });

    var c = {
      el: el,
      opener: o.anchor || opener,
      onClose: o.onClose,
      dismiss: function () { close(false); },
      // Si chiude se la pagina scorre davvero: gli "scroll" ritardati subito dopo l'apertura (es. il pannello
      // che si è assestato per mostrare il pulsante cliccato) e quelli che non spostano l'ancora si ignorano.
      scroll: function (e) {
        if (el.contains(e.target) || Date.now() - c.at < 400) return;
        if (o.anchor && c.rect) {
          var now = o.anchor.getBoundingClientRect();
          if (Math.abs(now.top - c.rect.top) < 2 && Math.abs(now.left - c.rect.left) < 2) return;
        }
        close(false);
      },
      outside: function (e) {
        if (!el.contains(e.target) && !(o.anchor && o.anchor.contains(e.target))) close(false);
      },
      key: function (e) {
        if (!current || current.el !== el) return;
        var list = enabledItems(el), i = list.indexOf(document.activeElement);
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
        if (e.key === 'Tab') { close(false); return; }
        var step = 0;
        if (e.key === 'ArrowDown') step = 1;
        else if (e.key === 'ArrowUp') step = -1;
        else if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          if (list.length) list[e.key === 'Home' ? 0 : list.length - 1].focus();
          return;
        } else return;
        e.preventDefault();
        if (!list.length) return;
        list[(i + step + list.length) % list.length].focus();
      }
    };
    c.at = Date.now();
    c.rect = o.anchor ? o.anchor.getBoundingClientRect() : null;
    current = c;

    el.style.visibility = 'hidden';
    document.body.appendChild(el);
    var r = el.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
    var x, y;
    if (o.anchor) {
      var a = o.anchor.getBoundingClientRect();
      x = o.align === 'right' ? a.right - r.width : a.left;
      y = a.bottom + 4;
      if (y + r.height > vh - 8 && a.top - r.height - 4 > 8) y = a.top - r.height - 4;
    } else {
      x = o.x || 0;
      y = o.y || 0;
    }
    x = Math.max(8, Math.min(x, vw - r.width - 8));
    y = Math.max(8, Math.min(y, vh - r.height - 8));
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.visibility = '';

    document.addEventListener('mousedown', c.outside, true);
    document.addEventListener('keydown', c.key, true);
    window.addEventListener('resize', c.dismiss);
    window.addEventListener('scroll', c.scroll, true);
    var first = enabledItems(el)[0];
    if (first) first.focus(); else el.focus();
    return { close: function () { close(false); } };
  }

  DLC.menu = { open: open, close: function () { close(false); }, isOpen: function () { return !!current; } };
}());
