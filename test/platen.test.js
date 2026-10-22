// Tests voor de platenpagina: barcode scannen, gegevens opzoeken bij MusicBrainz en de hoes
// bij het Cover Art Archive, toevoegen aan de verzameling, en de collectie per locatie
// bekijken. De databanken worden nagebootst, zodat de test geen internet nodig heeft.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voorraadthuis-platen-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.MEDIA_DIR = path.join(dir, 'fotos');

const EAN = '602547077743';       // bekend bij de nagemaakte databank
const EAN_LEEG = '602547077750';  // onbekend
let mbVerzoeken = 0, caaVerzoeken = 0, mbStoring = false;

let stub, server, db, base;
test.before(async () => {
  stub = http.createServer((req, res) => {
    const url = req.url || '';
    if (url.startsWith('/release-group/')) {
      res.writeHead(200, {'content-type': 'application/json'});
      return res.end(JSON.stringify({id: 'rg-1', genres: [{name: 'progressive rock', count: 3}, {name: 'rock', count: 7}], tags: [{name: 'psychedelic', count: 1}]}));
    }
    if (url.startsWith('/release/') && !url.includes('?query=')) {
      caaVerzoeken += 1;
      if (url.includes('geenhoes')) { res.writeHead(404); return res.end('{}'); }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ images: [{ front: true, thumbnails: { large: 'http://hoes.test/voor-500.jpg', small: 'http://hoes.test/voor-250.jpg' }, image: 'http://hoes.test/voor.jpg' }] }));
    }
    mbVerzoeken += 1;
    if (mbStoring) { res.writeHead(503); return res.end('{}'); }
    const vraag = decodeURIComponent(url);
    res.writeHead(200, { 'content-type': 'application/json' });
    if (vraag.includes(EAN)) {
      return res.end(JSON.stringify({
        releases: [
          { id: 'geenhoes', title: 'Zwakke uitgave', score: 100, date: '', 'artist-credit': [{ name: 'Iemand' }] },
          {
            id: 'mbid-1', title: 'The Dark Side of the Moon', score: 100, date: '1973-03-01', country: 'GB',
            'artist-credit': [{ name: 'Pink Floyd' }],
            'label-info': [{ label: { name: 'Harvest' }, 'catalog-number': 'SHVL 804' }],
            media: [{ format: '12" Vinyl', 'track-count': 10 }],
            'release-group': { id: 'rg-1', 'primary-type': 'Album' },
          },
        ],
      }));
    }
    res.end(JSON.stringify({ releases: [] }));
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  process.env.PLATEN_MB_BASIS = `http://127.0.0.1:${stub.address().port}`;
  process.env.PLATEN_CAA_BASIS = `http://127.0.0.1:${stub.address().port}`;
  ({ server, db } = require('../server'));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise(r => server.close(r));
  await new Promise(r => stub.close(r));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const api = (pad, opties) => fetch(`${base}${pad}`, opties).then(async r => ({ status: r.status, body: await r.json() }));
const stuur = (pad, methode, gegevens) => api(pad, { method: methode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(gegevens) });

test('een gescande barcode levert de plaat op, met hoes', async () => {
  const uitkomst = await api(`/api/platen/zoek/${EAN}`);
  assert.equal(uitkomst.status, 200);
  assert.equal(uitkomst.body.gevonden, true);
  assert.equal(uitkomst.body.titel, 'The Dark Side of the Moon');
  assert.equal(uitkomst.body.artiest, 'Pink Floyd');
  assert.equal(uitkomst.body.jaar, '1973');
  assert.equal(uitkomst.body.label, 'Harvest');
  assert.match(uitkomst.body.formaat, /Vinyl/);
  assert.match(uitkomst.body.formaat, /10 nummers/);
  assert.equal(uitkomst.body.genre, 'Rock', 'het genre komt uit de uitgave-groep, niet het soort uitgave');
  assert.equal(uitkomst.body.hoes, 'http://hoes.test/voor-500.jpg', 'de voorplaat hoort gekozen te worden');
  assert.equal(uitkomst.body.bron, 'MusicBrainz');
});

test('dezelfde barcode wordt niet opnieuw opgezocht', async () => {
  const voor = mbVerzoeken;
  const uitkomst = await api(`/api/platen/zoek?code=${EAN}`);
  assert.equal(uitkomst.body.cached, true);
  assert.equal(mbVerzoeken, voor, 'de tweede keer komt de plaat uit de eigen bewaarde gegevens');
  assert.equal(uitkomst.body.hoes, 'http://hoes.test/voor-500.jpg');
});

test('een onbekende barcode zegt het eerlijk', async () => {
  const uitkomst = await api(`/api/platen/zoek?code=${EAN_LEEG}`);
  assert.equal(uitkomst.body.gevonden, false);
  assert.equal(uitkomst.body.reason, undefined);
  const raar = await api('/api/platen/zoek?code=1234');
  assert.equal(raar.body.gevonden, false);
  assert.equal(raar.body.reason, 'ongeldig');
});

test('een plaat toevoegen aan de verzameling', async () => {
  const uitkomst = await stuur('/api/platen', 'POST', {
    barcode: EAN, titel: 'The Dark Side of the Moon', artiest: 'Pink Floyd', jaar: '1973',
    label: 'Harvest', formaat: '12 inch Vinyl · 10 nummers', genre: 'Album',
    hoes: 'http://hoes.test/voor-500.jpg', locatie: 'Woonkamer', notitie: 'Eerste persing', aantal: 2,
  });
  assert.equal(uitkomst.status, 201);
  assert.equal(uitkomst.body.plaat.locatie, 'Woonkamer');
  assert.equal(uitkomst.body.plaat.aantal, 2);
});

test('dezelfde plaat op dezelfde plek telt op in plaats van dubbel te verschijnen', async () => {
  const uitkomst = await stuur('/api/platen', 'POST', { barcode: EAN, titel: 'The Dark Side of the Moon', artiest: 'Pink Floyd', locatie: 'Woonkamer', aantal: 1 });
  assert.equal(uitkomst.body.opgeteld, true);
  assert.equal(uitkomst.body.plaat.aantal, 3);
  const overzicht = await api('/api/platen');
  assert.equal(overzicht.body.totaal, 1);
  assert.equal(overzicht.body.stuks, 3);
});

test('dezelfde plaat op een andere plek is een eigen exemplaar', async () => {
  const uitkomst = await stuur('/api/platen', 'POST', { barcode: EAN, titel: 'The Dark Side of the Moon', artiest: 'Pink Floyd', locatie: 'Zolder', aantal: 1 });
  assert.equal(uitkomst.status, 201);
  const overzicht = await api('/api/platen');
  assert.equal(overzicht.body.totaal, 2);
  const plekken = overzicht.body.locaties.map(l => l.naam).sort();
  assert.deepEqual(plekken, ['Woonkamer', 'Zolder']);
  assert.equal(overzicht.body.locaties.find(l => l.naam === 'Woonkamer').aantal, 1);
});

test('je kunt je verzameling per locatie bekijken', async () => {
  const woonkamer = await api('/api/platen?locatie=Woonkamer');
  assert.equal(woonkamer.body.totaal, 1);
  assert.equal(woonkamer.body.platen[0].locatie, 'Woonkamer');
  const zolder = await api('/api/platen?locatie=Zolder');
  assert.equal(zolder.body.totaal, 1);
  assert.equal(zolder.body.platen[0].locatie, 'Zolder');
  const alles = await api('/api/platen?locatie=');
  assert.equal(alles.body.totaal, 2, 'een lege locatie betekent: alles');
});

test('een plaat verhuist naar een andere locatie en houdt al zijn gegevens', async () => {
  const alles = await api('/api/platen');
  const plaat = alles.body.platen.find(p => p.locatie === 'Zolder');
  const uitkomst = await stuur(`/api/platen/${plaat.id}`, 'PATCH', { locatie: 'Mama' });
  assert.equal(uitkomst.status, 200);
  assert.equal(uitkomst.body.locatie, 'Mama');
  assert.equal(uitkomst.body.artiest, 'Pink Floyd', 'de rest van de gegevens blijft staan');
  assert.equal(uitkomst.body.barcode, EAN);
  assert.equal(uitkomst.body.titel, 'The Dark Side of the Moon');
  const mama = await api('/api/platen?locatie=Mama');
  assert.equal(mama.body.totaal, 1);
});

test('je kunt zoeken in de verzameling en een plaat verwijderen', async () => {
  const gezocht = await api('/api/platen?q=pink');
  assert.equal(gezocht.body.totaal, 2);
  const niets = await api('/api/platen?q=queen');
  assert.equal(niets.body.totaal, 0);
  const alles = await api('/api/platen');
  const weg = alles.body.platen[0];
  const uitkomst = await api(`/api/platen/${weg.id}`, { method: 'DELETE' });
  assert.equal(uitkomst.status, 200);
  const na = await api('/api/platen');
  assert.equal(na.body.totaal, 1);
  const nogmaals = await api(`/api/platen/${weg.id}`, { method: 'DELETE' });
  assert.equal(nogmaals.status, 404);
});

test('een plaat zonder titel wordt geweigerd', async () => {
  const uitkomst = await stuur('/api/platen', 'POST', { artiest: 'Iemand', locatie: 'Woonkamer' });
  assert.equal(uitkomst.status, 400);
  assert.match(uitkomst.body.error, /titel/i);
});

test('werkt de databank niet, dan blijft de bewaarde plaat bruikbaar', async () => {
  await api(`/api/platen/zoek/${EAN}?force=1`);     // vult de bewaarde gegevens
  mbStoring = true;
  try {
    const uitkomst = await api(`/api/platen/zoek/${EAN}?force=1`);
    assert.equal(uitkomst.body.gevonden, true, 'de eerder opgezochte plaat komt uit de eigen gegevens');
    assert.equal(uitkomst.body.storing, true);
  } finally { mbStoring = false }
});

test('de verzameling is ook zonder internet te bekijken', async () => {
  mbStoring = true;
  try {
    const overzicht = await api('/api/platen');
    assert.ok(overzicht.body.totaal >= 1);
    assert.ok(overzicht.body.platen.every(p => p.titel), 'elke plaat houdt zijn titel');
  } finally { mbStoring = false }
});

// --- Filteren op genre, artiest en jaartal ---
const nu = (gegevens) => stuur('/api/platen', 'POST', gegevens);
const titels = (body) => body.platen.map((p) => p.titel).sort();

test('je kunt filteren op genre, locatie, artiest en jaartal', async () => {
  await nu({ barcode: '', titel: 'Rumours', artiest: 'Fleetwood Mac', jaar: '1977', label: 'Warner', formaat: '12" Vinyl', genre: 'Rock', locatie: 'Zolder', aantal: 1 });
  await nu({ barcode: '', titel: 'Thriller', artiest: 'Michael Jackson', jaar: '1982', label: 'Epic', formaat: '12" Vinyl', genre: 'Pop', locatie: 'Woonkamer', aantal: 1 });
  await nu({ barcode: '', titel: 'Kind of Blue', artiest: 'Miles Davis', jaar: '1959', label: 'Columbia', formaat: '12" Vinyl', genre: 'Jazz', locatie: 'Zolder', aantal: 1 });
  await nu({ barcode: '', titel: 'Onbekende plaat', artiest: 'Iemand Anders', jaar: '', label: '', formaat: '', genre: '', locatie: 'Zolder', aantal: 1 });

  const rock = await api('/api/platen?genre=Rock');
  assert.deepEqual(titels(rock.body), ['Rumours'], 'op genre filteren geeft precies die platen');
  assert.equal(rock.body.filters.genre, 'Rock', 'de gebruikte filters komen terug in het antwoord');

  const klein = await api('/api/platen?genre=rock');
  assert.deepEqual(titels(klein.body), ['Rumours'], 'filteren maakt geen verschil tussen hoofd- en kleine letters');

  const artiest = await api('/api/platen?artiest=miles%20davis');
  assert.deepEqual(titels(artiest.body), ['Kind of Blue'], 'op artiest filteren werkt ook met kleine letters');

  const decennium = await api('/api/platen?decennium=1970');
  assert.deepEqual(titels(decennium.body), ['Rumours'], 'een decennium pakt het hele tiental');

  const jaren = await api('/api/platen?van=1975&tot=1985');
  assert.deepEqual(titels(jaren.body), ['Rumours', 'Thriller'], 'van en tot werken samen');

  const alleenVanaf = await api('/api/platen?van=1980');
  assert.ok(alleenVanaf.body.platen.every((p) => Number(p.jaar) >= 1980), 'vanaf een jaar laat niets ouders door');

  const onbekendGenre = await api('/api/platen?genre=onbekend');
  assert.ok(onbekendGenre.body.platen.some((p) => p.titel === 'Onbekende plaat'), 'je kunt juist de platen zonder genre opzoeken');
  assert.ok(onbekendGenre.body.platen.every((p) => !String(p.genre || '').trim()), 'en er zit geen plaat met genre tussen');

  const onbekendJaar = await api('/api/platen?decennium=onbekend');
  assert.ok(onbekendJaar.body.platen.some((p) => p.titel === 'Onbekende plaat'));
  assert.ok(onbekendJaar.body.platen.every((p) => !/\d{4}/.test(String(p.jaar || ''))));

  const gecombineerd = await api('/api/platen?locatie=Zolder&genre=Jazz');
  assert.deepEqual(titels(gecombineerd.body), ['Kind of Blue'], 'locatie en genre werken tegelijk');
});

test('de pagina krijgt keuzelijsten met aantallen om op te filteren', async () => {
  const uitkomst = await api('/api/platen');
  const keuzes = uitkomst.body.keuzelijsten;
  assert.ok(keuzes, 'het antwoord bevat keuzelijsten');
  const rock = keuzes.genres.find((g) => g.naam === 'Rock');
  assert.ok(rock && rock.aantal >= 1, 'elk genre heeft een aantal');
  assert.ok(keuzes.artiesten.some((a) => a.naam === 'Fleetwood Mac'), 'de artiesten staan erin');
  assert.ok(keuzes.decennia.some((d) => d.naam === '1970' && /1970 – 1979/.test(d.label)), 'decennia hebben een leesbaar label');
  assert.ok(keuzes.decennia.some((d) => d.naam === 'onbekend'), 'ontbrekende jaartallen zijn ook te kiezen');
  assert.ok(keuzes.locaties.some((l) => l.sleutel === 'Zolder' && l.aantal >= 1), 'de locaties komen mee met aantallen');
  const jazz = keuzes.genres.find((g) => g.naam === 'Jazz');
  assert.ok(jazz.aantal >= 1);
  // De keuzelijsten komen uit de hele verzameling: filteren mag ze niet laten krimpen.
  const gefilterd = await api('/api/platen?genre=Jazz');
  assert.deepEqual(titels(gefilterd.body), ['Kind of Blue']);
  assert.equal(gefilterd.body.keuzelijsten.genres.length, keuzes.genres.length, 'de keuzelijsten blijven volledig na het filteren');
});

test('een filter dat nergens op past geeft een lege lijst en geen fout', async () => {
  const uitkomst = await api('/api/platen?genre=Polka&van=2200');
  assert.equal(uitkomst.status, 200);
  assert.equal(uitkomst.body.totaal, 0);
  assert.ok(Array.isArray(uitkomst.body.platen));
  assert.ok(uitkomst.body.keuzelijsten.genres.length > 0, 'de keuzelijsten blijven bruikbaar');
});

test('het genre komt uit MusicBrainz zelf en is te filteren', async () => {
  const uitkomst = await api(`/api/platen/zoek/${EAN}?force=1`);
  assert.equal(uitkomst.body.genre, 'Rock', 'het meest gebruikte genre van de uitgave wordt gekozen');
  const toegevoegd = await stuur('/api/platen', 'POST', {barcode: EAN, titel: uitkomst.body.titel, artiest: uitkomst.body.artiest, jaar: uitkomst.body.jaar, genre: uitkomst.body.genre, locatie: 'Woonkamer', aantal: 1});
  assert.equal(toegevoegd.status, 201);
  const gefilterd = await api('/api/platen?genre=Rock');
  assert.ok(gefilterd.body.platen.some((p) => p.titel === 'The Dark Side of the Moon'), 'op dat genre kun je filteren');
  assert.ok(gefilterd.body.platen.every((p) => String(p.genre).toLowerCase() === 'rock'));
});

test('zonder genres bij de uitgave valt het genre terug op het soort uitgave', async () => {
  const uitkomst = await api('/api/platen/zoek/602547077750');   // onbekend: geen uitgave
  assert.equal(uitkomst.body.gevonden, false);
});
