/*
 * zip.js — Creazione di un archivio .zip (senza compressione, "stored").
 *
 * Serve per scaricare in un colpo solo più immagini (es. un PNG per ogni
 * livello). Nessuna libreria esterna; funziona nel browser (window.DLC.zip) e
 * in Node.js per i test.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.DLC = root.DLC || {}).zip = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var table = null;

  function crcTable() {
    if (table) return table;
    table = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  }

  function crc32(bytes) {
    var t = crcTable(), c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text);
    return new Uint8Array(Buffer.from(text, 'utf8'));
  }

  /* Nome sicuro dentro l'archivio: niente percorsi, caratteri di controllo o nomi vuoti. */
  function safeName(name, fallback) {
    var s = String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, '_').replace(/^\.+/, '').trim();
    return s.slice(0, 120) || fallback;
  }

  function dosTime(d) { return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF; }
  function dosDate(d) { return (((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF; }

  /*
   * files: [{ name, data: Uint8Array }]  →  Uint8Array con l'archivio.
   * I nomi uguali vengono resi unici ("a.png", "a (2).png"). date: Date (facoltativa).
   */
  function build(files, date) {
    var when = date instanceof Date ? date : new Date();
    var used = {}, entries = [];
    files.forEach(function (f, i) {
      var name = safeName(f.name, 'file' + (i + 1));
      var base = name, n = 2, dot = base.lastIndexOf('.');
      var stem = dot > 0 ? base.slice(0, dot) : base, ext = dot > 0 ? base.slice(dot) : '';
      while (used[name.toLowerCase()]) name = stem + ' (' + (n++) + ')' + ext;
      used[name.toLowerCase()] = true;
      var data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
      entries.push({ name: utf8(name), data: data, crc: crc32(data), offset: 0 });
    });
    if (entries.length > 65535) throw new Error('Troppi file per un archivio zip');

    var size = 22, i;
    for (i = 0; i < entries.length; i++) size += 30 + entries[i].name.length + entries[i].data.length + 46 + entries[i].name.length;
    var out = new Uint8Array(size), dv = new DataView(out.buffer), p = 0;
    var time = dosTime(when), day = dosDate(when);

    function u16(v) { dv.setUint16(p, v, true); p += 2; }
    function u32(v) { dv.setUint32(p, v >>> 0, true); p += 4; }
    function bytes(b) { out.set(b, p); p += b.length; }

    entries.forEach(function (e) {
      e.offset = p;
      u32(0x04034b50);   // intestazione locale
      u16(20);           // versione necessaria
      u16(0x0800);       // nomi in UTF-8
      u16(0);            // nessuna compressione
      u16(time); u16(day);
      u32(e.crc); u32(e.data.length); u32(e.data.length);
      u16(e.name.length); u16(0);
      bytes(e.name);
      bytes(e.data);
    });
    var dirStart = p;
    entries.forEach(function (e) {
      u32(0x02014b50);   // directory centrale
      u16(20); u16(20);
      u16(0x0800); u16(0);
      u16(time); u16(day);
      u32(e.crc); u32(e.data.length); u32(e.data.length);
      u16(e.name.length); u16(0); u16(0);
      u16(0); u16(0); u32(0);
      u32(e.offset);
      bytes(e.name);
    });
    var dirSize = p - dirStart;
    u32(0x06054b50);     // fine directory centrale
    u16(0); u16(0);
    u16(entries.length); u16(entries.length);
    u32(dirSize); u32(dirStart);
    u16(0);
    return out;
  }

  return { build: build, crc32: crc32, safeName: safeName };
}));
