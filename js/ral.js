/*
 * ral.js — Colori RAL Classic e lettura dei codici colore.
 *
 * Accetta:  "RAL 3020", "ral3020", "3020"   → colore RAL
 *           "CC0605", "#cc0605", "#c06"     → esadecimale
 * I valori esadecimali sono le approssimazioni sRGB più diffuse
 * (es. RAL 3020 = CC0605): indicative, il RAL vero è un campione fisico.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.DLC = root.DLC || {}).ral = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* [codice, esadecimale, nome italiano] */
  var LIST = [
    ['1000', 'BEBD7F', 'Beige verdastro'], ['1001', 'C2B078', 'Beige'], ['1002', 'C6A664', 'Giallo sabbia'],
    ['1003', 'E5BE01', 'Giallo segnale'], ['1004', 'CDA434', 'Giallo oro'], ['1005', 'A98307', 'Giallo miele'],
    ['1006', 'E4A010', 'Giallo polenta'], ['1007', 'DC9D00', 'Giallo narciso'], ['1011', '8A6642', 'Beige marrone'],
    ['1012', 'C7B446', 'Giallo limone'], ['1013', 'EAE6CA', 'Bianco perla'], ['1014', 'E1CC4F', 'Avorio'],
    ['1015', 'E6D690', 'Avorio chiaro'], ['1016', 'EDFF21', 'Giallo zolfo'], ['1017', 'F5D033', 'Giallo zafferano'],
    ['1018', 'F8F32B', 'Giallo zinco'], ['1019', '9E9764', 'Beige grigiastro'], ['1020', '999950', 'Giallo olivastro'],
    ['1021', 'F3DA0B', 'Giallo navone'], ['1023', 'FAD201', 'Giallo traffico'], ['1024', 'AEA04B', 'Giallo ocra'],
    ['1026', 'FFFF00', 'Giallo brillante'], ['1027', '9D9101', 'Giallo curry'], ['1028', 'F4A900', 'Giallo melone'],
    ['1032', 'D6AE01', 'Giallo scopa'], ['1033', 'F3A505', 'Giallo dalia'], ['1034', 'EFA94A', 'Giallo pastello'],
    ['1035', '6A5D4D', 'Beige perlato'], ['1036', '705335', 'Oro perlato'], ['1037', 'F39F18', 'Giallo sole'],

    ['2000', 'ED760E', 'Arancio giallastro'], ['2001', 'C93C20', 'Arancio rossastro'], ['2002', 'CB2821', 'Arancio sanguigno'],
    ['2003', 'FF7514', 'Arancio pastello'], ['2004', 'F44611', 'Arancio puro'], ['2005', 'FF2301', 'Arancio brillante'],
    ['2007', 'FFA420', 'Arancio chiaro brillante'], ['2008', 'F75E25', 'Rosso arancio chiaro'], ['2009', 'F54021', 'Arancio traffico'],
    ['2010', 'D84B20', 'Arancio segnale'], ['2011', 'EC7C26', 'Arancio profondo'], ['2012', 'E55137', 'Arancio salmone'],
    ['2013', 'C35831', 'Arancio perlato'],

    ['3000', 'AF2B1E', 'Rosso fuoco'], ['3001', 'A52019', 'Rosso segnale'], ['3002', 'A2231D', 'Rosso carminio'],
    ['3003', '9B111E', 'Rosso rubino'], ['3004', '75151E', 'Rosso porpora'], ['3005', '5E2129', 'Rosso vino'],
    ['3007', '412227', 'Rosso nerastro'], ['3009', '642424', 'Rosso ossido'], ['3011', '781F19', 'Rosso marrone'],
    ['3012', 'C1876B', 'Rosso beige'], ['3013', 'A12312', 'Rosso pomodoro'], ['3014', 'D36E70', 'Rosa antico'],
    ['3015', 'EA899A', 'Rosa chiaro'], ['3016', 'B32821', 'Rosso corallo'], ['3017', 'E63244', 'Rosato'],
    ['3018', 'D53032', 'Rosso fragola'], ['3020', 'CC0605', 'Rosso traffico'], ['3022', 'D95030', 'Rosso salmone'],
    ['3024', 'F80000', 'Rosso brillante'], ['3026', 'FE0000', 'Rosso chiaro brillante'], ['3027', 'C51D34', 'Rosso lampone'],
    ['3028', 'CB3234', 'Rosso puro'], ['3031', 'B32428', 'Rosso oriente'], ['3032', '721422', 'Rosso rubino perlato'],
    ['3033', 'B44C43', 'Rosa perlato'],

    ['4001', '6D3F5B', 'Lilla rossastro'], ['4002', '922B3E', 'Viola rossastro'], ['4003', 'DE4C8A', 'Viola erica'],
    ['4004', '641C34', 'Viola bordeaux'], ['4005', '6C4675', 'Lilla bluastro'], ['4006', 'A03472', 'Porpora traffico'],
    ['4007', '4A192C', 'Viola porpora'], ['4008', '924E7D', 'Viola segnale'], ['4009', 'A18594', 'Viola pastello'],
    ['4010', 'CF3476', 'Telemagenta'], ['4011', '8673A1', 'Viola perlato'], ['4012', '6C6874', 'Mora perlato'],

    ['5000', '354D73', 'Blu violaceo'], ['5001', '1F3438', 'Blu verdastro'], ['5002', '20214F', 'Blu oltremare'],
    ['5003', '1D1E33', 'Blu zaffiro'], ['5004', '18171C', 'Blu nerastro'], ['5005', '1E2460', 'Blu segnale'],
    ['5007', '3E5F8A', 'Blu brillante'], ['5008', '26252D', 'Blu grigiastro'], ['5009', '025669', 'Blu azzurro'],
    ['5010', '0E294B', 'Blu genziana'], ['5011', '231A24', 'Blu acciaio'], ['5012', '3B83BD', 'Blu luce'],
    ['5013', '1E213D', 'Blu cobalto'], ['5014', '606E8C', 'Blu colomba'], ['5015', '2271B3', 'Blu cielo'],
    ['5017', '063971', 'Blu traffico'], ['5018', '3F888F', 'Blu turchese'], ['5019', '1B5583', 'Blu capri'],
    ['5020', '1D334A', 'Blu oceano'], ['5021', '256D7B', 'Blu acqua'], ['5022', '252850', 'Blu notte'],
    ['5023', '49678D', 'Blu distante'], ['5024', '5D9B9B', 'Blu pastello'], ['5025', '2A6478', 'Blu genziana perlato'],
    ['5026', '102C54', 'Blu notte perlato'],

    ['6000', '316650', 'Verde patina'], ['6001', '287233', 'Verde smeraldo'], ['6002', '2D572C', 'Verde foglia'],
    ['6003', '424632', 'Verde oliva'], ['6004', '1F3A3D', 'Verde bluastro'], ['6005', '2F4538', 'Verde muschio'],
    ['6006', '3E3B32', 'Oliva grigiastro'], ['6007', '343B29', 'Verde bottiglia'], ['6008', '39352A', 'Verde brunastro'],
    ['6009', '31372B', 'Verde abete'], ['6010', '35682D', 'Verde erba'], ['6011', '587246', 'Verde reseda'],
    ['6012', '343E40', 'Verde nerastro'], ['6013', '6C7156', 'Verde canna'], ['6014', '47402E', 'Oliva giallastro'],
    ['6015', '3B3C36', 'Oliva nerastro'], ['6016', '1E5945', 'Verde turchese'], ['6017', '4C9141', 'Verde maggio'],
    ['6018', '57A639', 'Verde giallastro'], ['6019', 'BDECB6', 'Verde biancastro'], ['6020', '2E3A23', 'Verde cromo'],
    ['6021', '89AC76', 'Verde pallido'], ['6022', '25221B', 'Oliva brunastro'], ['6024', '308446', 'Verde traffico'],
    ['6025', '3D642D', 'Verde felce'], ['6026', '015D52', 'Verde opale'], ['6027', '84C3BE', 'Verde chiaro'],
    ['6028', '2C5545', 'Verde pino'], ['6029', '20603D', 'Verde menta'], ['6032', '317F43', 'Verde segnale'],
    ['6033', '497E76', 'Turchese menta'], ['6034', '7FB5B5', 'Turchese pastello'], ['6035', '1C542D', 'Verde perlato'],
    ['6036', '193737', 'Verde opale perlato'], ['6037', '008F39', 'Verde puro'], ['6038', '00BB2D', 'Verde brillante'],

    ['7000', '78858B', 'Grigio vaio'], ['7001', '8A9597', 'Grigio argento'], ['7002', '7E7B52', 'Grigio olivastro'],
    ['7003', '6C7059', 'Grigio muschio'], ['7004', '969992', 'Grigio segnale'], ['7005', '646B63', 'Grigio topo'],
    ['7006', '6D6552', 'Grigio beige'], ['7008', '6A5F31', 'Grigio kaki'], ['7009', '4D5645', 'Grigio verdastro'],
    ['7010', '4C514A', 'Grigio tenda'], ['7011', '434B4D', 'Grigio ferro'], ['7012', '4E5754', 'Grigio basalto'],
    ['7013', '464531', 'Grigio brunastro'], ['7015', '434750', 'Grigio ardesia'], ['7016', '293133', 'Grigio antracite'],
    ['7021', '23282B', 'Grigio nerastro'], ['7022', '332F2C', 'Grigio ombra'], ['7023', '686C5E', 'Grigio calcestruzzo'],
    ['7024', '474A51', 'Grigio grafite'], ['7026', '2F353B', 'Grigio granito'], ['7030', '8B8C7A', 'Grigio pietra'],
    ['7031', '474B4E', 'Grigio bluastro'], ['7032', 'B8B799', 'Grigio ghiaia'], ['7033', '7D8471', 'Grigio cemento'],
    ['7034', '8F8B66', 'Grigio giallastro'], ['7035', 'D7D7D7', 'Grigio luce'], ['7036', '7F7679', 'Grigio platino'],
    ['7037', '7D7F7D', 'Grigio polvere'], ['7038', 'B5B8B1', 'Grigio agata'], ['7039', '6C6960', 'Grigio quarzo'],
    ['7040', '9DA1AA', 'Grigio finestra'], ['7042', '8D948D', 'Grigio traffico A'], ['7043', '4E5452', 'Grigio traffico B'],
    ['7044', 'CAC4B0', 'Grigio seta'], ['7045', '909090', 'Tele grigio 1'], ['7046', '82898F', 'Tele grigio 2'],
    ['7047', 'D0D0D0', 'Tele grigio 4'], ['7048', '898176', 'Grigio topo perlato'],

    ['8000', '826C34', 'Marrone verdastro'], ['8001', '955F20', 'Marrone ocra'], ['8002', '6C3B2A', 'Marrone segnale'],
    ['8003', '734222', 'Marrone fango'], ['8004', '8E402A', 'Marrone rame'], ['8007', '59351F', 'Marrone capriolo'],
    ['8008', '6F4F28', 'Marrone oliva'], ['8011', '5B3A29', 'Marrone noce'], ['8012', '592321', 'Marrone rossiccio'],
    ['8014', '382C1E', 'Marrone seppia'], ['8015', '633A34', 'Marrone castagna'], ['8016', '4C2F27', 'Marrone mogano'],
    ['8017', '45322E', 'Marrone cioccolata'], ['8019', '403A3A', 'Marrone grigiastro'], ['8022', '212121', 'Marrone nerastro'],
    ['8023', 'A65E2E', 'Marrone arancio'], ['8024', '79553D', 'Marrone beige'], ['8025', '755C48', 'Marrone pallido'],
    ['8028', '4E3B31', 'Marrone terra'], ['8029', '763C28', 'Rame perlato'],

    ['9001', 'FDF4E3', 'Bianco crema'], ['9002', 'E7EBDA', 'Bianco grigiastro'], ['9003', 'F4F4F4', 'Bianco segnale'],
    ['9004', '282828', 'Nero segnale'], ['9005', '0A0A0A', 'Nero intenso'], ['9006', 'A5A5A5', 'Alluminio brillante'],
    ['9007', '8F8F8F', 'Alluminio grigiastro'], ['9010', 'FFFFFF', 'Bianco puro'], ['9011', '1C1C1C', 'Nero grafite'],
    ['9016', 'F6F6F6', 'Bianco traffico'], ['9017', '1E1E1E', 'Nero traffico'], ['9018', 'D7D7D7', 'Bianco papiro'],
    ['9022', '9C9C9C', 'Grigio chiaro perlato'], ['9023', '828282', 'Grigio scuro perlato']
  ];

  var FAMILIES = [
    ['1', 'Gialli e beige'], ['2', 'Arancioni'], ['3', 'Rossi'], ['4', 'Viola'], ['5', 'Blu'],
    ['6', 'Verdi'], ['7', 'Grigi'], ['8', 'Marroni'], ['9', 'Bianchi e neri']
  ];

  /* Colori usati spesso su quadri e pannelli operatore */
  var COMMON = ['9010', '9016', '7035', '7040', '7016', '9005', '3020', '6024', '1023', '2004', '5015', '5017'];

  var byCode = {}, byHex = {};
  LIST.forEach(function (r) {
    byCode[r[0]] = r;
    if (!byHex[r[1]]) byHex[r[1]] = r[0];
  });

  function entry(r) {
    return r ? { code: r[0], color: '#' + r[1].toLowerCase(), name: r[2] } : null;
  }

  function lookup(code) {
    return entry(byCode[String(code || '').replace(/^RAL\s*/i, '').trim()]);
  }

  /* RAL con esattamente questo colore (es. #cc0605 → "3020"), se esiste. */
  function fromHex(hex) {
    var h = String(hex || '').replace('#', '').toUpperCase();
    return byHex[h] || null;
  }

  /* Testo → { color: '#rrggbb', ral: 'NNNN' | '' }  oppure null se non valido. */
  function parse(text) {
    var s = String(text == null ? '' : text).trim().toUpperCase();
    if (!s) return null;
    var m = /^(?:RAL)?[\s.:-]*(\d{4})$/.exec(s);
    if (m) {
      var e = lookup(m[1]);
      return e ? { color: e.color, ral: e.code } : null;
    }
    m = /^#?([0-9A-F]{6})$/.exec(s);
    if (m) return { color: '#' + m[1].toLowerCase(), ral: '' };
    m = /^#?([0-9A-F])([0-9A-F])([0-9A-F])$/.exec(s);
    if (m) return { color: ('#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toLowerCase(), ral: '' };
    return null;
  }

  /* Testo da mostrare in una cella: "RAL 3020" oppure "CC0605". */
  function format(color, ral) {
    if (ral && byCode[ral]) return 'RAL ' + ral;
    return String(color || '').replace('#', '').toUpperCase();
  }

  /* Descrizione completa, es. "RAL 3020 Rosso traffico · #CC0605". */
  function describe(color, ral) {
    var hex = '#' + String(color || '').replace('#', '').toUpperCase();
    if (ral && byCode[ral]) return 'RAL ' + ral + ' ' + byCode[ral][2] + ' · ' + hex;
    var same = fromHex(color);
    return same ? hex + ' (= RAL ' + same + ' ' + byCode[same][2] + ')' : hex;
  }

  function families() {
    return FAMILIES.map(function (f) {
      return {
        key: f[0],
        label: f[1],
        items: LIST.filter(function (r) { return r[0].charAt(0) === f[0]; }).map(entry)
      };
    });
  }

  function common() {
    return COMMON.map(function (c) { return entry(byCode[c]); });
  }

  function all() {
    return LIST.map(entry);
  }

  return {
    lookup: lookup,
    fromHex: fromHex,
    parse: parse,
    format: format,
    describe: describe,
    families: families,
    common: common,
    all: all,
    count: LIST.length
  };
}));
