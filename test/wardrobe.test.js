// Tests voor het garderobe-onderdeel van VoorraadThuis (Kledingkast).
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voorraadthuis-kast-'));
process.env.DB_PATH = path.join(dir, 'test.db');
process.env.MEDIA_DIR = path.join(dir, 'fotos');
const {server, db} = require('../server');
// De garderobe is een onderdeel van VoorraadThuis: dezelfde service en database.
let base;
test.before(async () => { await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => { await new Promise(r => server.close(r)); db.close(); fs.rmSync(dir, {recursive:true, force:true}); });
const call = (url, method = 'GET', data) => fetch(base + url, {method, headers:{'content-type':'application/json'}, ...(data ? {body:JSON.stringify(data)} : {})});
const addItem = async fields => (await call('/api/kast/items', 'POST', fields)).json();
// Proeffoto: een geldige 1x1-PNG, opgevuld tot de grootte van een echte upload.
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63600000020001'
  + '05000a0d0a2db40000000049454e44ae426082', 'hex'), Buffer.alloc(240, 0)]);

test('een kledingstuk opslaan, aanpassen en terugvinden', async () => {
  const created = await addItem({name:'Blauw overhemd', category:'bovenkleding', color:'blauw', colorHex:'#2b4c8c', size:'L', brand:'Weird Fish', material:'katoen', seasons:['lente','zomer'], occasions:['werk'], price:59.95, notes:'Kreukvrij'});
  assert.equal(created.id >= 1, true);
  assert.equal(created.status, 'schoon');
  assert.deepEqual(created.seasons, ['lente', 'zomer']);
  assert.deepEqual(created.occasions, ['werk']);
  assert.equal(created.price, 59.95);
  const updated = await (await call(`/api/kast/items/${created.id}`, 'PATCH', {status:'vies', size:'XL'})).json();
  assert.equal(updated.status, 'vies');
  assert.equal(updated.size, 'XL');
  const found = await (await call('/api/kast/items?q=kreukvrij')).json();
  assert.equal(found.length, 1);
  assert.equal(found[0].id, created.id);
  const filtered = await (await call('/api/kast/items?status=vies&category=bovenkleding')).json();
  assert.equal(filtered.length, 1);
});

test('ongeldige invoer wordt geweigerd', async () => {
  assert.equal((await call('/api/kast/items', 'POST', {name:'', category:'broek'})).status, 400);
  assert.equal((await call('/api/kast/items', 'POST', {name:'Iets', category:'hoed'})).status, 400);
  const item = await addItem({name:'Spijkerbroek', category:'broek'});
  assert.equal((await call(`/api/kast/items/${item.id}`, 'PATCH', {colorHex:'blauw'})).status, 400);
  assert.equal((await call(`/api/kast/items/${item.id}`, 'PATCH', {status:'kwijt'})).status, 400);
  assert.equal((await call(`/api/kast/items/${item.id}`, 'PATCH', {price:-3})).status, 400);
  assert.equal((await call('/api/kast/items/999999', 'PATCH', {name:'x'})).status, 400);
});

test('een foto uploaden, koppelen en serveren', async () => {
  const upload = await fetch(base + '/api/kast/photos', {method:'POST', headers:{'content-type':'image/png'}, body:png});
  assert.equal(upload.status, 201);
  const {photo} = await upload.json();
  assert.match(photo, /^[0-9a-f-]{36}\.png$/);
  const wrong = await fetch(base + '/api/kast/photos', {method:'POST', headers:{'content-type':'text/plain'}, body:'geen foto'});
  assert.equal(wrong.status, 400);
  const item = await addItem({name:'Zomerjurk', category:'jurk', photo});
  assert.equal(item.photo, photo);
  const served = await fetch(`${base}/media/${photo}`);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.equal((await served.arrayBuffer()).byteLength, png.length);
  assert.equal((await fetch(base + '/media/../server.js')).status, 404);
  assert.equal((await call(`/api/kast/items/${item.id}`, 'PATCH', {photo:'onbekend.png'})).status, 400);
});

test('dragen wordt gelogd en zet het kledingstuk op vies', async () => {
  const item = await addItem({name:'Wollen trui', category:'trui', seasons:['herfst','winter'], occasions:['werk']});
  const wear = await (await call('/api/kast/wear', 'POST', {date:'2026-10-20', itemIds:[item.id], rating:4, notes:'Kantoor'})).json();
  assert.equal(wear.date, '2026-10-20');
  assert.equal(wear.rating, 4);
  assert.deepEqual(wear.itemIds, [item.id]);
  assert.equal((await (await call(`/api/kast/items/${item.id}`)).json()).status, 'vies');
  const month = await (await call('/api/kast/wear?month=2026-10')).json();
  assert.equal(month.length, 1);
  assert.equal(month[0].items[0].name, 'Wollen trui');
  assert.equal((await call('/api/kast/wear', 'POST', {date:'2026-10-20', itemIds:[]})).status, 400);
  assert.equal((await call('/api/kast/wear', 'POST', {date:'2026-10-20', itemIds:[item.id], rating:9})).status, 400);
  assert.equal((await call('/api/kast/wear?month=oktober')).status, 400);
  assert.equal((await call(`/api/kast/wear/${wear.id}`, 'DELETE')).status, 200);
  assert.equal((await (await call('/api/kast/wear?month=2026-10')).json()).length, 0);
});

test('een wasbeurt zet kleding op in de was en daarna weer schoon', async () => {
  const a = await addItem({name:'Katoenen shirt', category:'bovenkleding'});
  const b = await addItem({name:'Sportbroek', category:'sport'});
  const wash = await (await call('/api/kast/washes', 'POST', {itemIds:[a.id, b.id], program:'30 graden', plannedFor:'2026-10-21'})).json();
  assert.equal(wash.itemIds.length, 2);
  assert.equal(wash.done, false);
  assert.equal((await (await call(`/api/kast/items/${a.id}`)).json()).status, 'in de was');
  const done = await (await call(`/api/kast/washes/${wash.id}`, 'PATCH', {})).json();
  assert.equal(done.done, true);
  assert.equal((await (await call(`/api/kast/items/${a.id}`)).json()).status, 'schoon');
  assert.equal((await (await call(`/api/kast/items/${b.id}`)).json()).status, 'schoon');
  assert.equal((await call('/api/kast/washes', 'POST', {itemIds:[]})).status, 400);
});

test('een geannuleerde was zet kleding terug op vies in plaats van in de was', async () => {
  const item = await addItem({name:'Linnen blouse', category:'bovenkleding'});
  const wash = await (await call('/api/kast/washes', 'POST', {itemIds:[item.id], program:'fijn'})).json();
  assert.equal((await call(`/api/kast/washes/${wash.id}`, 'DELETE')).status, 200);
  assert.equal((await (await call(`/api/kast/items/${item.id}`)).json()).status, 'vies');
  assert.ok(!(await (await call('/api/kast/washes')).json()).some(entry => entry.id === wash.id));
});

test('combinaties opslaan, ophalen en verwijderen', async () => {
  const top = await addItem({name:'Wit t-shirt', category:'bovenkleding', color:'wit', seasons:['zomer']});
  const bottom = await addItem({name:'Jeans', category:'broek', color:'denim', seasons:['zomer']});
  const outfit = await (await call('/api/kast/outfits', 'POST', {name:'Zondagse outfit', occasion:'casual', itemIds:[top.id, bottom.id, 999999]})).json();
  assert.equal(outfit.itemIds.length, 2);
  assert.equal(outfit.items.length, 2);
  assert.equal((await call('/api/kast/outfits', 'POST', {name:'', itemIds:[top.id]})).status, 400);
  assert.equal((await call('/api/kast/outfits', 'POST', {name:'Leeg', itemIds:[]})).status, 400);
  assert.equal((await (await call('/api/kast/outfits')).json()).length, 1);
  assert.equal((await call(`/api/kast/outfits/${outfit.id}`, 'DELETE')).status, 200);
  assert.equal((await (await call('/api/kast/outfits')).json()).length, 0);
});

test('combineeradvies gebruikt alleen schone kleding van het juiste seizoen', async () => {
  const zomer = await addItem({name:'Zomeroverhemd', category:'bovenkleding', color:'wit', seasons:['zomer'], occasions:['werk']});
  const winter = await addItem({name:'Wintertrui', category:'trui', color:'grijs', seasons:['winter'], occasions:['werk']});
  const broek = await addItem({name:'Nette broek', category:'broek', color:'zwart', seasons:['lente','zomer','herfst','winter'], occasions:['werk']});
  const schoenen = await addItem({name:'Leren schoenen', category:'schoenen', color:'bruin', occasions:['werk']});
  const dirty = await addItem({name:'Vies overhemd', category:'bovenkleding', color:'blauw', occasions:['werk']});
  await call(`/api/kast/items/${dirty.id}`, 'PATCH', {status:'vies'});
  const advice = await (await call('/api/kast/suggest?occasion=werk&date=2026-07-15')).json();
  const names = advice.items.map(i => i.name);
  assert.equal(advice.season, 'zomer');
  assert.ok(names.includes('Zomeroverhemd'));
  assert.ok(names.includes('Nette broek'));
  assert.ok(!names.includes('Wintertrui'));
  assert.ok(!names.includes('Vies overhemd'));
  assert.ok(advice.reasons.some(r => r.startsWith('Seizoen:')));
  assert.ok(advice.score > 0);
  const winterAdvice = await (await call('/api/kast/suggest?occasion=werk&date=2026-01-15')).json();
  assert.equal(winterAdvice.season, 'winter');
  assert.ok(winterAdvice.items.map(i => i.name).includes('Wintertrui'));
  assert.equal((await call('/api/kast/suggest?occasion=zwemmen')).status, 400);
  assert.equal((await (await call('/api/kast/suggest?occasion=casual')).json()).date >= '2026-01-01', true);
});

test('zonder schone kleding geeft het advies uitleg in plaats van een leeg antwoord', async () => {
  for (const item of await (await call('/api/kast/items')).json()) await call(`/api/kast/items/${item.id}`, 'PATCH', {status:'vies'});
  const advice = await (await call('/api/kast/suggest?occasion=feest&date=2026-06-01')).json();
  assert.equal(advice.items.length, 0);
  assert.ok(advice.reasons[0].includes('schone'));
});

test('analyse telt categorieën, kleuren, prijs en draagkosten', async () => {
  const stats = await (await call('/api/kast/analytics')).json();
  assert.ok(stats.total > 5);
  assert.equal(stats.perCategory.broek >= 1, true);
  assert.equal(stats.laundry >= 1, true);
  assert.equal(typeof stats.price, 'number');
  assert.ok(stats.costPerWear.every(entry => entry.costPerWear > 0));
  assert.ok(Array.isArray(stats.neverWorn));
});

test('AI-tagging geeft een duidelijke melding zolang er geen AI-dienst is ingesteld', async () => {
  const item = await addItem({name:'Onbekend kledingstuk', category:'overig'});
  const response = await call(`/api/kast/items/${item.id}`, 'PATCH', {action:'analyze'});
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /AI-tagging is niet ingesteld/);
  const config = await (await call('/api/kast/config')).json();
  assert.equal(config.ai.enabled, false);
  assert.ok(config.categories.includes('schoenen'));
  assert.ok(config.occasions.includes('werk'));
});

// De webapp-bestanden, /health en de onbekende routes worden in app.test.js getest.
