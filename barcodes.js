// Barcodeherkenning voor VoorraadThuis.
//
// Een gescande EAN-code wordt opgezocht in de open productendatabanken van Open
// Food Facts (ODbL 1.0): eerst voeding, daarna huishoud- en verzorgingsproducten
// en dierenvoeding. De uitkomst wordt lokaal bewaard, zodat een tweede scan van
// hetzelfde product zonder internet werkt. Voert de gebruiker zelf een product in
// met een barcode, dan onthoudt de app die naam ook — het eigen antwoord gaat
// altijd voor op de databank.
//
// Nederlandse producten vragen extra zorg: dezelfde barcode heeft in de databank
// vaak wél een Nederlandse naam en geen Engelse, of andersom. Daarom vragen we
// juist de Nederlandse velden op (`lc=nl`), proberen we meerdere databanken en
// vertellen we in welke taal de gevonden naam staat.

const DATABANKEN = [
  { naam: 'Open Food Facts', basis: 'https://world.openfoodfacts.org', licentie: 'ODbL 1.0' },
  { naam: 'Open Products Facts', basis: 'https://world.openproductsfacts.org', licentie: 'ODbL 1.0' },
  { naam: 'Open Beauty Facts', basis: 'https://world.openbeautyfacts.org', licentie: 'ODbL 1.0' },
  { naam: 'Open Pet Food Facts', basis: 'https://world.openpetfoodfacts.org', licentie: 'ODbL 1.0' },
];
const VELDEN = [
  'code', 'lang', 'product_name', 'product_name_nl', 'product_name_en', 'product_name_de', 'product_name_fr',
  'abbreviated_product_name', 'abbreviated_product_name_nl', 'generic_name', 'generic_name_nl', 'generic_name_en',
  'brands', 'quantity', 'categories_tags', 'image_front_small_url', 'image_front_url', 'image_url',
].join(',');
const GELDIGE_LENGTES = [8, 12, 13, 14];
const CACHE_DAGEN = 90;
const POGINGEN = 3;
const WACHTTIJDEN = [400, 1200];
const TALEN = { nl: 'Nederlands', en: 'Engels', de: 'Duits', fr: 'Frans', es: 'Spaans', it: 'Italiaans', pt: 'Portugees', ca: 'Catalaans' };

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

// Veelvoorkomende categorieën uit de databank, zodat een product zonder naam toch
// een Nederlandse aanduiding krijgt in plaats van een Engels trefwoord.
const CATEGORIEEN = {
  dairies: 'zuivel', milks: 'melk', cheeses: 'kaas', yogurts: 'yoghurt', butters: 'boter',
  breads: 'brood', 'sandwiches': 'broodjes', biscuits: 'koekjes', cakes: 'cake', pastries: 'gebak',
  waters: 'water', 'mineral-waters': 'mineraalwater', 'carbonated-drinks': 'frisdrank', juices: 'sap',
  coffees: 'koffie', teas: 'thee', beers: 'bier', wines: 'wijn',
  sugars: 'suiker', 'powdered-sugars': 'poedersuiker', honeys: 'honing', jams: 'jam',
  'peanut-butters': 'pindakaas', 'plant-based-spreads': 'broodbeleg', spreads: 'broodbeleg',
  chocolates: 'chocolade', snacks: 'snacks', 'salty-snacks': 'hartige snacks', 'crisps': 'chips',
  pastas: 'pasta', rices: 'rijst', cereals: 'granen', 'breakfast-cereals': 'ontbijtgranen',
  flours: 'bloem', oils: 'olie', 'vegetable-oils': 'plantaardige olie', vinegars: 'azijn',
  sauces: 'saus', soups: 'soep', 'frozen-foods': 'diepvries', vegetables: 'groenten', fruits: 'fruit',
  meats: 'vlees', fishes: 'vis', eggs: 'eieren', 'soy-and-derivatives': 'soja',
  'cleaning-products': 'schoonmaakmiddel', detergents: 'wasmiddel', 'dishwasher-products': 'vaatwasmiddel',
  'toilet-papers': 'toiletpapier', 'hygiene-products': 'hygiëneproduct', cosmetics: 'cosmetica',
  shampoos: 'shampoo', soaps: 'zeep', 'toothpastes': 'tandpasta', 'cat-foods': 'kattenvoer', 'dog-foods': 'hondenvoer',
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

function eersteMerk(waarde) {
  return schoneTekst(String(waarde ?? '').split(',')[0]);
}

// De categorieën staan als "en:powdered-sugars"; de laatste is de meest specifieke.
function categorieNaam(product) {
  const tags = Array.isArray(product.categories_tags) ? product.categories_tags : [];
  for (let i = tags.length - 1; i >= 0; i -= 1) {
    const sleutel = String(tags[i]).replace(/^[a-z]{2}:/, '');
    if (CATEGORIEEN[sleutel]) return CATEGORIEEN[sleutel];
  }
  return '';
}

// Kiest de beste naam: Nederlands eerst, dan wat de databank verder heeft. De taal
// gaat mee terug, zodat de app kan laten zien waarom een naam niet Nederlands is.
function kiesNaam(product) {
  const kandidaten = [
    ['nl', product.product_name_nl], ['nl', product.abbreviated_product_name_nl], ['nl', product.generic_name_nl],
    [schoneTekst(product.lang).toLowerCase() || null, product.product_name],
    [schoneTekst(product.lang).toLowerCase() || null, product.abbreviated_product_name],
    [schoneTekst(product.lang).toLowerCase() || null, product.generic_name],
    ['en', product.product_name_en], ['en', product.generic_name_en],
    ['de', product.product_name_de], ['fr', product.product_name_fr],
  ];
  for (const [taal, waarde] of kandidaten) {
    const naam = schoneTekst(waarde);
    if (naam) return { naam, taal: taal || null };
  }
  // Geen naam in de databank: merk plus Nederlandse categorie is beter dan niets.
  const merk = eersteMerk(product.brands);
  const categorie = categorieNaam(product);
  if (merk && categorie) return { naam: `${merk} ${categorie}`, taal: 'nl', samengesteld: true };
  if (categorie) return { naam: categorie.charAt(0).toUpperCase() + categorie.slice(1), taal: 'nl', samengesteld: true };
  return { naam: '', taal: null };
}

function createBarcodes({ db, now = () => new Date(), fetchImpl = fetch, wacht = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  db.exec(`CREATE TABLE IF NOT EXISTS barcode_cache(barcode TEXT PRIMARY KEY, name TEXT NOT NULL, brand TEXT NOT NULL DEFAULT '', quantity REAL, unit TEXT NOT NULL DEFAULT '', quantity_text TEXT NOT NULL DEFAULT '', image_url TEXT NOT NULL DEFAULT '', categories TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '', fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  // Kolommen die later zijn toegevoegd (bron-URL, taal van de naam) voor bestaande databases.
  const kolommen = db.prepare('PRAGMA table_info(barcode_cache)').all().map((k) => k.name);
  if (!kolommen.includes('source_url')) db.exec("ALTER TABLE barcode_cache ADD COLUMN source_url TEXT NOT NULL DEFAULT ''");
  if (!kolommen.includes('lang')) db.exec("ALTER TABLE barcode_cache ADD COLUMN lang TEXT NOT NULL DEFAULT ''");
  if (!kolommen.includes('license')) db.exec("ALTER TABLE barcode_cache ADD COLUMN license TEXT NOT NULL DEFAULT ''");

  // Welke databanken we langsgaan. BARCODE_API blijft werken zoals het was (één adres);
  // BARCODE_DATABANKEN is een kommagescheiden lijst van adressen.
  function databanken() {
    const enkel = schoneTekst(process.env.BARCODE_API);
    if (enkel) return [{ naam: 'Open Food Facts', sjabloon: enkel, licentie: 'ODbL 1.0' }];
    const lijst = schoneTekst(process.env.BARCODE_DATABANKEN);
    if (lijst) {
      // Elke entry mag een eigen naam krijgen: "Open Food Facts=https://…". Zonder naam
      // leiden we die af uit het adres.
      return lijst.split(',').map((deel) => schoneTekst(deel)).filter(Boolean).map((deel) => {
        const [voor, na] = deel.includes('=') ? [deel.slice(0, deel.indexOf('=')), deel.slice(deel.indexOf('=') + 1)] : [null, deel];
        const adres = schoneTekst(na);
        const naam = schoneTekst(voor) || (/openproductsfacts/.test(adres) ? 'Open Products Facts'
          : /openbeautyfacts/.test(adres) ? 'Open Beauty Facts'
            : /openpetfoodfacts/.test(adres) ? 'Open Pet Food Facts' : 'Open Food Facts');
        return {
          naam,
          sjabloon: adres.includes('{code}') ? adres : `${adres.replace(/\/$/, '')}/api/v2/product/{code}.json`,
          licentie: 'ODbL 1.0',
        };
      });
    }
    return DATABANKEN.map((b) => ({ ...b, sjabloon: `${b.basis}/api/v2/product/{code}.json` }));
  }

  function adresVoor(databank, code) {
    const basis = databank.sjabloon.replace('{code}', encodeURIComponent(code));
    const teken = basis.includes('?') ? '&' : '?';
    return `${basis}${teken}fields=${VELDEN}&lc=nl`;
  }

  function uitCache(code) {
    const rij = db.prepare('SELECT * FROM barcode_cache WHERE barcode=?').get(code);
    if (!rij) return null;
    const ouder = (now().getTime() - new Date(`${rij.fetched_at.replace(' ', 'T')}Z`).getTime()) / 86400000;
    return { ...rij, vers: Number.isFinite(ouder) ? ouder <= CACHE_DAGEN : false };
  }

  function bewaar(code, gegevens) {
    db.prepare(`INSERT INTO barcode_cache(barcode,name,brand,quantity,unit,quantity_text,image_url,categories,source,source_url,lang,license,fetched_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(barcode) DO UPDATE SET name=excluded.name,brand=excluded.brand,quantity=excluded.quantity,unit=excluded.unit,
      quantity_text=excluded.quantity_text,image_url=excluded.image_url,categories=excluded.categories,source=excluded.source,
      source_url=excluded.source_url,lang=excluded.lang,license=excluded.license,fetched_at=CURRENT_TIMESTAMP`)
      .run(code, gegevens.name, gegevens.brand || '', gegevens.quantity ?? null, gegevens.unit || '', gegevens.quantityText || '',
        gegevens.imageUrl || '', gegevens.categories || '', gegevens.source || '', gegevens.sourceUrl || '',
        gegevens.lang || '', gegevens.license || '');
  }

  function alsAntwoord(rij, extra = {}) {
    const taal = rij.lang || '';
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
      license: rij.source === 'eigen invoer' ? '' : (rij.license || 'ODbL 1.0'),
      sourceUrl: rij.source === 'eigen invoer' ? '' : (rij.source_url || `https://world.openfoodfacts.org/product/${rij.barcode}`),
      nameLanguage: taal,
      nameLanguageName: taal ? (TALEN[taal] || taal) : '',
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

  // Vraagt één databank om het product, met een paar pogingen: de databanken laten
  // bij drukte status 429 of 503 zien, en dan is een tweede poging vaak genoeg.
  async function vraagProduct(databank, code) {
    let laatsteFout = null;
    for (let poging = 0; poging < POGINGEN; poging += 1) {
      try {
        const antwoord = await fetchImpl(adresVoor(databank, code), {
          headers: {
            'user-agent': 'VoorraadThuis/1.0 (self-hosted huishoudapp; https://github.com/Theberas04/voorraadthuis)',
            accept: 'application/json',
          },
          signal: AbortSignal.timeout(Number(process.env.BARCODE_TIMEOUT_MS || 8000)),
        });
        if (antwoord.status === 429 || antwoord.status >= 500) {
          laatsteFout = Error(`${databank.naam} gaf status ${antwoord.status}`);
          if (poging < POGINGEN - 1) { await wacht(WACHTTIJDEN[poging] ?? 1200); continue; }
          throw laatsteFout;
        }
        if (!antwoord.ok) return null; // 404 of 400: deze databank kent de code niet
        const gegevens = await antwoord.json();
        return gegevens?.product ?? null;
      } catch (fout) {
        laatsteFout = fout.name === 'TimeoutError' ? Error(`${databank.naam} antwoordde niet op tijd`) : fout;
        if (poging < POGINGEN - 1) { await wacht(WACHTTIJDEN[poging] ?? 1200); continue; }
      }
    }
    throw laatsteFout ?? Error(`${databank.naam} is niet bereikbaar`);
  }

  async function zoekInDatabanken(code) {
    const fouten = [];
    for (const databank of databanken()) {
      let product = null;
      try {
        product = await vraagProduct(databank, code);
      } catch (fout) {
        fouten.push(fout.message);
        continue;
      }
      if (!product) continue;
      const { naam, taal, samengesteld } = kiesNaam(product);
      if (!naam) continue;
      const { quantity, unit } = hoeveelheidEnEenheid(product.quantity);
      return {
        gevonden: {
          name: naam,
          brand: eersteMerk(product.brands),
          quantity,
          unit,
          quantityText: schoneTekst(product.quantity),
          imageUrl: product.image_front_small_url || product.image_front_url || product.image_url || '',
          categories: Array.isArray(product.categories_tags) ? product.categories_tags.slice(0, 6).join(',') : '',
          source: databank.naam,
          sourceUrl: `https://${databank.sjabloon.split('/')[2]}/product/${code}`,
          lang: taal || '',
          license: databank.licentie,
        },
        samengesteld,
      };
    }
    return { gevonden: null, fouten };
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
      const { gevonden, fouten } = await zoekInDatabanken(code);
      if (!gevonden) {
        if (bewaard) return alsAntwoord(bewaard, { cached: true, ...(fouten.length ? { warning: fouten[0] } : {}) });
        if (fouten.length) {
          return {
            found: false, reason: 'storing', barcode: code,
            message: `De productendatabank is even niet bereikbaar (${fouten[0]}); probeer het zo nog eens of vul de naam zelf in.`,
            tried: fouten,
          };
        }
        return {
          found: false, reason: 'onbekend', barcode: code,
          message: 'Deze barcode staat niet in de open productendatabank; vul de naam zelf in — de app onthoudt hem bij deze code. Huismerk-, verse en nieuwe producten ontbreken er vaak.',
          source: 'Open Food Facts',
        };
      }
      bewaar(code, gevonden);
      const antwoord = alsAntwoord(uitCache(code), { cached: false, fresh: true });
      if (gevonden.lang && gevonden.lang !== 'nl') antwoord.nameLanguageName = TALEN[gevonden.lang] || gevonden.lang;
      return antwoord;
    } catch (fout) {
      if (bewaard) return alsAntwoord(bewaard, { cached: true, warning: fout.message });
      return { found: false, reason: 'storing', barcode: code, message: `De productendatabank is niet bereikbaar (${fout.message}); vul de naam zelf in.` };
    }
  }

  return { lookup, onthoud, geldigeBarcode, controlecijferKlopt, hoeveelheidEnEenheid, databanken, kiesNaam };
}

module.exports = { createBarcodes, hoeveelheidEnEenheid, geldigeBarcode, controlecijferKlopt, kiesNaam, DATABANKEN };
