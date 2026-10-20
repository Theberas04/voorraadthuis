// Barcodeherkenning voor VoorraadThuis.
//
// Een gescande EAN-code wordt opgezocht in Open Food Facts, een open
// productendatabase (ODbL 1.0). De uitkomst wordt lokaal bewaard, zodat een
// tweede scan van hetzelfde product zonder internet werkt. Voert de gebruiker
// zelf een product in met een barcode, dan onthoudt de app die naam ook — het
// eigen antwoord gaat altijd voor op de databank.

const DEFAULT_API = 'https://world.openfoodfacts.org/api/v2/product/{code}.json';
const VELDEN = 'code,product_name,product_name_nl,product_name_en,generic_name,generic_name_nl,brands,quantity,categories_tags,image_front_small_url,image_front_url,image_url';
const GELDIGE_LENGTES = [8, 12, 13, 14];
const CACHE_DAGEN = 90;

// Eenheden zoals ze in de databank staan, naar de Nederlandse eenheden van de app.
const EENHEDEN = {
  g: 'gram', gr: 'gram', gram: 'gram', grammen: 'gram', gs: 'gram',
  kg: 'kilogram', kilo: 'kilogram', kilogram: 'kilogram',
  mg: 'milligram', ml: 'ml', milliliter: 'ml', cl: 'cl', dl: 'dl',
  l: 'liter', lt: 'liter', ltr: 'liter', litre: 'liter', liter: 'liter',
  st: 'stuks', stk: 'stuks', stuks: 'stuks', piece: 'stuks', pieces: 'stuks', pc: 'stuks', pcs: 'stuks',
  pot: 'potje', potje: 'potje', pouch: 'zak', zak: 'zak', bag: 'zak', pack: 'pak', pak: 'pak',
  pakken: 'pakken', blik: 'blik', can: 'blik', rol: 'rol', doos: 'doos', box: 'doos',
  fles: 'fles', bottle: 'fles', zakje: 'zakje', sachet: 'zakje', tablet: 'tablet', tabletten: 'tabletten',
};

function cijfers(waarde) {
  return String(waarde ?? '').replace(/\D/g, '');
}

function geldigeBarcode(waarde) {
  const code = cijfers(waarde);
  return GELDIGE_LENGTES.includes(code.length) ? code : null;
}

// Controlecijfer volgens de GTIN-regel (geldt voor EAN-8, UPC-A, EAN-13 en GTIN-14).
function controlecijferKlopt(code) {
  if (!GELDIGE_LENGTES.includes(code.length)) return false;
  let som = 0;
  for (let i = code.length - 2, gewicht = 3; i >= 0; i -= 1, gewicht = gewicht === 3 ? 1 : 3) som += Number(code[i]) * gewicht;
  return (10 - (som % 10)) % 10 === Number(code[code.length - 1]);
}

// "1 l" wordt 1 liter, "6 x 33 cl" wordt 198 cl, "500 g" wordt 500 gram.
function hoeveelheidEnEenheid(tekst) {
  const schoon = String(tekst ?? '').trim();
  const meervoud = schoon.match(/^(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*([A-Za-z]+)?/);
  const enkelvoud = schoon.match(/^(\d+(?:[.,]\d+)?)\s*([A-Za-z]+)?/);
  const treffer = meervoud || enkelvoud;
  if (!treffer) return { quantity: null, unit: '' };
  const naarGetal = (waarde) => Number(String(waarde).replace(',', '.'));
  const aantal = meervoud ? naarGetal(treffer[1]) * naarGetal(treffer[2]) : naarGetal(treffer[1]);
  const eenheid = String(treffer[3] ?? (meervoud ? '' : treffer[2] ?? '')).toLowerCase();
  const unit = EENHEDEN[eenheid] ?? (eenheid ? '' : 'stuks');
  return Number.isFinite(aantal) && aantal > 0 ? { quantity: aantal, unit: unit || 'stuks' } : { quantity: null, unit: '' };
}

function schoneTekst(waarde) {
  return String(waarde ?? '').replace(/\s+/g, ' ').trim();
}

function createBarcodes({ db, now = () => new Date() }) {
  db.exec(`CREATE TABLE IF NOT EXISTS barcode_cache(barcode TEXT PRIMARY KEY, name TEXT NOT NULL, brand TEXT NOT NULL DEFAULT '', quantity REAL, unit TEXT NOT NULL DEFAULT '', quantity_text TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT '', categories TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);

  function uitCache(code) {
    const rij = db.prepare('SELECT * FROM barcode_cache WHERE barcode=?').get(code);
    if (!rij) return null;
    const ouder = (now().getTime() - new Date(`${rij.fetched_at.replace(' ', 'T')}Z`).getTime()) / 86400000;
    return { ...rij, vers: Number.isFinite(ouder) ? ouder <= CACHE_DAGEN : false };
  }

  function bewaar(code, gegevens) {
    db.prepare(`INSERT INTO barcode_cache(barcode,name,brand,quantity,unit,quantity_text,image_url,categories,source,fetched_at)
      VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(barcode) DO UPDATE SET name=excluded.name,brand=excluded.brand,quantity=excluded.quantity,unit=excluded.unit,
      quantity_text=excluded.quantity_text,image_url=excluded.image_url,categories=excluded.categories,source=excluded.source,fetched_at=CURRENT_TIMESTAMP`)
      .run(code, gegevens.name, gegevens.brand || '', gegevens.quantity ?? null, gegevens.unit || '', gegevens.quantityText || '', gegevens.imageUrl || '', gegevens.categories || '', gegevens.source || '');
  }

  function alsAntwoord(rij, extra = {}) {
    return {
      found: true,
      barcode: rij.barcode,
      name: rij.name,
      brand: rij.brand || '',
      quantity: rij.quantity ?? null,
      unit: rij.unit || 'stuks',
      quantityText: rij.quantity_text || '',
      imageUrl: rij.image_url || '',
      categories: rij.categories ? rij.categories.split(',') : [],
      source: rij.source || 'Open Food Facts',
      license: rij.source === 'eigen invoer' ? '' : 'ODbL 1.0',
      sourceUrl: rij.source === 'eigen invoer' ? '' : `https://world.openfoodfacts.org/product/${rij.barcode}`,
      updatedAt: rij.fetched_at,
      cached: true,
      ...extra,
    };
  }

  // Onthoudt wat de gebruiker zelf invulde, zodat de volgende scan meteen goed gaat.
  function onthoud(code, { name, brand = '', quantity = null, unit = '' }) {
    const schoon = geldigeBarcode(code);
    if (!schoon || !schoneTekst(name)) return null;
    bewaar(schoon, { name: schoneTekst(name).slice(0, 120), brand: schoneTekst(brand).slice(0, 80), quantity, unit, quantityText: '', imageUrl: '', categories: '', source: 'eigen invoer' });
    return schoon;
  }

  async function zoekBijOpenFoodFacts(code) {
    const sjabloon = process.env.BARCODE_API || DEFAULT_API;
    const adres = sjabloon.includes('{code}') ? sjabloon.replace('{code}', encodeURIComponent(code)) : `${sjabloon.replace(/\/$/, '')}/${encodeURIComponent(code)}.json?fields=${VELDEN}`;
    const antwoord = await fetch(adres, {
      headers: {
        'user-agent': 'VoorraadThuis/1.0 (self-hosted huishoudapp; https://github.com/Theberas04/voorraadthuis)',
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(Number(process.env.BARCODE_TIMEOUT_MS || 8000)),
    });
    if (!antwoord.ok) throw Error(`Open Food Facts gaf status ${antwoord.status}`);
    const gegevens = await antwoord.json();
    const product = gegevens?.product;
    if (!product) return null;
    const name = schoneTekst(product.product_name_nl || product.generic_name_nl || product.product_name || product.generic_name || product.product_name_en);
    if (!name) return null;
    const { quantity, unit } = hoeveelheidEnEenheid(product.quantity);
    return {
      name,
      brand: schoneTekst(String(product.brands || '').split(',')[0]),
      quantity,
      unit,
      quantityText: schoneTekst(product.quantity),
      imageUrl: product.image_front_small_url || product.image_front_url || product.image_url || '',
      categories: Array.isArray(product.categories_tags) ? product.categories_tags.slice(0, 6).join(',') : '',
      source: 'Open Food Facts',
    };
  }

  // Zoekt een barcode op. forceert een nieuwe opzoeking met force=true.
  async function lookup(rawCode, { force = false } = {}) {
    const code = geldigeBarcode(rawCode);
    if (!code) return { found: false, reason: 'ongeldig', barcode: String(rawCode ?? ''), message: 'Een barcode bestaat uit 8, 12, 13 of 14 cijfers.' };
    if (!controlecijferKlopt(code) && !force) return { found: false, reason: 'controlecijfer', barcode: code, message: 'Dit lijkt geen geldige barcode: het controlecijfer klopt niet. Zoek toch om het alsnog op te zoeken.' };
    const bewaard = uitCache(code);
    if (bewaard && !force) return alsAntwoord(bewaard, { cached: true });
    if (bewaard?.source === 'eigen invoer' && !force) return alsAntwoord(bewaard, { cached: true });
    if (process.env.BARCODE_OFFLINE === '1') {
      return bewaard
        ? alsAntwoord(bewaard, { cached: true })
        : { found: false, reason: 'offline', barcode: code, message: 'Geen verbinding met de productendatabank; vul de naam zelf in.' };
    }
    try {
      const nieuw = await zoekBijOpenFoodFacts(code);
      if (!nieuw) {
        if (bewaard) return alsAntwoord(bewaard, { cached: true });
        return { found: false, reason: 'onbekend', barcode: code, message: 'Deze barcode staat niet in de databank; vul de naam zelf in.', source: 'Open Food Facts' };
      }
      bewaar(code, nieuw);
      return alsAntwoord(uitCache(code), { cached: false, fresh: true });
    } catch (fout) {
      if (bewaard) return alsAntwoord(bewaard, { cached: true, warning: fout.message });
      return { found: false, reason: 'storing', barcode: code, message: `De productendatabank is niet bereikbaar (${fout.message}); vul de naam zelf in.` };
    }
  }

  return { lookup, onthoud, geldigeBarcode, controlecijferKlopt, hoeveelheidEnEenheid };
}

module.exports = { createBarcodes, hoeveelheidEnEenheid, geldigeBarcode, controlecijferKlopt };