'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Z = require('../js/zip.js');

const bytes = (s) => new Uint8Array(Buffer.from(s, 'utf8'));

test('zip: CRC-32 noto', () => {
  assert.equal(Z.crc32(bytes('123456789')), 0xCBF43926);
  assert.equal(Z.crc32(new Uint8Array(0)), 0);
});

test('zip: struttura valida (intestazioni, directory centrale, dati e CRC)', () => {
  const data = Z.build([
    { name: 'uno.txt', data: bytes('ciao') },
    { name: 'due.txt', data: bytes('à€ mondo') }
  ], new Date(2026, 10, 27, 9, 30, 10));
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  assert.equal(dv.getUint32(data.length - 22, true), 0x06054b50, 'fine directory centrale');
  assert.equal(dv.getUint16(data.length - 22 + 10, true), 2, 'due voci');
  const dirStart = dv.getUint32(data.length - 22 + 16, true);
  assert.equal(dv.getUint32(dirStart, true), 0x02014b50);
  // prima voce: nome, dimensione, CRC e contenuto coerenti
  const off = dv.getUint32(dirStart + 42, true);
  assert.equal(dv.getUint32(off, true), 0x04034b50);
  const nameLen = dv.getUint16(off + 26, true), size = dv.getUint32(off + 22, true);
  assert.equal(Buffer.from(data.subarray(off + 30, off + 30 + nameLen)).toString(), 'uno.txt');
  assert.equal(Buffer.from(data.subarray(off + 30 + nameLen, off + 30 + nameLen + size)).toString(), 'ciao');
  assert.equal(dv.getUint32(off + 14, true), Z.crc32(bytes('ciao')));
});

test('zip: nomi sicuri e unici', () => {
  assert.equal(Z.safeName('../../etc/passwd', 'x'), '_.._etc_passwd', 'nessun percorso');
  assert.ok(!/[\\/:]/.test(Z.safeName('a/b\\c:d', 'x')));
  assert.equal(Z.safeName('   ', 'file1'), 'file1');
  assert.equal(Z.safeName('...nascosto', 'x'), 'nascosto');
  const data = Z.build([{ name: 'a.png', data: bytes('1') }, { name: 'A.png', data: bytes('2') }, { name: 'a.png', data: bytes('3') }]);
  const text = Buffer.from(data).toString('latin1');
  assert.ok(text.includes('a.png') && text.includes('A (2).png') && text.includes('a (3).png'));
});

test('zip: lo legge un programma esterno (unzip / python)', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlc-zip-'));
  const file = path.join(dir, 'prova.zip');
  fs.writeFileSync(file, Z.build([
    { name: 'sfondo.png', data: new Uint8Array([137, 80, 78, 71, 0, 1, 2, 3, 255]) },
    { name: 'città.txt', data: bytes('è ok') }
  ]));
  let out;
  try {
    out = execFileSync('python3', ['-I', '-c',
      'import sys, zipfile\n' +
      'z = zipfile.ZipFile(sys.argv[1])\n' +
      'assert z.testzip() is None\n' +
      'print(",".join(sorted(z.namelist())), z.read("sfondo.png")[:4].hex(), z.read("città.txt").decode())', file]).toString();
  } catch (e) {
    t.skip('python3 non disponibile');
    return;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(out.trim(), 'città.txt,sfondo.png 89504e47 è ok');
});
