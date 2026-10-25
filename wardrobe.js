// Kledingkast als onderdeel van VoorraadThuis: één service, één database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
// Het weer is een eigen onderdeel van de app; de garderobe gebruikt alleen de
// adviesregels eruit, zodat een advies ook zonder internet blijft werken.
const { advies:weerAdvies } = require('./weer');

/* Bouw het garderobe-onderdeel op de bestaande service. De database en de fotomap
   komen van buitenaf, zodat VoorraadThuis en Kledingkast echt één app zijn. */
function createWardrobe({ db, mediaDir, weer = null }) {
  const MEDIA_DIR = mediaDir;
  const AI = {
    base: (process.env.AI_BASE_URL || '').replace(/\/+$/, ''),
    key: process.env.AI_API_KEY || '',
    vision: process.env.AI_VISION_MODEL || '',
    text: process.env.AI_TEXT_MODEL || '',
  };
  fs.mkdirSync(MEDIA_DIR, { recursive: true });

  db.exec(`CREATE TABLE IF NOT EXISTS items(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '', color_hex TEXT NOT NULL DEFAULT '', pattern TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '', brand TEXT NOT NULL DEFAULT '', material TEXT NOT NULL DEFAULT '',
  seasons TEXT NOT NULL DEFAULT '', occasions TEXT NOT NULL DEFAULT '', price REAL,
  photo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'schoon', notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS outfits(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, occasion TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS outfit_items(
  outfit_id INTEGER NOT NULL, item_id INTEGER NOT NULL, PRIMARY KEY(outfit_id,item_id));
CREATE TABLE IF NOT EXISTS wear_log(
  id INTEGER PRIMARY KEY, worn_on TEXT NOT NULL, outfit_id INTEGER, rating INTEGER,
  notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS wear_items(
  wear_id INTEGER NOT NULL, item_id INTEGER NOT NULL, PRIMARY KEY(wear_id,item_id));
CREATE TABLE IF NOT EXISTS washes(
  id INTEGER PRIMARY KEY, planned_for TEXT NOT NULL, program TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '', done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS wash_items(
  wash_id INTEGER NOT NULL, item_id INTEGER NOT NULL, PRIMARY KEY(wash_id,item_id));
CREATE TABLE IF NOT EXISTS wardrobes(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);

// Kasten: ieder kledingstuk hoort bij één kast (thuis, mama, vakantiehuis…).
// Bestaande databases krijgen de kolom erbij; alles komt in de eerste kast terecht.
const itemKolommen = db.prepare('PRAGMA table_info(items)').all().map(kolom => kolom.name);
if (!itemKolommen.includes('wardrobe_id')) db.exec('ALTER TABLE items ADD COLUMN wardrobe_id INTEGER NOT NULL DEFAULT 1');
if (!db.prepare('SELECT COUNT(*) AS n FROM wardrobes').get().n) db.prepare('INSERT INTO wardrobes(id,name) VALUES(1,?)').run(process.env.KAST_STANDAARD || 'Thuis');
db.exec('UPDATE items SET wardrobe_id=(SELECT MIN(id) FROM wardrobes) WHERE wardrobe_id IS NULL OR wardrobe_id NOT IN (SELECT id FROM wardrobes)');

const CATEGORIES = ['bovenkleding','trui','vest','jurk','broek','rok','jas','schoenen','accessoire','ondergoed','sport','overig'];
const STATUSES = ['schoon','vies','in de was','reparatie'];
const SEASONS = ['lente','zomer','herfst','winter'];
const OCCASIONS = ['werk','casual','feest','sport','buiten'];
const NEUTRALS = ['zwart','wit','grijs','beige','navy','bruin','denim','ecru','antraciet','crème','creme','camel','zand'];
const STATUS_ORDER = {'schoon':0,'vies':1,'in de was':2,'reparatie':3};

function json(res, status, data) { res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(JSON.stringify(data)); }
function body(req, limit = 8 * 1024 * 1024) { return new Promise((resolve, reject) => { const chunks = []; let size = 0; req.on('data', c => { size += c.length; if (size > limit) { reject(Error('Bestand is te groot (maximaal 8 MB).')); req.destroy(); return; } chunks.push(c); }); req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject); }); }
async function jsonBody(req) { const raw = await body(req, 200000); return JSON.parse(raw.toString('utf8') || '{}'); }
const list = (value, allowed) => [...new Set(String(value ?? '').split(',').map(x => x.trim().toLowerCase()).filter(x => allowed.includes(x)))];
const text = (value, max) => String(value ?? '').trim().slice(0, max);
function validDate(s) { if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false; const d = new Date(`${s}T00:00:00.000Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s; }
const validMonth = s => /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '');
const today = () => new Date().toISOString().slice(0, 10);
const seasonOf = date => { const m = new Date(`${date}T12:00:00`).getMonth(); return m <= 1 || m === 11 ? 'winter' : m <= 4 ? 'lente' : m <= 7 ? 'zomer' : 'herfst'; };

function kastNaam(id) { const rij = db.prepare('SELECT name FROM wardrobes WHERE id=?').get(Number(id)); return rij ? rij.name : ''; }
function rowToItem(row) { return { id:row.id, wardrobeId:Number(row.wardrobe_id || 0), wardrobeName:kastNaam(row.wardrobe_id), name:row.name, category:row.category, color:row.color, colorHex:row.color_hex, pattern:row.pattern, size:row.size, brand:row.brand, material:row.material, seasons:row.seasons ? row.seasons.split(',') : [], occasions:row.occasions ? row.occasions.split(',') : [], price:row.price, photo:row.photo, status:row.status, notes:row.notes, createdAt:row.created_at, updatedAt:row.updated_at }; }
const items = (where = '', params = []) => db.prepare(`SELECT * FROM items ${where} ORDER BY category, name COLLATE NOCASE`).all(...params).map(rowToItem);
const itemById = id => { const row = db.prepare('SELECT * FROM items WHERE id=?').get(Number(id)); return row ? rowToItem(row) : null; };
const itemsByIds = ids => ids.map(id => itemById(id)).filter(Boolean);
const wearCount = id => db.prepare('SELECT COUNT(*) AS n FROM wear_items WHERE item_id=?').get(Number(id)).n;
function wardrobes() {
  return db.prepare(`SELECT w.id, w.name, w.created_at, (SELECT COUNT(*) FROM items i WHERE i.wardrobe_id=w.id) AS stuks FROM wardrobes w ORDER BY w.id`).all()
    .map(rij => ({ id:rij.id, name:rij.name, items:rij.stuks, createdAt:rij.created_at }));
}
const kastById = id => wardrobes().find(kast => kast.id === Number(id)) || null;
const standaardKast = () => wardrobes()[0] || null;

function outfits() {
  return db.prepare('SELECT * FROM outfits ORDER BY name COLLATE NOCASE').all().map(row => {
    const ids = db.prepare('SELECT item_id FROM outfit_items WHERE outfit_id=?').all(row.id).map(x => x.item_id);
    return { id:row.id, name:row.name, occasion:row.occasion, notes:row.notes, itemIds:ids, items:itemsByIds(ids) };
  });
}
function washes() {
  return db.prepare('SELECT * FROM washes ORDER BY done, planned_for DESC, id DESC').all().map(row => {
    const ids = db.prepare('SELECT item_id FROM wash_items WHERE wash_id=?').all(row.id).map(x => x.item_id);
    return { id:row.id, plannedFor:row.planned_for, program:row.program, notes:row.notes, done:!!row.done, itemIds:ids, items:itemsByIds(ids) };
  });
}
function wearEntry(id) {
  const row = db.prepare('SELECT * FROM wear_log WHERE id=?').get(Number(id));
  return row ? wearLog().filter(entry => entry.id === row.id)[0] : null;
}
function wearLog(month) {
  const rows = month ? db.prepare('SELECT * FROM wear_log WHERE worn_on LIKE ? ORDER BY worn_on DESC, id DESC').all(`${month}-%`) : db.prepare('SELECT * FROM wear_log ORDER BY worn_on DESC, id DESC LIMIT 200').all();
  return rows.map(row => {
    const ids = db.prepare('SELECT item_id FROM wear_items WHERE wear_id=?').all(row.id).map(x => x.item_id);
    const outfit = row.outfit_id ? db.prepare('SELECT name FROM outfits WHERE id=?').get(row.outfit_id) : null;
    return { id:row.id, date:row.worn_on, rating:row.rating, notes:row.notes, outfitId:row.outfit_id, outfitName:outfit ? outfit.name : '', itemIds:ids, items:itemsByIds(ids) };
  });
}

function setItemFields(id, input) {
  const current = itemById(id);
  if (!current) throw Error('Kledingstuk niet gevonden.');
  const name = input.name === undefined ? current.name : text(input.name, 80);
  if (!name) throw Error('Vul een naam in voor het kledingstuk.');
  const category = input.category === undefined ? current.category : text(input.category, 24).toLowerCase();
  if (!CATEGORIES.includes(category)) throw Error('Onbekende categorie.');
  const status = input.status === undefined ? current.status : text(input.status, 16).toLowerCase();
  if (!STATUSES.includes(status)) throw Error('Onbekende status.');
  const colorHex = input.colorHex === undefined ? current.colorHex : text(input.colorHex, 9);
  if (colorHex && !/^#[0-9a-fA-F]{6}$/.test(colorHex)) throw Error('Kleurcode moet eruitzien als #1a2b3c.');
  const price = input.price === undefined || input.price === '' || input.price === null ? current.price : Number(input.price);
  if (price !== null && (!Number.isFinite(price) || price < 0 || price > 100000)) throw Error('Vul een geldige prijs in.');
  const wardrobeId = input.wardrobeId === undefined || input.wardrobeId === '' ? current.wardrobeId : Number(input.wardrobeId);
  if (!kastById(wardrobeId)) throw Error('Onbekende kast.');
  const photo = input.photo === undefined ? current.photo : text(Array.isArray(input.photo) ? input.photo[0] : input.photo, 120);
  if (photo && !fs.existsSync(path.join(MEDIA_DIR, path.basename(photo)))) throw Error('Foto niet gevonden.');
  db.prepare(`UPDATE items SET name=?, category=?, color=?, color_hex=?, pattern=?, size=?, brand=?, material=?, seasons=?, occasions=?, price=?, photo=?, status=?, notes=?, wardrobe_id=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(name, category,
      input.color === undefined ? current.color : text(input.color, 40),
      colorHex,
      input.pattern === undefined ? current.pattern : text(input.pattern, 40),
      input.size === undefined ? current.size : text(input.size, 20),
      input.brand === undefined ? current.brand : text(input.brand, 40),
      input.material === undefined ? current.material : text(input.material, 60),
      input.seasons === undefined ? current.seasons.join(',') : list(input.seasons, SEASONS).join(','),
      input.occasions === undefined ? current.occasions.join(',') : list(input.occasions, OCCASIONS).join(','),
      price, photo, status,
      input.notes === undefined ? current.notes : text(input.notes, 400),
      wardrobeId,
      Number(id));
  return itemById(id);
}

function hexToHsl(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex || '')) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return {h:0, s:0, l};
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return {h:Math.round(h * 60), s, l};
}
function isNeutral(item) {
  const name = item.color.toLowerCase();
  if (!name) return true;
  if (NEUTRALS.some(x => name.includes(x))) return true;
  const hsl = hexToHsl(item.colorHex);
  return hsl ? (hsl.s < 0.22 || hsl.l < 0.14 || hsl.l > 0.9) : false;
}

// Eigen, uitlegbare regels in plaats van een taalmodel: per gelegenheid welke categorieën nodig zijn.
const OUTFIT_RULES = {
  werk:     {basis:['overhemd','blouse','bovenkleding','trui','jurk'], onder:['broek','rok'], jas:true,  accessoire:true,  net:true},
  casual:   {basis:['bovenkleding','trui','vest','overhemd','jurk'], onder:['broek','rok'], jas:true,  accessoire:true,  net:false},
  feest:    {basis:['overhemd','blouse','jurk','bovenkleding'],      onder:['broek','rok'], jas:true,  accessoire:true,  net:true},
  sport:    {basis:['sport','bovenkleding'],                         onder:['broek','sport'], jas:false, accessoire:false, net:false},
  buiten:   {basis:['trui','vest','overhemd','bovenkleding'],        onder:['broek'],       jas:true,  accessoire:true,  net:false},
};
const NETTE_WOORDEN = ['overhemd','blouse','colbert','pak','nette','mantel','jurk','blazer'];

function scoreItem(item, {occasion, season, recent, rule}) {
  let score = 0; const reasons = [];
  if (item.occasions.length && !item.occasions.includes(occasion)) { score -= 4; reasons.push(`${item.name} staat niet op ${occasion}`); }
  else if (item.occasions.includes(occasion)) { score += 3; reasons.push(`${item.name} past bij ${occasion}`); }
  if (item.seasons.length && !item.seasons.includes(season)) { score -= 5; reasons.push(`${item.name} is geen ${season}kleding`); }
  else if (item.seasons.includes(season)) { score += 2; reasons.push(`${item.name} is geschikt voor de ${season}`); }
  if (rule.net && NETTE_WOORDEN.some(w => `${item.name} ${item.notes} ${item.pattern}`.toLowerCase().includes(w))) score += 2;
  if (recent.includes(item.id)) { score -= 6; reasons.push(`${item.name} droeg je kort geleden al`); }
  const wears = wearCount(item.id);
  if (wears === 0) { score += 2; reasons.push(`${item.name} is nog nooit gedragen`); }
  else score += Math.max(0, 1.5 - wears * 0.05);
  return {score, reasons};
}
function harmony(bundle) {
  const accents = bundle.filter(x => !isNeutral(x));
  if (accents.length === 0) return {score:3, reason:'Alles in rustige basiskleuren'};
  if (accents.length === 1) return {score:3, reason:`Eén accentkleur: ${accents[0].color || accents[0].name}`};
  const hues = accents.map(x => hexToHsl(x.colorHex)).filter(Boolean).map(x => x.h);
  if (hues.length !== accents.length) return {score:1, reason:`Meerdere kleuraccenten: ${accents.map(x => x.color || x.name).join(' + ')}`};
  const spread = Math.max(...hues) - Math.min(...hues);
  if (spread <= 40 || spread >= 320) return {score:2, reason:`Twee verwante kleuren: ${accents.map(x => x.color || x.name).join(' + ')}`};
  return {score:0.5, reason:`Felle kleuren bij elkaar: ${accents.map(x => x.color || x.name).join(' + ')}`};
}

function suggest({occasion, date, seed = 0, weer = null}) {
  if (!OCCASIONS.includes(occasion)) throw Error('Kies een gelegenheid: werk, casual, feest, sport of buiten.');
  const rule = OUTFIT_RULES[occasion];
  const season = seasonOf(date);
  // Wat het weer betekent voor deze dag: regen, kou of warmte.
  const w = weerAdvies(weer);
  const since = new Date(`${date}T12:00:00`); since.setDate(since.getDate() - 3);
  const recent = db.prepare('SELECT item_id FROM wear_items WHERE wear_id IN (SELECT id FROM wear_log WHERE worn_on >= ?)').all(since.toISOString().slice(0, 10)).map(x => x.item_id);
  const clean = items("WHERE status='schoon'");
  const pick = (categorieen, maximaal) => clean
    .filter(item => categorieen.includes(item.category))
    .map(item => ({item, ...scoreItem(item, {occasion, season, recent, rule})}))
    .filter(x => x.score > -3)
    .sort((a, b) => b.score - a.score || a.item.id - b.item.id)
    .slice(0, maximaal);
  const basis = pick(rule.basis, 8);
  const jurk = clean.filter(item => item.category === 'jurk').map(item => ({item, ...scoreItem(item, {occasion, season, recent, rule})})).sort((a, b) => b.score - a.score)[0];
  const onder = pick(rule.onder, 6);
  let schoenenLijst = pick(['schoenen'], 4);
  // Bij regen blijven leren en suède schoenen in de kast, als er iets anders is.
  if (w.schoenenWaterdicht) {
    const droog = schoenenLijst.filter(x => !/leer|suède|suede|lak/i.test(`${x.item.material} ${x.item.name}`));
    if (droog.length) schoenenLijst = droog;
  }
  let jasLijst = rule.jas ? pick(['jas'], 3) : [];
  if (w.warm) jasLijst = [];
  else if ((w.koud || w.fris) && !jasLijst.length) jasLijst = pick(['jas'], 1);
  const accessoire = rule.accessoire ? pick(['accessoire'], 4) : [];
  const bundles = [];
  for (const top of basis) {
    if (onder.length) for (const bottom of onder) bundles.push([top, bottom]);
  }
  if (jurk && !onder.length) bundles.push([jurk]);
  if (jurk) bundles.push([jurk]);
  if (!bundles.length) return {occasion, season, date, items:[], weer:weer || null, reasons:[...w.redenen, 'Je hebt nog geen schone bovenkleding en broek of rok. Vul je kast aan of was een wasje.'], score:0};
  const scored = bundles.map(bundle => {
    let combo = bundle.map(x => [x, scoreItem(x.item, {occasion, season, recent, rule})]).map(([x, s]) => ({...x, ...s}));
    let total = combo.reduce((n, x) => n + x.score, 0);
    const shoe = schoenenLijst[0] ? {...schoenenLijst[0]} : null;
    if (shoe) { total += shoe.score * 0.6; combo = [...combo, shoe]; }
    if (jasLijst.length) { total += jasLijst[0].score * 0.4; combo = [...combo, {...jasLijst[0]}]; }
    if (accessoire.length) { total += accessoire[0].score * 0.3; combo = [...combo, {...accessoire[0]}]; }
    const h = harmony(combo.map(x => x.item));
    total += h.score;
    return {combo, total, harmonyReason:h.reason};
  }).sort((a, b) => b.total - a.total || a.combo[0].item.id - b.combo[0].item.id);
  const chosen = scored[Math.abs(seed) % Math.min(scored.length, 3)];
  const reasons = [...w.redenen, `Seizoen: ${season}`, chosen.harmonyReason];
  for (const entry of chosen.combo) for (const reason of entry.reasons) if (!reasons.includes(reason)) reasons.push(reason);
  return {occasion, season, date, score:Number(chosen.total.toFixed(1)), items:chosen.combo.map(x => x.item), reasons:reasons.slice(0, 12), weer:weer || null};
}

function analytics() {
  const all = items();
  const perCategory = {}, perColor = {}, perStatus = {};
  let price = 0;
  for (const item of all) {
    perCategory[item.category] = (perCategory[item.category] || 0) + 1;
    perStatus[item.status] = (perStatus[item.status] || 0) + 1;
    if (item.color) perColor[item.color] = (perColor[item.color] || 0) + 1;
    if (item.price) price += item.price;
  }
  const wears = all.map(item => ({item, wears:wearCount(item.id)}));
  const worn = wears.filter(x => x.wears > 0).sort((a, b) => b.wears - a.wears);
  const never = wears.filter(x => x.wears === 0).map(x => x.item);
  return {
    total:all.length, pieces:all.length, price:Number(price.toFixed(2)),
    perCategory, perColor, perStatus,
    mostWorn:worn.slice(0, 5).map(x => ({item:x.item, wears:x.wears})),
    neverWorn:never.slice(0, 12), neverWornCount:never.length,
    costPerWear:all.map(item => item.price ? {item, costPerWear:Number((item.price / Math.max(1, wearCount(item.id))).toFixed(2))} : null).filter(Boolean).sort((a, b) => b.costPerWear - a.costPerWear).slice(0, 5),
    laundry:all.filter(item => item.status === 'vies' || item.status === 'in de was').length,
    repairs:all.filter(item => item.status === 'reparatie').length,
  };
}

async function analyzeItem(id) {
  const item = itemById(id);
  if (!item) throw Error('Kledingstuk niet gevonden.');
  if (!AI.base || !AI.vision) throw Error('AI-tagging is niet ingesteld. Zet AI_BASE_URL en AI_VISION_MODEL in de service-instellingen om foto’s automatisch te laten benoemen.');
  if (!item.photo) throw Error('Dit kledingstuk heeft nog geen foto om te analyseren.');
  const file = path.join(MEDIA_DIR, path.basename(item.photo));
  if (!fs.existsSync(file)) throw Error('De foto van dit kledingstuk is niet gevonden.');
  const mime = file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  const dataUrl = `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  const prompt = `Je krijgt een foto van één kledingstuk. Antwoord met alleen JSON: {"naam":"korte Nederlandse naam","categorie":"één van ${CATEGORIES.join('|')}","kleur":"Nederlandse kleurnaam","kleurcode":"#rrggbb","patroon":"effen|strepen|ruit|bloemen|print|anders","materiaal":"katoen|wol|leer|denim|polyester|anders","seizoenen":["lente","zomer","herfst","winter"]}`;
  const response = await fetch(`${AI.base}/chat/completions`, {
    method:'POST',
    headers:{'content-type':'application/json', ...(AI.key ? {authorization:`Bearer ${AI.key}`} : {})},
    body:JSON.stringify({model:AI.vision, temperature:0, messages:[{role:'user', content:[{type:'text', text:prompt},{type:'image_url', image_url:{url:dataUrl}}]}]}),
  });
  if (!response.ok) throw Error(`AI-service antwoordde met status ${response.status}.`);
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content || '';
  const match = String(content).match(/\{[\s\S]*\}/);
  if (!match) throw Error('AI-service gaf geen leesbaar antwoord terug.');
  let guess;
  try { guess = JSON.parse(match[0]); } catch { throw Error('AI-service gaf geen leesbaar antwoord terug.'); }
  const update = {};
  if (guess.naam) update.name = text(guess.naam, 80);
  if (CATEGORIES.includes(String(guess.categorie || '').toLowerCase())) update.category = String(guess.categorie).toLowerCase();
  if (guess.kleur) update.color = text(guess.kleur, 40);
  if (/^#[0-9a-fA-F]{6}$/.test(guess.kleurcode || '')) update.colorHex = guess.kleurcode;
  if (guess.patroon) update.pattern = text(guess.patroon, 40);
  if (guess.materiaal) update.material = text(guess.materiaal, 60);
  if (Array.isArray(guess.seizoenen)) update.seasons = list(guess.seizoenen.join(','), SEASONS).join(',');
  return {item:setItemFields(id, update), guess};
}

function serveFile(res, file, type) {
  const stat = fs.statSync(file);
  res.writeHead(200, {'content-type':type, 'content-length':stat.size, 'cache-control':'public, max-age=86400'});
  fs.createReadStream(file).pipe(res);
}
const MIME = {'.html':'text/html; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.webmanifest':'application/manifest+json','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.ico':'image/x-icon','.webm':'video/webm'};

  async function handle(req, res, url) {
      try {
      if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, {ai:{enabled:Boolean(AI.base && AI.vision), visionModel:AI.base ? AI.vision : '', textModel:AI.base ? AI.text : ''}, categories:CATEGORIES, statuses:STATUSES, seasons:SEASONS, occasions:OCCASIONS, wardrobes:wardrobes(), today:today(), weer:weer ? {...weer.instellingen(), vandaag:await weer.voorDatum(today())} : null});

      if (url.pathname === '/api/items' && req.method === 'GET') {
        const category = text(url.searchParams.get('category'), 24).toLowerCase();
        const status = text(url.searchParams.get('status'), 16).toLowerCase();
        const query = text(url.searchParams.get('q'), 60).toLowerCase();
        const kast = text(url.searchParams.get('wardrobe'), 12);
        const where = [], params = [];
        if (kast && kast !== 'alle') { if (!kastById(kast)) return json(res, 400, {error:'Onbekende kast.'}); where.push('wardrobe_id=?'); params.push(Number(kast)); }
        if (category) { where.push('category=?'); params.push(category); }
        if (status) { where.push('status=?'); params.push(status); }
        let rows = items(where.length ? `WHERE ${where.join(' AND ')}` : '', params);
        if (query) rows = rows.filter(item => [item.name, item.brand, item.color, item.material, item.notes].join(' ').toLowerCase().includes(query));
        return json(res, 200, rows);
      }
      if (url.pathname === '/api/items' && req.method === 'POST') {
        const input = await jsonBody(req);
        const name = text(input.name, 80);
        if (!name) return json(res, 400, {error:'Vul een naam in voor het kledingstuk.'});
        const category = text(input.category, 24).toLowerCase();
        if (!CATEGORIES.includes(category)) return json(res, 400, {error:'Kies een geldige categorie.'});
        const kast = input.wardrobeId === undefined || input.wardrobeId === '' ? standaardKast() : kastById(input.wardrobeId);
        if (!kast) return json(res, 400, {error:'Onbekende kast.'});
        const result = db.prepare('INSERT INTO items(name,category,wardrobe_id) VALUES(?,?,?)').run(name, category, kast.id);
        return json(res, 201, setItemFields(Number(result.lastInsertRowid), input));
      }
      let m = url.pathname.match(/^\/api\/items\/(\d+)$/);
      if (m && req.method === 'GET') {
        const item = itemById(m[1]);
        if (!item) return json(res, 404, {error:'Kledingstuk niet gevonden.'});
        return json(res, 200, {...item, wears:wearCount(item.id), washes:db.prepare('SELECT COUNT(*) AS n FROM wash_items WHERE item_id=?').get(Number(m[1])).n});
      }
      if (m && req.method === 'PATCH') {
        const input = await jsonBody(req);
        if (input.action === 'analyze') return json(res, 200, await analyzeItem(m[1]));
        if (input.action && ['schoon','vies','in de was','reparatie'].includes(input.action)) input.status = input.action;
        if (input.action === 'wear') {
          const date = validDate(input.date) ? input.date : today();
          const result = db.prepare('INSERT INTO wear_log(worn_on,notes) VALUES(?,?)').run(date, text(input.notes, 200));
          db.prepare('INSERT INTO wear_items(wear_id,item_id) VALUES(?,?)').run(Number(result.lastInsertRowid), Number(m[1]));
          return json(res, 200, {item:setItemFields(m[1], {status:'vies'}), wear:{date}});
        }
        return json(res, 200, setItemFields(m[1], input));
      }
      if (m && req.method === 'DELETE') {
        db.prepare('DELETE FROM outfit_items WHERE item_id=?').run(Number(m[1]));
        db.prepare('DELETE FROM wear_items WHERE item_id=?').run(Number(m[1]));
        db.prepare('DELETE FROM wash_items WHERE item_id=?').run(Number(m[1]));
        db.prepare('DELETE FROM items WHERE id=?').run(Number(m[1]));
        return json(res, 200, {ok:true});
      }

      if (url.pathname === '/api/wardrobes' && req.method === 'GET') return json(res, 200, wardrobes());
      if (url.pathname === '/api/wardrobes' && req.method === 'POST') {
        const input = await jsonBody(req);
        const naam = text(input.name, 40);
        if (!naam) return json(res, 400, {error:'Geef de kast een naam.'});
        if (wardrobes().some(kast => kast.name.toLowerCase() === naam.toLowerCase())) return json(res, 400, {error:'Er is al een kast met deze naam.'});
        const result = db.prepare('INSERT INTO wardrobes(name) VALUES(?)').run(naam);
        return json(res, 201, kastById(Number(result.lastInsertRowid)));
      }
      let kastMatch = url.pathname.match(/^\/api\/wardrobes\/(\d+)$/);
      if (kastMatch && req.method === 'PATCH') {
        const kast = kastById(kastMatch[1]);
        if (!kast) return json(res, 404, {error:'Kast niet gevonden.'});
        const input = await jsonBody(req);
        const naam = text(input.name, 40);
        if (!naam) return json(res, 400, {error:'Geef de kast een naam.'});
        if (wardrobes().some(other => other.id !== kast.id && other.name.toLowerCase() === naam.toLowerCase())) return json(res, 400, {error:'Er is al een kast met deze naam.'});
        db.prepare('UPDATE wardrobes SET name=? WHERE id=?').run(naam, kast.id);
        return json(res, 200, kastById(kast.id));
      }
      if (kastMatch && req.method === 'DELETE') {
        const kast = kastById(kastMatch[1]);
        if (!kast) return json(res, 404, {error:'Kast niet gevonden.'});
        if (wardrobes().length === 1) return json(res, 400, {error:'Er moet minstens één kast blijven bestaan.'});
        const verplaatsNaar = url.searchParams.get('moveTo') || '';
        if (kast.items && !verplaatsNaar) return json(res, 409, {error:`Deze kast bevat nog ${kast.items} kledingstuk${kast.items === 1 ? '' : 'ken'}. Verplaats ze eerst naar een andere kast.`});
        if (verplaatsNaar) {
          const doel = kastById(verplaatsNaar);
          if (!doel || doel.id === kast.id) return json(res, 400, {error:'Kies een andere kast om de kledingstukken naartoe te verplaatsen.'});
          db.prepare('UPDATE items SET wardrobe_id=? WHERE wardrobe_id=?').run(doel.id, kast.id);
        }
        db.prepare('DELETE FROM wardrobes WHERE id=?').run(kast.id);
        return json(res, 200, {ok:true, movedTo:verplaatsNaar ? Number(verplaatsNaar) : null, wardrobes:wardrobes()});
      }

      if (url.pathname === '/api/outfits' && req.method === 'GET') return json(res, 200, outfits());
      if (url.pathname === '/api/outfits' && req.method === 'POST') {
        const input = await jsonBody(req);
        const name = text(input.name, 80);
        if (!name) return json(res, 400, {error:'Geef je combinatie een naam.'});
        const ids = [...new Set((Array.isArray(input.itemIds) ? input.itemIds : []).map(Number).filter(id => itemById(id)))];
        if (!ids.length) return json(res, 400, {error:'Kies minimaal één kledingstuk voor deze combinatie.'});
        const result = db.prepare('INSERT INTO outfits(name,occasion,notes) VALUES(?,?,?)').run(name, OCCASIONS.includes(text(input.occasion, 16)) ? text(input.occasion, 16) : '', text(input.notes, 200));
        const outfitId = Number(result.lastInsertRowid);
        for (const id of ids) db.prepare('INSERT OR IGNORE INTO outfit_items(outfit_id,item_id) VALUES(?,?)').run(outfitId, id);
        return json(res, 201, outfits().find(x => x.id === outfitId));
      }
      m = url.pathname.match(/^\/api\/outfits\/(\d+)$/);
      if (m && req.method === 'DELETE') {
        db.prepare('DELETE FROM outfit_items WHERE outfit_id=?').run(Number(m[1]));
        db.prepare('DELETE FROM outfits WHERE id=?').run(Number(m[1]));
        return json(res, 200, {ok:true});
      }

      if (url.pathname === '/api/suggest' && req.method === 'GET') {
        const date = validDate(url.searchParams.get('date')) ? url.searchParams.get('date') : today();
        // Heeft de app een plaats voor het weer, dan gaat de verwachting van die
        // dag mee het advies in. Lukt dat niet, dan blijft het advies werken.
        const verwachting = weer ? await weer.voorDatum(date) : null;
        return json(res, 200, suggest({occasion:text(url.searchParams.get('occasion'), 16).toLowerCase() || 'casual', date, seed:Number(url.searchParams.get('seed') || 0), weer:verwachting}));
      }

      if (url.pathname === '/api/wear' && req.method === 'GET') {
        const month = url.searchParams.get('month');
        if (month && !validMonth(month)) return json(res, 400, {error:'Geef een geldige maand op (YYYY-MM).'});
        return json(res, 200, wearLog(month));
      }
      if (url.pathname === '/api/wear' && req.method === 'POST') {
        const input = await jsonBody(req);
        const date = validDate(input.date) ? input.date : today();
        let ids = [...new Set((Array.isArray(input.itemIds) ? input.itemIds : []).map(Number).filter(id => itemById(id)))];
        const outfitId = input.outfitId ? Number(input.outfitId) : null;
        if (outfitId) {
          const outfit = outfits().find(x => x.id === outfitId);
          if (!outfit) return json(res, 400, {error:'Combinatie niet gevonden.'});
          ids = [...new Set([...ids, ...outfit.itemIds])];
        }
        if (!ids.length) return json(res, 400, {error:'Kies minimaal één kledingstuk dat je droeg.'});
        const rating = input.rating === null || input.rating === undefined || input.rating === '' ? null : Number(input.rating);
        if (rating !== null && (!Number.isInteger(rating) || rating < 1 || rating > 5)) return json(res, 400, {error:'Geef een beoordeling van 1 tot 5.'});
        const result = db.prepare('INSERT INTO wear_log(worn_on,outfit_id,rating,notes) VALUES(?,?,?,?)').run(date, outfitId, rating, text(input.notes, 200));
        const wearId = Number(result.lastInsertRowid);
        for (const id of ids) {
          db.prepare('INSERT OR IGNORE INTO wear_items(wear_id,item_id) VALUES(?,?)').run(wearId, id);
          if (input.dirty === false) continue;
          db.prepare("UPDATE items SET status='vies', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='schoon'").run(id);
        }
        return json(res, 201, wearEntry(wearId));
      }
      m = url.pathname.match(/^\/api\/wear\/(\d+)$/);
      if (m && req.method === 'DELETE') {
        db.prepare('DELETE FROM wear_items WHERE wear_id=?').run(Number(m[1]));
        db.prepare('DELETE FROM wear_log WHERE id=?').run(Number(m[1]));
        return json(res, 200, {ok:true});
      }

      if (url.pathname === '/api/washes' && req.method === 'GET') return json(res, 200, washes());
      if (url.pathname === '/api/washes' && req.method === 'POST') {
        const input = await jsonBody(req);
        const ids = [...new Set((Array.isArray(input.itemIds) ? input.itemIds : []).map(Number).filter(id => itemById(id)))];
        if (!ids.length) return json(res, 400, {error:'Kies minimaal één kledingstuk voor deze was.'});
        const date = validDate(input.plannedFor) ? input.plannedFor : today();
        const result = db.prepare('INSERT INTO washes(planned_for,program,notes) VALUES(?,?,?)').run(date, text(input.program, 40), text(input.notes, 200));
        const washId = Number(result.lastInsertRowid);
        for (const id of ids) {
          db.prepare('INSERT OR IGNORE INTO wash_items(wash_id,item_id) VALUES(?,?)').run(washId, id);
          db.prepare("UPDATE items SET status='in de was', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
        }
        return json(res, 201, washes().find(x => x.id === washId));
      }
      m = url.pathname.match(/^\/api\/washes\/(\d+)$/);
      if (m && req.method === 'PATCH') {
        const wash = washes().find(x => x.id === Number(m[1]));
        if (!wash) return json(res, 404, {error:'Was niet gevonden.'});
        db.prepare('UPDATE washes SET done=1 WHERE id=?').run(wash.id);
        for (const id of wash.itemIds) db.prepare("UPDATE items SET status='schoon', updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
        return json(res, 200, washes().find(x => x.id === wash.id));
      }
      if (m && req.method === 'DELETE') {
        const wash = washes().find(x => x.id === Number(m[1]));
        if (!wash) return json(res, 404, {error:'Was niet gevonden.'});
        for (const id of wash.itemIds) db.prepare("UPDATE items SET status='vies', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='in de was'").run(id);
        db.prepare('DELETE FROM wash_items WHERE wash_id=?').run(wash.id);
        db.prepare('DELETE FROM washes WHERE id=?').run(wash.id);
        return json(res, 200, {ok:true});
      }

      if (url.pathname === '/api/analytics' && req.method === 'GET') return json(res, 200, analytics());

      if (url.pathname === '/api/photos' && req.method === 'POST') {
        const type = String(req.headers['content-type'] || '').split(';')[0].trim();
        const ext = ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[type];
        if (!ext) return json(res, 400, {error:'Alleen JPEG-, PNG- of WebP-foto’s zijn toegestaan.'});
        const raw = await body(req);
        if (raw.length < 100) return json(res, 400, {error:'De foto lijkt leeg.'});
        const file = `${crypto.randomUUID()}.${ext}`;
        fs.writeFileSync(path.join(MEDIA_DIR, file), raw);
        return json(res, 201, {photo:file, bytes:raw.length});
      }
      m = url.pathname.match(/^\/media\/([A-Za-z0-9._-]+)$/);
      if (m && req.method === 'GET') {
        const file = path.join(MEDIA_DIR, path.basename(m[1]));
        if (fs.existsSync(file) && fs.statSync(file).isFile()) return serveFile(res, file, MIME[path.extname(file)] || 'application/octet-stream');
        res.writeHead(404); return res.end('Not found');
      }

      res.writeHead(404); res.end('Not found');
    } catch (error) {
      json(res, 400, {error:error.message || 'Er ging iets mis.'});
    }
  }

  return { handle, CATEGORIES, STATUSES, SEASONS, OCCASIONS, suggest, seasonOf, analytics, itemById, MEDIA_DIR };
}

module.exports = { createWardrobe };
