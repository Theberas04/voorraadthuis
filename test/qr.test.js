// Tests voor de QR-code van het koppelvenster. Een QR die niet klopt is erger dan geen
// QR, dus dit bestand leest elke code terug met twee onafhankelijke hulpmiddelen:
//   - qrcode (een andere, veelgebruikte uitvoering) om het rooster bit voor bit te vergelijken;
//   - jsQR (een onafhankelijke lezer) om de code echt te decoderen, zoals een telefoon doet.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const jsQR = require('jsqr');
const qrcode = require('qrcode');
const {maakQr, kiesVersie} = require('../public/qr');

const ADRES = 'https://thuis.werdensmedia.net/api/agenda.ics';

// Het rooster omzetten naar een plaatje dat jsQR kan lezen.
function alsBeeld(qr, schaal = 6, marge = 4){
  const maat = (qr.maat + marge * 2) * schaal;
  const data = new Uint8ClampedArray(maat * maat * 4).fill(255);
  for (let y = 0; y < qr.maat; y += 1){
    for (let x = 0; x < qr.maat; x += 1){
      if (qr.modules[y][x] !== 1) continue;
      for (let sy = 0; sy < schaal; sy += 1){
        for (let sx = 0; sx < schaal; sx += 1){
          const punt = ((y + marge) * schaal + sy) * maat + ((x + marge) * schaal + sx);
          data[punt * 4] = 0; data[punt * 4 + 1] = 0; data[punt * 4 + 2] = 0; data[punt * 4 + 3] = 255;
        }
      }
    }
  }
  return {data, width: maat, height: maat};
}

function leesTerug(tekst, schaal){
  const qr = maakQr(tekst);
  const beeld = alsBeeld(qr, schaal);
  const uitkomst = jsQR(beeld.data, beeld.width, beeld.height);
  return {qr, tekst: uitkomst && uitkomst.data};
}

test('de code van het agenda-adres is met een onafhankelijke lezer terug te lezen', () => {
  const {qr, tekst} = leesTerug(ADRES);
  assert.equal(tekst, ADRES, 'de gelezen tekst hoort precies het adres te zijn');
  assert.ok(qr.versie >= 1 && qr.versie <= 10);
  assert.ok(qr.modules.length === qr.maat && qr.modules[0].length === qr.maat);
  for (const rij of qr.modules) for (const vakje of rij) assert.ok(vakje === 0 || vakje === 1, 'elk vakje is licht of donker');
});

test('ook het lokale adres, een maandvariant en tekst met accenten komen er goed uit', () => {
  const proeven = [
    'http://192.168.1.100/api/agenda.ics',
    'https://thuis.werdensmedia.net/api/agenda.ics?maand=2026-10',
    'ë é ü ç ñ — streepje',
    'kort',
    'a'.repeat(200),
  ];
  for (const proef of proeven){
    const {tekst} = leesTerug(proef);
    assert.equal(tekst, proef, `niet goed teruggelezen: ${proef.slice(0, 40)}`);
  }
});

test('het rooster is bit voor bit gelijk aan een andere, veelgebruikte uitvoering', () => {
  // Bytemodus (kleine letters) dwingt dezelfde aanpak af; zo vergelijken we appels met appels.
  for (const lengte of [4, 14, 20, 26, 40, 62, 80, 106, 110, 150, 200]){
    const tekst = 'a'.repeat(lengte);
    const naslag = qrcode.create(tekst, {errorCorrectionLevel: 'M'});
    const mij = maakQr(tekst);
    assert.equal(mij.maat, naslag.modules.size, `andere maat bij ${lengte} tekens`);
    let verschillen = 0;
    for (let y = 0; y < mij.maat; y += 1){
      for (let x = 0; x < mij.maat; x += 1){
        if ((naslag.modules.get(y, x) ? 1 : 0) !== mij.modules[y][x]) verschillen += 1;
      }
    }
    assert.equal(verschillen, 0, `${verschillen} vakjes anders bij ${lengte} tekens (versie ${mij.versie})`);
  }
});

test('de indelingsreeks in de code is precies die uit de standaard', () => {
  // De officiële vijftien bits voor foutcorrectie M, per masker.
  const officieel = ['101010000010010', '101000100100101', '101111001111100', '101101101001011',
    '100010111111001', '100000011001110', '100111110010111', '100101010100000'];
  // De twee stroken worden van de minst belangrijke bit naar de belangrijkste gevuld
  // (kolom 8 van boven naar beneden, daarna rij 8 van rechts naar links). Wie ze in die
  // volgorde leest, krijgt de officiële reeks dus omgekeerd.
  const plekken = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  for (let masker = 0; masker < 8; masker += 1){
    const qr = maakQr(ADRES, {masker});
    const gelezen = plekken.map(([x, y]) => qr.modules[y][x]).join('');
    const verwacht = officieel[masker].split('').reverse().join('');
    assert.equal(gelezen, verwacht, `masker ${masker} hoort de officiële reeks te zijn`);
  }
});

test('de versie wordt gekozen op wat er in past (13, 26 en 42 tekens passen in 1, 2 en 3)', () => {
  assert.equal(kiesVersie(14), 1);
  assert.equal(kiesVersie(15), 2);
  assert.equal(kiesVersie(26), 2);
  assert.equal(kiesVersie(27), 3);
  assert.equal(kiesVersie(42), 3);
  assert.equal(kiesVersie(43), 4);
  assert.equal(kiesVersie(213), 10);
  assert.equal(kiesVersie(214), 0, 'meer dan 213 tekens past niet in versie 10');
});

test('te veel tekst geeft een duidelijke fout in plaats van een kapotte code', () => {
  assert.throws(() => maakQr('a'.repeat(214)), /te lang/);
  assert.throws(() => maakQr(''), /geen tekst/);
});
