/*
 * storage.js — Salvataggi nel browser, link di condivisione, file e appunti.
 *
 * Tutto resta sul computer dell'utente (localStorage del browser):
 * nessun dato viene inviato a server esterni.
 */
(function () {
  'use strict';

  var DLC = window.DLC = window.DLC || {};
  var PREFIX = 'dlc.v1.';

  function read(key) {
    try {
      var s = window.localStorage.getItem(PREFIX + key);
      return s ? JSON.parse(s) : null;
    } catch (e) {
      return null;
    }
  }

  function write(key, value) {
    try {
      window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function isEntry(e) {
    return e && typeof e === 'object' && typeof e.id === 'string' && typeof e.name === 'string' &&
      e.config && typeof e.config === 'object';
  }

  /* Base64 "url-safe" di un testo UTF-8 (per il link di condivisione). */
  function toBase64Url(text) {
    var bytes = new TextEncoder().encode(text), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  var storage = {
    available: (function () {
      try {
        var k = PREFIX + 'test';
        window.localStorage.setItem(k, '1');
        window.localStorage.removeItem(k);
        return true;
      } catch (e) {
        return false;
      }
    }()),

    loadDraft: function () { return read('draft'); },
    saveDraft: function (config) { return write('draft', config); },
    loadUI: function () { return read('ui'); },
    saveUI: function (ui) { return write('ui', ui); },

    listSaved: function () {
      var list = read('saved');
      list = Array.isArray(list) ? list.filter(isEntry) : [];
      return list.sort(function (a, b) { return String(b.savedAt).localeCompare(String(a.savedAt)); });
    },

    /* Salva con nome: se esiste già una configurazione con lo stesso nome
       (senza distinzione maiuscole/minuscole) viene aggiornata. */
    saveNamed: function (name, config) {
      var list = storage.listSaved();
      var key = name.trim().toLowerCase();
      var idx = -1;
      list.forEach(function (e, i) { if (e.name.trim().toLowerCase() === key) idx = i; });
      var entry = {
        id: idx >= 0 ? list[idx].id : uid(),
        name: name,
        savedAt: new Date().toISOString(),
        config: JSON.parse(JSON.stringify(config))
      };
      if (idx >= 0) list[idx] = entry; else list.push(entry);
      return write('saved', list) ? { entry: entry, updated: idx >= 0 } : null;
    },

    removeSaved: function (id) {
      var list = storage.listSaved().filter(function (e) { return e.id !== id; });
      return write('saved', list);
    },

    shareUrl: function (config) {
      var base = window.location.href.split('#')[0];
      return base + '#c=' + toBase64Url(JSON.stringify(config));
    },

    /* null = nessun link; { config } = layout valido; { error } = link non leggibile */
    readHash: function () {
      var m = /[#&]c=([A-Za-z0-9_-]+)/.exec(window.location.hash || '');
      if (!m) return null;
      try {
        return { config: JSON.parse(fromBase64Url(m[1])) };
      } catch (e) {
        return { error: true };
      }
    },

    clearHash: function () {
      try {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      } catch (e) {
        window.location.hash = '';
      }
    }
  };

  /* ------------------------------------------------------------------ */
  /*  Appunti, file                                                      */
  /* ------------------------------------------------------------------ */

  function copyFallback(text) {
    var active = document.activeElement;
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (active && active.focus) {
      try { active.focus({ preventScroll: true }); } catch (e) { active.focus(); }
    }
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return copyFallback(text); }
      );
    }
    return Promise.resolve(copyFallback(text));
  }

  function downloadBlob(filename, blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function download(filename, text, mime) {
    downloadBlob(filename, new Blob([text], { type: mime || 'text/plain;charset=utf-8' }));
  }

  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result)); };
      r.onerror = function () { reject(r.error); };
      r.readAsText(file);
    });
  }

  /* Nome file sicuro a partire dal nome del layout. */
  function slug(text) {
    var s = String(text || '');
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    s = s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 50);
    return s || 'layout';
  }

  DLC.storage = storage;
  DLC.copyText = copyText;
  DLC.download = download;
  DLC.downloadBlob = downloadBlob;
  DLC.readFile = readFile;
  DLC.slug = slug;
}());
