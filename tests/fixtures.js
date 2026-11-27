'use strict';

/* Configurazioni di prova condivise dai test. */

const L = require('../js/layout.js');

/* La configurazione di un utente: tre frame a schermo intero (sfondo, menu, pagina). */
function layers(menuTransparent) {
  const block = (name, w, h, color) => ({ name, width: w, height: h, gap: 0, align: 'center', color });
  const group = (id, name, area, blocks, extra) => Object.assign({
    id, type: 'group', name, area, direction: 'h', blocks, count: 1, columns: 1, order: 'rows',
    rowGap: 0, colGap: 0, alignH: 'start', alignV: 'start'
  }, extra);
  const frame = (id, name, area, children, extra) => Object.assign({
    id, type: 'frame', name, area, mode: 'fill', color: '#9da1aa', children
  }, extra);
  const none = { top: 0, bottom: 0, left: 0, right: 0 };
  return L.normalizeConfig({
    display: { width: 800, height: 480 },
    nodes: [
      frame('bg', 'sfondo', none, [
        group('alm', 'Allarmi', { top: 0, bottom: 3, left: 70, right: 0 }, [block('Barra', 550, 60, '#2563eb')], { alignV: 'end' }),
        group('pag', 'Pulsanti', { top: 0, bottom: 3, left: 0, right: 3 }, [block('Menu', 60, 60, '#293133')],
          { count: 3, columns: 3, order: 'cols', rowGap: 66, colGap: 3, alignH: 'end', alignV: 'end' }),
        group('logo', 'Logo', { top: 0, bottom: 3, left: 5, right: 3 }, [block('Logo', 60, 60, '#cc0605')], { alignV: 'end' })
      ]),
      frame('menu', 'Menu', none, [
        group('pop', 'Comparsa', { top: 180, bottom: 66, left: 0, right: 3 }, [block('Pulsante', 60, 60, '#16a34a')],
          { count: 5, rowGap: 3, alignH: 'end', alignV: 'end' })
      ], menuTransparent === undefined ? {} : { transparent: menuTransparent }),
      frame('page', 'Pagina', { top: 63, bottom: 63, left: 0, right: 63 }, [
        group('inp', 'Ingressi', none, [block('Ingresso', 150, 50, '#f6f6f6')], { count: 5, rowGap: 10, alignV: 'center' })
      ])
    ]
  });
}


/* Ingressi e uscite con i rispettivi LED, come gruppi separati (esempio di pagina a più colonne). */
function sf() {
  const none = { top: 0, bottom: 0, left: 0, right: 0 };
  const blk = (name, w, h) => ({ name, width: w, height: h, gap: 0, align: 'center', color: '#f6f6f6' });
  const grp = (id, name, area, block, count, alignH) => ({
    id, type: 'group', name, area, direction: 'h', blocks: [block], count, columns: 1, order: 'rows',
    rowGap: 10, colGap: 250, alignH, alignV: 'center'
  });
  return L.normalizeConfig({
    display: { width: 800, height: 480 },
    nodes: [{
      id: 'p', type: 'frame', name: 'SF-1', area: { top: 63, bottom: 63, left: 0, right: 63 },
      children: [
        grp('in', 'In SF', none, blk('Input SF', 150, 50), 5, 'start'),
        grp('out', 'Out SF', none, blk('Output SF', 150, 50), 3, 'end'),
        grp('inl', 'In SF Led', { top: 0, bottom: 0, left: 155, right: 0 }, blk('LED', 100, 50), 5, 'start'),
        grp('outl', 'Out SF Led', { top: 0, bottom: 0, left: 0, right: 155 }, blk('LED', 100, 50), 3, 'end')
      ]
    }]
  });
}


module.exports = { layers, sf };
