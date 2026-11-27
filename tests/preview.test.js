'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../js/layout.js');
const { layers } = require('./fixtures.js');

// preview.js è scritto per il browser: in Node basta un finto "window" per usare markup()
global.window = global;
require('../js/preview.js');
const P = global.DLC.preview;

const view = { coord: 'frame', showGrid: false, showNames: true, showCoords: false, solid: false };

function draw(cfg, extra) {
  const res = L.computeLayout(cfg);
  return P.markup(res, Object.assign({
    scale: 1, selected: '', focus: null, colorful: false, coord: 'frame', showGrid: false,
    showNames: true, showCoords: false, solid: false, problems: true, frameOutline: true
  }, extra));
}

const count = (svg, re) => (svg.match(re) || []).length;

test('senza selezione: vista reale, colori pieni e nessuna attenuazione', () => {
  const svg = draw(layers(), { colorful: true });
  assert.equal(count(svg, /pv-dim/g), 0);
  assert.equal(count(svg, /pv-excl/g), 0, 'nessuna zona tratteggiata');
  assert.match(svg, /fill="#2563eb" fill-opacity="1"/, 'blocchi con il colore pieno');
  assert.doesNotMatch(svg, /fill-opacity="0\.22"/);
});

test('con una selezione: gli altri nodi sono attenuati e compaiono le zone escluse', () => {
  const cfg = layers();
  const svg = draw(cfg, { selected: 'page', focus: L.descendantIds(L.findNode(cfg, 'page').node) });
  assert.ok(count(svg, /pv-dim/g) > 5);
  assert.match(svg, /class="pv-excl"/);
  assert.match(svg, /fill-opacity="0\.22"/, 'colori tenui finché non si chiede "Colori pieni"');
});

test('livelli: i frame trasparenti non coprono, quelli pieni sì', () => {
  const svg = draw(layers(), { colorful: true });
  const rects = svg.split('<g ').filter((g) => /pv-frm/.test(g)).map((g) => /<rect[^>]*>/.exec(g)[0]);
  assert.equal(rects.length, 3);
  assert.match(rects[0], /fill="#9da1aa"/, 'sfondo: pieno');
  assert.match(rects[1], /fill="none"/, 'menu: automatico → trasparente, perché nasconderebbe i blocchi dello sfondo');
  assert.match(rects[2], /fill="#9da1aa"/, 'pagina: non copre blocchi, resta piena');
  const forced = draw(layers(false), { colorful: true });
  assert.doesNotMatch(forced.split('<g ').filter((g) => /pv-frm/.test(g))[1], /fill="none"/, 'pieno per scelta');
  // ogni frame è disegnato PRIMA del proprio contenuto e il menu dopo lo sfondo: ordine = livelli
  const order = [...svg.matchAll(/data-key="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(order.indexOf('bg#1') < order.indexOf('bg#1/alm:1:0'));
  assert.ok(order.indexOf('bg#1/logo:1:0') < order.indexOf('menu#1'));
  assert.ok(order.indexOf('menu#1/pop:1:0') < order.indexOf('page#1'));
});

test('nodi nascosti e disegno parziale', () => {
  const cfg = layers();
  cfg.nodes[0].hidden = true;
  const svg = draw(cfg, { colorful: true });
  assert.doesNotMatch(svg, /data-key="bg#1/);
  assert.match(svg, /data-key="menu#1\/pop:1:0"/);
  assert.equal(count(svg, /pv-ovx/g), 0, 'la collisione riguarda un nodo nascosto: non si disegna');
  const only = draw(layers(), { colorful: true, only: L.descendantIds(L.findNode(layers(), 'page').node) });
  assert.deepEqual([...only.matchAll(/data-key="([^"]+)"/g)].map((m) => m[1].split('/')[0]).filter((v, i, a) => a.indexOf(v) === i), ['page#1']);
});

test('problemi veri evidenziati: collisione tratteggiata e fuori area tratteggiato', () => {
  const svg = draw(layers(), { colorful: true });
  assert.equal(count(svg, /class="pv-ovx"/g), 1);
  assert.match(svg, /<rect class="pv-ovx" x="611" y="417" width="9" height="60"/);
  assert.equal(count(svg, /class="pv-item[^"]*pv-ovl"/g), 2, 'i due blocchi in collisione');
  assert.equal(count(svg, /class="pv-item[^"]*pv-out[^"]*"/g), 2, 'due pulsanti del menu fuori area');
  // niente più falsi allarmi sui frame
  assert.ok(svg.split('<g ').filter((g) => /pv-frm/.test(g)).every((g) => !/pv-ovl|pv-out/.test(g)));
});

test('esportazione: niente avvisi dell\'editor, scala e sfondo trasparente', () => {
  const res = L.computeLayout(layers());
  const svg = P.exportSVG(res, view, { solid: true });
  assert.match(svg, /^<\?xml/);
  assert.doesNotMatch(svg, /pv-ovl|pv-out|pv-ovx|d97706|dc2626/, 'nessun colore di avviso nell\'immagine');
  assert.doesNotMatch(svg, /vector-effect/, 'i tratti scalano con l\'immagine');
  assert.match(svg, /width="800" height="480" viewBox="0 0 800 480"/);
  assert.match(P.exportSVG(res, view, { pixels: 2 }), /width="1600" height="960" viewBox="0 0 800 480"/);
  const withProblems = P.exportSVG(res, view, { problems: true });
  assert.match(withProblems, /pv-ovx/);
  const clear = P.exportSVG(res, view, { background: 'none', showGrid: true });
  assert.doesNotMatch(clear, /class="pv-display"|pv-grid50/);
  const noOutline = P.exportSVG(res, view, { frameOutline: false });
  const menuFrame = noOutline.split('<g ').find((g) => /data-key="menu#1"/.test(g));
  assert.match(menuFrame, /stroke="none"/, 'frame trasparente senza contorno');
});

test('esportazione completa: tutti i livelli compaiono nell\'immagine, anche con i frame a schermo intero', () => {
  const res = L.computeLayout(layers());
  const svg = P.exportSVG(res, view, { solid: true });
  const keys = [...svg.matchAll(/data-key="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(keys.length, res.items.length);
  assert.ok(keys.includes('bg#1/alm:1:0') && keys.includes('menu#1/pop:5:0') && keys.includes('page#1/inp:5:0'));
  // il frame "menu" non copre i blocchi dello sfondo
  const menu = svg.split('<g ').find((g) => /data-key="menu#1"/.test(g));
  assert.match(menu, /fill="none"/);
});

test('miniatura: versione ridotta fedele all\'esportazione', () => {
  const res = L.computeLayout(layers());
  const t = P.thumbnail(res, view, { solid: true }, 400);
  assert.match(t, /class="pv-thumb" width="400" height="240"/);
  assert.doesNotMatch(t, /pv-ovl/);
});
