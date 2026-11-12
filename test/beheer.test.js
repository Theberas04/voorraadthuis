// Tests voor het beheergedeelte: wachtwoord instellen en inloggen, de sessie, het
// versienummer, de bijwerk-aanvraag en de pagina zelf.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {hashWachtwoord, kloptWachtwoord} = require('../beheer');

test('het wachtwoord wordt met scrypt bewaard en is niet terug te lezen', () => {
  const bewaard = hashWachtwoord('een-heel-lang-wachtwoord');
  assert.match(bewaard, /^scrypt\$16384\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.ok(!bewaard.includes('een-heel-lang-wachtwoord'), 'het wachtwoord staat er niet in');
  assert.equal(kloptWachtwoord('een-heel-lang-wachtwoord', bewaard), true);
  assert.equal(kloptWachtwoord('iets-anders', bewaard), false);
  assert.equal(kloptWachtwoord('', ''), false);
  const tweede = hashWachtwoord('een-heel-lang-wachtwoord');
  assert.notEqual(tweede, bewaard, 'twee keer hetzelfde wachtwoord geeft toch een andere uitkomst (zout)');
});

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beheer-'));
const dataMap = path.join(dir, 'data');
fs.mkdirSync(dataMap, {recursive: true});
fs.writeFileSync(path.join(dir, 'VERSIE'), 'aaaaaaaabbbbbbbbccccccccddddddddeeeeeeee\n2026-11-12T18:00:00Z\nPuzzels toegevoegd\n');
fs.writeFileSync(path.join(dataMap, 'update-log.txt'), '2026-11-12 18:00:01  Bijwerken gestart (gevraagd: main).\n2026-11-12 18:00:20  Klaar: versie aaaaaaa draait.\n');
// Een aangemelde host nabootsen: de padunit bestaat en de map is beschrijfbaar.
fs.writeFileSync(path.join(dir, 'voorraadthuis-update.path'), '[Path]\n');

process.env.DB_PATH = path.join(dir, 'test.db');
process.env.MEDIA_DIR = path.join(dir, 'fotos');
process.env.WEER_AUTO = '0';
process.env.PLATEN_HOES_AUTO = '0';
process.env.PLATEN_DISCOGS_DB = '0';
process.env.PLATEN_TABEL = '0';
process.env.PUZZEL_BRON = '0';
process.env.BEHEER_OFFLINE = '1';
process.env.BEHEER_DATA_DIR = dataMap;
process.env.VERSIE_PAD = path.join(dir, 'VERSIE');
process.env.UPDATE_LOG_PAD = path.join(dataMap, 'update-log.txt');
process.env.UPDATE_VRAAG_PAD = path.join(dataMap, 'update-aanvraag');
process.env.UPDATE_PATH_UNIT = path.join(dir, 'voorraadthuis-update.path');
const {server, db} = require('../server');
let base;
test.before(async () => { await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { await new Promise(r => server.close(r)); db.close(); fs.rmSync(dir, {recursive: true, force: true}); });

const kop = {'content-type': 'application/json', 'x-voorraadthuis': 'beheer'};
const call = (pad, opties = {}) => fetch(base + pad, opties);
const post = (pad, body, extra = {}) => call(pad, {method: 'POST', headers: {...kop, ...(extra.headers || {})}, body: JSON.stringify(body), ...extra});

test('zonder ingesteld wachtwoord vraagt de pagina om er een te kiezen', async () => {
  const status = await (await call('/api/beheer/status')).json();
  assert.equal(status.ingesteld, false);
  assert.equal(status.ingelogd, false);
  assert.equal(status.log.length, 0, 'de log komt pas als je bent ingelogd');
  assert.equal(status.kanBijwerken, true, 'de padunit is in deze proefopstelling aanwezig');
});

test('een te kort wachtwoord wordt geweigerd en een aanvraag van buiten de app ook', async () => {
  const vanBuiten = await call('/api/beheer/wachtwoord', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({wachtwoord: 'kort-genoeg-11'})});
  assert.equal(vanBuiten.status, 403, 'zonder de eigen kop wordt het geweigerd');
  const teKort = await post('/api/beheer/wachtwoord', {wachtwoord: 'kort'});
  assert.equal(teKort.status, 400);
  assert.match((await teKort.json()).error, /minstens 10/);
});

test('wachtwoord instellen logt meteen in en de status komt daarna met de versie', async () => {
  const ingesteld = await post('/api/beheer/wachtwoord', {wachtwoord: 'thuis-op-de-plas-2026'});
  assert.equal(ingesteld.status, 200);
  const koekje = ingesteld.headers.get('set-cookie') || '';
  assert.match(koekje, /vt_beheer=[0-9a-f]{64}/);
  assert.match(koekje, /HttpOnly/);
  assert.match(koekje, /SameSite=Strict/);

  const status = await (await call('/api/beheer/status', {headers: {cookie: koekje.split(';')[0]}})).json();
  assert.equal(status.ingelogd, true);
  assert.equal(status.huidig.sha, 'aaaaaaaabbbbbbbbccccccccddddddddeeeeeeee');
  assert.equal(status.huidig.onderwerp, 'Puzzels toegevoegd');
  assert.equal(status.beschikbaar.gelukt, false);
  assert.match(status.beschikbaar.reden, /staat uit/);
  assert.equal(status.nieuw, false);
  assert.ok(status.log.some(r => r.includes('Klaar: versie aaaaaaa draait')));
  assert.equal(status.kanBijwerken, true);
});

test('verkeerd wachtwoord geeft 401 en na acht pogingen een adempauze', async () => {
  const fout = await post('/api/beheer/inloggen', {wachtwoord: 'niet-het-goede-wachtwoord'});
  assert.equal(fout.status, 401);
  for (let i = 0; i < 7; i += 1) await post('/api/beheer/inloggen', {wachtwoord: 'weer-fout'});
  const teveel = await post('/api/beheer/inloggen', {wachtwoord: 'weer-fout'});
  assert.equal(teveel.status, 429);
  assert.match((await teveel.json()).error, /Te veel pogingen/);
  // en het juiste wachtwoord wordt tijdens de pauze ook niet aangenomen
  assert.equal((await post('/api/beheer/inloggen', {wachtwoord: 'thuis-op-de-plas-2026'})).status, 429);
});

test('inloggen met het goede wachtwoord geeft een sessie, uitloggen maakt die ongeldig', async () => {
  // De pogingenteller hoort bij het adres; even opnieuw beginnen door de rij weg te halen
  // (zoals een nieuwe bezoeker vanaf een ander adres).
  db.prepare('DELETE FROM beheer_pogingen').run();
  const goed = await post('/api/beheer/inloggen', {wachtwoord: 'thuis-op-de-plas-2026'});
  assert.equal(goed.status, 200);
  const koekje = (goed.headers.get('set-cookie') || '').split(';')[0];
  assert.equal((await (await call('/api/beheer/status', {headers: {cookie: koekje}})).json()).ingelogd, true);

  const uit = await call('/api/beheer/uitloggen', {method: 'POST', headers: {cookie: koekje, ...kop}});
  assert.equal(uit.status, 200);
  assert.equal((await (await call('/api/beheer/status', {headers: {cookie: koekje}})).json()).ingelogd, false);
});

test('de bijwerk-knop schrijft een aanvraag die het script van de dienst oppakt', async () => {
  db.prepare('DELETE FROM beheer_pogingen').run();
  const sessie = (await post('/api/beheer/inloggen', {wachtwoord: 'thuis-op-de-plas-2026'})).headers.get('set-cookie').split(';')[0];

  // Zonder sessie of zonder eigen kop: geweigerd.
  assert.equal((await post('/api/beheer/update', {sha: ''})).status, 401);
  assert.equal((await call('/api/beheer/update', {method: 'POST', headers: {'content-type': 'application/json', cookie: sessie}, body: '{}'})).status, 403);

  const gevraagd = await call('/api/beheer/update', {method: 'POST', headers: {...kop, cookie: sessie}, body: JSON.stringify({sha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'})});
  assert.equal(gevraagd.status, 200);
  const inhoud = fs.readFileSync(process.env.UPDATE_VRAAG_PAD, 'utf8').split('\n');
  assert.equal(inhoud[0], 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
  assert.ok(Number(inhoud[1]) > 0, 'de tijd van de aanvraag staat erbij');
  const status = await (await call('/api/beheer/status', {headers: {cookie: sessie}})).json();
  assert.equal(status.updateBezig, true, 'zolang de aanvraag er ligt, is de app aan het bijwerken');

  // En als de host niet is ingericht, zegt de app dat eerlijk in plaats van te doen alsof.
  fs.rmSync(process.env.UPDATE_PATH_UNIT);
  const nietIngericht = await call('/api/beheer/update', {method: 'POST', headers: {...kop, cookie: sessie}, body: '{}'});
  assert.equal(nietIngericht.status, 400);
  assert.match((await nietIngericht.json()).error, /nog niet ingericht/);
  const zonder = await (await call('/api/beheer/status', {headers: {cookie: sessie}})).json();
  assert.equal(zonder.kanBijwerken, false);
});

test('het wachtwoord wijzigen vraagt het huidige wachtwoord', async () => {
  db.prepare('DELETE FROM beheer_pogingen').run();
  const sessie = (await post('/api/beheer/inloggen', {wachtwoord: 'thuis-op-de-plas-2026'})).headers.get('set-cookie').split(';')[0];
  const fout = await call('/api/beheer/wachtwoord', {method: 'POST', headers: {...kop, cookie: sessie}, body: JSON.stringify({oudWachtwoord: 'verzonnen', wachtwoord: 'weer-een-lang-wachtwoord'})});
  assert.equal(fout.status, 401);
  const goed = await call('/api/beheer/wachtwoord', {method: 'POST', headers: {...kop, cookie: sessie}, body: JSON.stringify({oudWachtwoord: 'thuis-op-de-plas-2026', wachtwoord: 'weer-een-lang-wachtwoord'})});
  assert.equal(goed.status, 200);
  db.prepare('DELETE FROM beheer_pogingen').run();
  assert.equal((await post('/api/beheer/inloggen', {wachtwoord: 'thuis-op-de-plas-2026'})).status, 401, 'het oude wachtwoord werkt niet meer');
  assert.equal((await post('/api/beheer/inloggen', {wachtwoord: 'weer-een-lang-wachtwoord'})).status, 200);
});

test('de beheerpagina zit in de app en de dienst kent de nieuwe bestanden', async () => {
  const html = await (await call('/')).text();
  assert.ok(html.includes('<script src="beheer.js?v=1">'), 'de beheerpagina hoort geladen te worden');
  assert.ok(/<button data-page="beheer">/.test(html), 'met een eigen tab');
  for (const id of ['page-beheer', 'beheerInstellen', 'beheerInlogForm', 'beheerNieuwWachtwoord', 'beheerPaneel', 'beheerNu', 'beheerBeschikbaar', 'beheerControleer', 'beheerUpdate', 'beheerBezig', 'beheerSysteem', 'beheerLog', 'beheerWijzigForm', 'beheerUitloggen', 'beheerNotice']) {
    assert.ok(html.includes(`id="${id}"`), `het onderdeel ${id} hoort er te zijn`);
  }
  assert.ok(html.includes("name==='beheer'&&window.BeheerPagina"), 'de pagina hoort te laden als je de tab opent');
  assert.ok(html.includes('ADMIN_WACHTWOORD'), 'de noodroute voor een vergeten wachtwoord staat erbij');
  const script = await (await call('/beheer.js?v=1')).text();
  assert.ok(script.includes("'x-voorraadthuis': 'beheer'"), 'elke aanvraag gaat met de eigen kop');
  assert.ok(script.includes('/api/beheer/status'), 'en de pagina leest de status');
  const sw = await (await call('/sw.js')).text();
  assert.ok(sw.includes("'voorraadthuis-v18'"), 'de cachenaam is opgehoogd');
  assert.ok(sw.includes("'/beheer.js?v=1'"), 'en de beheerpagina staat in de voorraadlijst');
});
