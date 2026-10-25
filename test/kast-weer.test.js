// Het kledingadvies met het weer erbij: regen, kou en warmte horen door te
// werken in de keuze zelf, niet alleen in een losse regel tekst.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const {createWardrobe} = require('../wardrobe');

function kast(){
  const db = new DatabaseSync(':memory:');
  const wardrobe = createWardrobe({db, mediaDir:'/tmp'});
  const toevoegen = (name, category, material = '') => db.prepare('INSERT INTO items(name,category,material,color,color_hex,status,seasons,occasions,wardrobe_id) VALUES(?,?,?,?,?,?,?,?,1)')
    .run(name, category, material, 'blauw', '#2b4c8c', 'schoon', '', '');
  toevoegen('Blauw overhemd', 'bovenkleding', 'katoen');
  toevoegen('Grijze trui', 'trui', 'wol');
  toevoegen('Spijkerbroek', 'broek', 'denim');
  toevoegen('Leren schoenen', 'schoenen', 'leer');
  toevoegen('Sportschoenen', 'schoenen', 'textiel');
  toevoegen('Winterjas', 'jas', 'wol');
  toevoegen('Regenjas', 'jas', 'polyester');
  return wardrobe;
}

const REGEN = {datum:'2027-01-15', tempMax:3, tempMin:-1.4, regenkans:80, wind:45, code:61, omschrijving:'regen', plaats:'Delft'};
const WARM = {datum:'2026-07-15', tempMax:26, tempMin:16, regenkans:10, wind:8, code:0, omschrijving:'onbewolkt', plaats:'Delft'};

test('bij regen en kou kiest het advies waterdichte schoenen en een jas', () => {
  const advies = kast().suggest({occasion:'buiten', date:'2027-01-15', seed:0, weer:REGEN});
  assert.ok(advies.reasons.some(r => /regen/i.test(r)), 'het regenadvies hoort erbij te staan');
  assert.ok(advies.reasons.some(r => /warme jas|niet warmer dan/i.test(r)), 'het koude-weeradvies hoort erbij te staan');
  assert.ok(advies.reasons.some(r => /^Weer: 3 °C/.test(r)), 'de verwachting zelf staat vooraan in het advies');
  assert.equal(advies.weer.regenkans, 80);
  const schoenen = advies.items.filter(i => i.category === 'schoenen').map(i => i.name);
  assert.ok(schoenen.includes('Sportschoenen'), 'bij regen horen de niet-leren schoenen gekozen te worden');
  assert.ok(!schoenen.includes('Leren schoenen'), 'leren schoenen blijven bij regen in de kast');
  assert.ok(advies.items.some(i => i.category === 'jas'), 'bij 3 °C hoort er een jas in het advies te zitten');
});

test('bij warm weer blijft de jas thuis', () => {
  const advies = kast().suggest({occasion:'buiten', date:'2026-07-15', seed:0, weer:WARM});
  assert.ok(advies.reasons.some(r => /jas kan thuisblijven/i.test(r)), 'het warme-weeradvies hoort erbij te staan');
  assert.equal(advies.items.filter(i => i.category === 'jas').length, 0, 'bij 26 °C gaat er geen jas mee');
  assert.ok(advies.items.some(i => i.category === 'schoenen'), 'zonder regen blijven alle schoenen mogelijk');
});

test('zonder weer blijft het advies precies zoals het was', () => {
  const advies = kast().suggest({occasion:'buiten', date:'2027-01-15', seed:0});
  assert.equal(advies.weer, null);
  assert.ok(!advies.reasons.some(r => /^Weer:/.test(r)), 'zonder verwachting hoort er geen weerregel te staan');
  assert.ok(advies.reasons.some(r => r.startsWith('Seizoen:')), 'het seizoen blijft wel genoemd worden');
  assert.ok(advies.items.length >= 2);
});
