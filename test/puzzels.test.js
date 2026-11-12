// Tests voor de puzzelverzameling: barcode opzoeken bij de bron, zelf leren wat je
// invult, filters, keuzelijsten, foto's en de routes.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {DatabaseSync} = require('node:sqlite');
const {createPuzzels, stukkenUit, normaliseerCode} = require('../puzzels');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'puzzels-unit-'));
const media = path.join(dir, 'fotos');

function maakModule({fetchImpl, bronAan = true} = {}){
  const db = new DatabaseSync(path.join(dir, `puzzels-${Math.random().toString(36).slice(2)}.db`));
  return {db, puzzels: createPuzzels({db, mediaDir: media, fetchImpl, bronAan})};
}

// Een antwoord van de databank nabootsen.
const bronAntwoord = (product) => ({
  ok: true,
  json: async () => ({product}),
});

test('het aantal stukken wordt uit de naam of de hoeveelheid gehaald', () => {
  assert.equal(stukkenUit('Puzzle Van Gogh 1500 pièces'), 1500);
  assert.equal(stukkenUit('Ravensburger 1000 Teile'), 1000);
  assert.equal(stukkenUit('1000 pieces landscape'), 1000);
  assert.equal(stukkenUit('Kinderpuzzel 48 stuks'), 48);
  assert.equal(stukkenUit('Zonder aantal'), null);
  assert.equal(stukkenUit(''), null);
  assert.equal(normaliseerCode('4 005556 163380'), '4005556163380');
  assert.equal(normaliseerCode('123'), '', 'te kort is geen barcode');
  assert.equal(normaliseerCode('40055561633801234'), '', 'te lang is geen barcode');
});

test('een onbekende barcode wordt bij de bron opgezocht en daarna onthouden', async () => {
  let keer = 0;
  const {puzzels} = maakModule({
    fetchImpl: async (adres) => {
      keer += 1;
      assert.ok(adres.includes('openproductsfacts.org'));
      assert.ok(adres.includes('4005556163380'));
      return bronAntwoord({code: '4005556163380', product_name: 'Puzzle Van Gogh 1500 pièces', brands: 'Ravensburger', quantity: '1500 pièces', categories_tags: ['en:jigsaw-puzzles']});
    },
  });
  const eerste = await puzzels.zoekCode('4005556163380');
  assert.equal(eerste.gevonden, true);
  assert.equal(eerste.voorstel.titel, 'Puzzle Van Gogh 1500 pièces');
  assert.equal(eerste.voorstel.merk, 'Ravensburger');
  assert.equal(eerste.voorstel.stukken, 1500);
  assert.equal(eerste.bron, 'Open Products Facts');
  assert.equal(keer, 1);

  const tweede = await puzzels.zoekCode('4005556163380');
  assert.equal(keer, 1, 'de tweede keer komt uit het geheugen, zonder de bron te vragen');
  assert.equal(tweede.bekend, true);
  assert.equal(tweede.voorstel.stukken, 1500);
});

test('wat je zelf invult wordt de waarheid bij de volgende scan van die barcode', async () => {
  const {puzzels} = maakModule({
    fetchImpl: async () => ({ok: false, json: async () => ({})}),
  });
  const leeg = await puzzels.zoekCode('8710123456789');
  assert.equal(leeg.gevonden, false);
  assert.equal(leeg.voorstel, null);
  assert.match(leeg.reden, /niet in de databank/);

  const bewaard = puzzels.maak({code: '8710123456789', titel: 'Molen aan de plas', merk: 'Jumbo', stukken: 1000, locatie: 'Kast zolder'});
  assert.equal(bewaard.titel, 'Molen aan de plas');
  assert.equal(bewaard.statusTekst, 'Nieuw');

  const opnieuw = await puzzels.zoekCode('8710123456789');
  assert.equal(opnieuw.inBezit, true, 'deze barcode zit nu in de verzameling');
  assert.equal(opnieuw.puzzel.titel, 'Molen aan de plas');
  assert.equal(opnieuw.bron, 'eigen verzameling');
});

test('de invoer wordt gecontroleerd en een tweede keer dezelfde barcode mag niet', () => {
  const {puzzels} = maakModule({fetchImpl: async () => ({ok: false})});
  assert.throws(() => puzzels.maak({code: '4005556163400'}), /titel/);
  assert.throws(() => puzzels.maak({titel: 'Test', status: 'verzonnen'}), /status/);
  assert.throws(() => puzzels.maak({titel: 'Test', stukken: 2}), /stukken/);
  assert.throws(() => puzzels.maak({titel: 'Test', aantal: 0}), /exemplaren/);
  assert.throws(() => puzzels.maak({titel: 'Test', status: 'uitgeleend'}), /aan wie/);
  puzzels.maak({code: '4005556163400', titel: 'Eerste', stukken: 500});
  assert.throws(() => puzzels.maak({code: '4005556163400', titel: 'Tweede'}), /al in je verzameling/);
});

test('een gedeeltelijke wijziging laat de andere velden staan', () => {
  const {puzzels} = maakModule({fetchImpl: async () => ({ok: false})});
  const puzzel = puzzels.maak({code: '4005556163410', titel: 'Havenzicht', merk: 'Ravensburger', stukken: 500, locatie: 'Kast woonkamer'});
  const gewijzigd = puzzels.wijzig(puzzel.id, {status: 'uitgeleend', uitgeleendAan: 'Lars'});
  assert.equal(gewijzigd.status, 'uitgeleend');
  assert.equal(gewijzigd.uitgeleend_aan, 'Lars');
  assert.equal(gewijzigd.titel, 'Havenzicht', 'de titel blijft staan');
  assert.equal(gewijzigd.stukken, 500);
  assert.equal(gewijzigd.locatie, 'Kast woonkamer');
  assert.equal(gewijzigd.statusTekst, 'Uitgeleend');
  // en weer terug
  const terug = puzzels.wijzig(puzzel.id, {status: 'gedaan'});
  assert.equal(terug.status, 'gedaan');
  assert.equal(terug.uitgeleend_aan, '', 'de uitleeninformatie is gewist toen je dat vroeg');
  assert.equal(puzzels.wijzig(9999, {status: 'gedaan'}), null);
});

test('het overzicht telt dozen, filtert en levert keuzelijsten', () => {
  const {puzzels} = maakModule({fetchImpl: async () => ({ok: false})});
  puzzels.maak({titel: 'Berglandschap', merk: 'Jumbo', stukken: 1000, locatie: 'Zolder', aantal: 2});
  puzzels.maak({titel: 'Nachtwacht', merk: 'Ravensburger', stukken: 2000, locatie: 'Zolder'});
  puzzels.maak({titel: 'Boerderij', merk: 'Jumbo', stukken: 500, locatie: 'Woonkamer', status: 'gedaan'});

  const alles = puzzels.overzicht({});
  assert.equal(alles.puzzels.length, 3);
  assert.equal(alles.dozen, 4, 'een puzzel met twee exemplaren telt als twee dozen');
  assert.equal(alles.keuzelijsten.merken.length, 2);
  assert.deepEqual(alles.keuzelijsten.stukken.map(s => s.naam), [500, 1000, 2000]);
  assert.equal(alles.keuzelijsten.perStatus.find(s => s.status === 'gedaan').aantal, 1);
  assert.equal(alles.bron.naam, 'Open Products Facts');

  assert.equal(puzzels.overzicht({merk: 'Jumbo'}).puzzels.length, 2);
  assert.equal(puzzels.overzicht({stukken: '2000'}).puzzels.length, 1);
  assert.equal(puzzels.overzicht({status: 'gedaan'}).puzzels.length, 1);
  assert.equal(puzzels.overzicht({locatie: 'Zolder'}).puzzels.length, 2);
  assert.equal(puzzels.overzicht({zoekterm: 'nacht'}).puzzels.length, 1);
});

test('een foto van de doos wordt bewaard en een verkeerd bestand niet', () => {
  const {puzzels} = maakModule({fetchImpl: async () => ({ok: false})});
  const puzzel = puzzels.maak({titel: 'Kathedraal', stukken: 1000});
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 7)]);
  const url = puzzels.bewaarFoto(puzzel.id, jpeg.toString('base64'));
  assert.match(url, /^\/media\/puzzel-\d+\.jpg$/);
  assert.ok(fs.existsSync(path.join(media, path.basename(url))));
  assert.throws(() => puzzels.bewaarFoto(puzzel.id, Buffer.alloc(400, 65).toString('base64')), /JPEG/, 'een groot bestand dat geen foto is hoort een nette melding te geven');
  assert.throws(() => puzzels.bewaarFoto(4242, jpeg.toString('base64')), /staat niet in je verzameling/);
  const verwijderd = puzzels.verwijder(puzzel.id);
  assert.equal(verwijderd.verwijderd, puzzel.id);
  assert.ok(!fs.existsSync(path.join(media, path.basename(url))), 'de foto gaat mee met de puzzel');
});

// ---- De routes, via de echte server --------------------------------------------
const routeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puzzels-routes-'));
process.env.DB_PATH = path.join(routeDir, 'test.db');
process.env.MEDIA_DIR = path.join(routeDir, 'fotos');
process.env.WEER_AUTO = '0';
process.env.PLATEN_HOES_AUTO = '0';
process.env.PLATEN_DISCOGS_DB = '0';
process.env.PLATEN_TABEL = '0';
process.env.PUZZEL_BRON = '0';
const {server, db} = require('../server');
let base;
test.before(async () => { await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { await new Promise(r => server.close(r)); db.close(); fs.rmSync(dir, {recursive: true, force: true}); fs.rmSync(routeDir, {recursive: true, force: true}); });
const call = (pad, method = 'GET', body) => fetch(base + pad, {method, headers: body ? {'content-type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});

test('de routes: toevoegen, lezen, filteren, wijzigen en verwijderen', async () => {
  const toevoegen = await call('/api/puzzels', 'POST', {titel: 'Wintertafereel', merk: 'Schmidt', stukken: 1000, locatie: 'Kast hal', notitie: 'tweedehands'});
  assert.equal(toevoegen.status, 201);
  const {puzzel} = await toevoegen.json();
  assert.equal(puzzel.status, 'nieuw');

  const lijst = await (await call('/api/puzzels?merk=Schmidt')).json();
  assert.equal(lijst.puzzels.length, 1);
  assert.equal(lijst.puzzels[0].titel, 'Wintertafereel');
  assert.equal(lijst.keuzelijsten.locaties[0].naam, 'Kast hal');

  const zoeken = await (await call('/api/puzzels/zoek?code=4005556163380')).json();
  assert.equal(zoeken.gevonden, false, 'de bron staat uit in de test');
  assert.match(zoeken.reden, /staat uit/);

  const wijzigen = await call(`/api/puzzels/${puzzel.id}`, 'PATCH', {status: 'bezig'});
  assert.equal(wijzigen.status, 200);
  assert.equal((await wijzigen.json()).puzzel.statusTekst, 'Mee bezig');

  assert.equal((await call(`/api/puzzels/${puzzel.id}`)).status, 200);
  assert.equal((await call('/api/puzzels/9999', 'PATCH', {status: 'gedaan'})).status, 404);
  assert.equal((await call('/api/puzzels/abc')).status, 404);

  const weg = await call(`/api/puzzels/${puzzel.id}`, 'DELETE');
  assert.equal(weg.status, 200);
  assert.equal((await (await call('/api/puzzels')).json()).puzzels.length, 0);
});

test('een onbruikbare barcode of invoer geeft een nette melding', async () => {
  assert.equal((await call('/api/puzzels/zoek?code=12')).status, 400);
  const fout = await call('/api/puzzels', 'POST', {merk: 'Zonder titel'});
  assert.equal(fout.status, 400);
  assert.match((await fout.json()).error, /titel/);
});

test('de puzzelpagina staat in de app, met de bronvermelding erbij', async () => {
  const html = await (await call('/')).text();
  assert.ok(html.includes('<script src="puzzels.js?v=2">'), 'de puzzelpagina hoort geladen te worden');
  assert.ok(/<button data-page="puzzels">Puzzels<\/button>/.test(html), 'en een eigen tab te hebben');
  assert.ok(html.includes('id="page-puzzels"'), 'met een eigen pagina');
  for (const id of ['puzzelCode', 'puzzelScan', 'puzzelTitel', 'puzzelStukken', 'puzzelStukkenKnoppen', 'puzzelStatus', 'puzzelUitgeleendVak', 'puzzelLocatie', 'puzzelGrid', 'puzzelBron', 'puzzelWisFilters']) {
    assert.ok(html.includes(`id="${id}"`), `het veld ${id} hoort er te zijn`);
  }
  assert.ok(html.includes("name==='puzzels'&&window.PuzzelsPagina"), 'de pagina hoort te laden als je de tab opent');
  const script = await (await call('/puzzels.js?v=2')).text();
  assert.ok(script.includes('BarcodeScan'), 'de scanner wordt hergebruikt');
  assert.ok(script.includes('Open Products Facts'), 'de bron staat in de pagina zelf');
  assert.ok(script.includes('/api/puzzels/zoek?code='), 'en de pagina vraagt de barcode op');
  const sw = await (await call('/sw.js')).text();
  assert.ok(sw.includes("'/puzzels.js?v=2'"), 'de service worker kent het bestand');
});

test('de bronvermelding voor de puzzelgegevens staat in de README', async () => {
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  assert.ok(/Open Products Facts/.test(readme), 'de bron hoort in de README te staan');
  assert.ok(/ODbL/.test(readme), 'met de licentie erbij');
});

test('de printbare lijst zet de verzameling op papier, met dozen en filters', async () => {
  await call('/api/puzzels', 'POST', {titel: 'Molen aan de plas & co', merk: 'Jumbo', stukken: 1000, locatie: 'Kast zolder', aantal: 2});
  await call('/api/puzzels', 'POST', {titel: 'Boerderij', merk: 'Jumbo', stukken: 100, locatie: 'Slaapkamer', status: 'uitgeleend', uitgeleendAan: 'Lars', uitgeleendOp: '2026-10-18'});

  const pagina = await call('/api/puzzels/lijst');
  assert.equal(pagina.status, 200);
  assert.match(pagina.headers.get('content-type'), /text\/html/);
  const html = await pagina.text();
  assert.ok(html.includes('Mijn puzzelverzameling'), 'met een titel boven de lijst');
  assert.ok(html.includes('window.print()'), 'en een afdrukknop');
  assert.ok(html.includes('@page{size:A4 landscape'), 'die op A4 liggend past');
  for (const kop of ['Titel', 'Merk', 'Stukken', 'Soort', 'Jaar', 'Formaat', 'Plek', 'Aantal', 'Status', 'Notitie']) {
    assert.ok(html.includes(`>${kop}<`), `de kolom ${kop} hoort er te zijn`);
  }
  assert.ok(html.includes('Molen aan de plas &amp; co'), 'de titel wordt veilig weergegeven');
  assert.ok(html.includes('bij Lars sinds 2026-10-18'), 'aan wie is uitgeleend staat erbij');
  assert.ok(html.includes('>Uitgeleend<'), 'de status staat er voluit, niet als code');
  assert.ok(/3 dozen/.test(html), 'de dozen worden geteld');
  assert.ok(!html.includes('<script'), 'geen scripts uit de gegevens op de afdruk');

  const alleenUitgeleend = await (await call('/api/puzzels/lijst?status=uitgeleend')).text();
  assert.ok(alleenUitgeleend.includes('Boerderij'));
  assert.ok(!alleenUitgeleend.includes('Molen aan de plas'), 'de filter werkt ook op de afdruk');
  assert.ok(alleenUitgeleend.includes('Filter: status Uitgeleend'), 'en staat er eerlijk bij vermeld');
  assert.ok(/1 doos/.test(alleenUitgeleend), 'de telling volgt de filter');

  const csv = await call('/api/puzzels/lijst.csv');
  const tekst = await csv.text();
  assert.match(csv.headers.get('content-disposition'), /puzzels-lijst-\d{4}-\d{2}-\d{2}\.csv/);
  assert.ok(tekst.startsWith('titel;code;merk;stukken;soort;jaar;formaat;plek;aantal;status;uitgeleend_aan;uitgeleend_op;notitie'), 'met een kopregel');
  assert.ok(tekst.includes('Molen aan de plas & co;'), 'met puntkomma als scheiding, zoals Excel in Nederland verwacht');
  assert.ok(tekst.includes('Uitgeleend;Lars;2026-10-18'), 'en de uitleeninformatie');

  for (const p of (await (await call('/api/puzzels')).json()).puzzels) await call(`/api/puzzels/${p.id}`, 'DELETE');
  assert.equal((await (await call('/api/puzzels')).json()).puzzels.length, 0);
});

test('de knoppen voor de printbare lijst zitten op de puzzelpagina en nemen de filters mee', async () => {
  const html = await (await call('/')).text();
  assert.ok(html.includes('id="puzzelLijst"'), 'de knop hoort er te zijn');
  assert.ok(html.includes('id="puzzelLijstCsv"'), 'en de CSV-knop');
  assert.ok(html.includes('href="/api/puzzels/lijst"'), 'met de route erin');
  const script = await (await call('/puzzels.js?v=2')).text();
  assert.ok(script.includes('werkLijstKoppen'), 'de koppen lopen mee met de filters');
  assert.ok(script.includes('/api/puzzels/lijst.csv'), 'beide routes worden gezet');
});
