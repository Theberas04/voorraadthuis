// Tests voor het koppelvenster (adres, QR-code en de stappen per toestel) en voor de
// losse onderdelen die de Android-app gebruikt om de planning in de agenda van het
// toestel te zetten.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-koppelen-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.MEDIA_DIR = path.join(dir, 'fotos');
process.env.WEER_AUTO = '0';
process.env.PLATEN_HOES_AUTO = '0';
process.env.PLATEN_DISCOGS_DB = '0';
process.env.PLATEN_TABEL = '0';
const {server, db, RECIPES} = require('../server');
let base;
test.before(async () => { await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { await new Promise(r => server.close(r)); db.close(); fs.rmSync(dir, {recursive: true, force: true}); });
const call = (pad, method = 'GET', body) => fetch(base + pad, {method, headers: body ? {'content-type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});

test('de pagina laadt de QR-maker en heeft het koppelvenster', async () => {
  const html = await (await call('/')).text();
  assert.ok(html.includes('<script src="qr.js?v=1">'), 'de QR-maker hoort geladen te worden');
  assert.ok(html.includes('id="agendaKoppelOpen"'), 'er hoort een knop Agenda koppelen te zijn');
  assert.ok(html.includes('id="agendaKoppelDialog"'), 'en een venster');
  assert.ok(html.includes('id="agendaKoppelAdres"'), 'met het adres erin');
  assert.ok(html.includes('id="agendaKoppelKopieer"'), 'een knop om te kopiëren');
  assert.ok(html.includes('id="agendaKoppelQr"'), 'en een QR-code');
  assert.ok(html.includes('id="agendaKoppelMaand"'), 'en de keuze om alleen de zichtbare maand te koppelen');
  const qr = await call('/qr.js?v=1');
  assert.equal(qr.status, 200);
  assert.ok((await qr.text()).includes('maakQr'), 'qr.js hoort de functie maakQr te leveren');
});

test('het venster neemt het adres van de app zelf, met de maand erbij als je dat wilt', async () => {
  const html = await (await call('/')).text();
  assert.ok(html.includes("const adres=`${location.origin}/api/agenda.ics`"), 'het adres hoort van de pagina zelf te komen');
  assert.ok(html.includes('?maand=${maand}'), 'en met de zichtbare maand als je dat aanvinkt');
  assert.ok(html.includes('navigator.clipboard.writeText'), 'kopiëren hoort via het klembord te gaan');
  assert.ok(html.includes("document.execCommand('copy')"), 'met een terugvaloptie voor oudere browsers');
});

test('de stappen voor Samsung Agenda staan erbij, met de route die werkt', async () => {
  const html = await (await call('/')).text();
  assert.ok(html.includes('Samsung Agenda'), 'de Samsung-agenda hoort genoemd te worden');
  assert.ok(/Samsung-agenda heeft zelf meestal geen optie om een adres in te vullen/.test(html), 'en dat die zelf geen adres kan invullen');
  assert.ok(html.includes('ICSx⁵'), 'met ICSx⁵ als een van de routes');
  assert.ok(html.includes('Agenda&#39;s beheren') || html.includes("Agenda's beheren"), 'en waar je hem in Samsung Agenda aanzet');
  assert.ok(html.includes('Via URL'), 'de Google-route hoort er ook te staan');
  assert.ok(html.includes('iPhone') && html.includes('Outlook'), 'en de andere toestellen');
});

test('dezelfde planning komt als losse onderdelen naar buiten, met dezelfde kenmerken als het .ics-bestand', async () => {
  const recept = RECIPES.find(r => r.cuisine === 'Nederland') || RECIPES[0];
  await call('/api/planner/2026-10-27', 'PUT', {
    recipeId: recept.id, cuisine: recept.cuisine, porties: 4,
    shifts: [{name: 'Nachtdienst', startTime: '22:30', endTime: '06:15', notes: 'Sleutel mee', color: 'paars'}],
  });
  const antwoord = await call('/api/agenda.json?maand=2026-10');
  assert.equal(antwoord.status, 200);
  const gegevens = await antwoord.json();
  assert.ok(gegevens.versie >= 1, 'de versie gaat mee, zodat de app weet of er iets veranderd is');
  const maaltijd = gegevens.items.find(i => i.soort === 'maaltijd');
  const dienst = gegevens.items.find(i => i.soort === 'dienst');
  assert.equal(maaltijd.titel, `Avondeten: ${recept.name}`);
  assert.equal(maaltijd.datum, '2026-10-27');
  assert.equal(maaltijd.heleDag, true);
  assert.ok(maaltijd.omschrijving.includes('Porties: 4'));
  assert.equal(dienst.titel, 'Dienst: Nachtdienst');
  assert.equal(dienst.heleDag, false);
  assert.equal(dienst.start, '22:30');
  assert.equal(dienst.eind, '06:15');
  assert.equal(dienst.eindDatumTijd, '20261028T061500', 'een nachtdienst eindigt de volgende dag');
  assert.equal(dienst.kleur, 'paars');

  const ics = await (await call('/api/agenda.ics?maand=2026-10')).text();
  for (const onderdeel of gegevens.items) {
    assert.ok(ics.includes(`UID:${onderdeel.uid}`), `het agenda-bestand hoort dezelfde sleutel te gebruiken: ${onderdeel.uid}`);
  }
  assert.equal((await call('/api/agenda.json?maand=2026-13')).status, 400);
});

test('de service worker kent de nieuwe bestanden en een nieuwe cachenaam', async () => {
  const sw = await (await call('/sw.js')).text();
  assert.ok(sw.includes("'voorraadthuis-v16'"), 'de cachenaam hoort opgehoogd te zijn');
  assert.ok(sw.includes("'/qr.js?v=1'"), 'en qr.js hoort in de lijst te staan');
  const html = await (await call('/')).text();
  assert.ok(!html.includes('platen.js?v=4'), 'oude versienummers horen niet meer in de pagina te staan');
});
