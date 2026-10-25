// Rekenkern van de keuken: wat staat er in huis, wat ontbreekt er nog,
// hoeveelheden omrekenen naar een ander aantal porties en de boodschappen van
// een hele week samenvoegen tot één regel per product.
// Alles hier is puur rekenwerk zonder database, zodat het los te testen is.

// Woorden die hetzelfde product aanduiden, zodat enkelvoud, meervoud en de
// gebruikelijke schrijfwijze bij elkaar horen.
const WOORD_ALIASSEN = new Map();
for (const [canon, varianten] of Object.entries({
  ei:['eieren','eitje','eitjes'],
  ui:['uien','uitje','uitjes'],
  tomaat:['tomaten','tomaatjes'],
  aardappel:['aardappelen','aardappels','aardappeltjes'],
  citroen:['citroenen','citroentje'],
  sinaasappel:['sinaasappels','sinaasappelen'],
  wortel:['wortels','wortelen','worteltjes'],
  boon:['bonen','boontjes'],
  paprika:['paprikas','paprikaatje'],
  champignon:['champignons'],
  prei:['preien'],
  courgette:['courgettes'],
  komkommer:['komkommers'],
  banaan:['bananen'],
  appel:['appels','appeltjes'],
  peer:['peren'],
  aardbei:['aardbeien'],
  bosui:['bosuitjes','lente-ui','lenteui'],
  knoflook:['knoflookteentje','knoflookteentjes','knofloken'],
}) ) {
  const sleutel = canon;
  WOORD_ALIASSEN.set(sleutel, sleutel);
  for (const variant of varianten) WOORD_ALIASSEN.set(variant, sleutel);
}

// Delen van een samengesteld woord die het een ánder product maken. Zo mag
// 'kokosmelk' niet goedgerekend worden omdat je melk in huis hebt, en is
// 'bloemkool' geen bloem.
const VARIANT_WOORDEN = new Set(['kokos','soja','amandel','haver','rijst','geiten','schapen','plantaardig','lactosevrij','suikervrij','glutenvrij','kool','kooltjes','vlees','worst']);

// Ingrediënten die iedereen in de kast heeft. Ze tellen niet mee als iets dat
// je nog moet halen; de app zegt er wel bij dat ze als aanwezig gelden.
const BASIS_WOORDEN = ['zout','peper','water','olie','suiker','bloem','azijn','bakpoeder','maizena','vanille'];

function normaliseer(tekst) {
  return String(tekst ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Eén woord terugbrengen tot een vergelijkbare kern: eerst het alias, dan een
// eenvoudige meervoudsuitgang eraf.
function kernWoord(woord) {
  if (WOORD_ALIASSEN.has(woord)) return WOORD_ALIASSEN.get(woord);
  if (woord.length > 4 && woord.endsWith('en')) return woord.slice(0, -2);
  if (woord.length > 3 && woord.endsWith('s') && !woord.endsWith('ss')) return woord.slice(0, -1);
  return woord;
}

function woorden(tekst) {
  const uit = new Set();
  for (const woord of normaliseer(tekst).split(' ')) {
    if (!woord) continue;
    uit.add(kernWoord(woord));
  }
  return uit;
}

function bouwVoorraadIndex(producten) {
  // Twee verzamelingen: de woorden zoals ze geschreven zijn (voor samengestelde
  // namen als 'cherrytomaten' tegen 'tomaten') en de kernwoorden (voor enkelvoud
  // en meervoud: 'eieren' tegen 'ei').
  const index = {rauw:new Set(), kern:new Set()};
  for (const product of producten || []) {
    for (const woord of normaliseer(product?.name).split(' ')) {
      if (!woord) continue;
      index.rauw.add(woord);
      index.kern.add(kernWoord(woord));
    }
  }
  return index;
}

// Een samengesteld woord telt mee als het product erin zit en het overgebleven
// deel geen ander product aanduidt.
function deelWoordMatch(woord, productWoorden) {
  for (let lengte = 4; lengte < woord.length; lengte++) {
    const voor = woord.slice(0, lengte);
    const na = woord.slice(woord.length - lengte);
    const restVoor = woord.slice(lengte);
    const restNa = woord.slice(0, woord.length - lengte);
    if (productWoorden.has(voor) && restVoor.length >= 3 && !VARIANT_WOORDEN.has(restVoor) && !VARIANT_WOORDEN.has(voor)) return true;
    if (productWoorden.has(na) && restNa.length >= 3 && !VARIANT_WOORDEN.has(restNa) && !VARIANT_WOORDEN.has(na)) return true;
  }
  return false;
}

function ingredientInHuis(naam, index) {
  const eigen = normaliseer(naam).split(' ').filter(Boolean);
  for (const woord of eigen) if (index.kern.has(kernWoord(woord))) return true;
  for (const woord of eigen) if (deelWoordMatch(woord, index.rauw)) return true;
  return false;
}

function isBasisIngrediënt(naam) {
  for (const woord of woorden(naam)) {
    for (const basis of BASIS_WOORDEN) {
      if (woord === basis) return true;
      // 'olijfolie' is wel olie, 'watermeloen' geen water en 'zoutvlees' geen zout:
      // daarom alleen een uitgang, en alleen als de rest geen ander product is.
      if (basis.length >= 4 && woord.endsWith(basis)) {
        const rest = woord.slice(0, woord.length - basis.length);
        if (rest.length >= 3 && !VARIANT_WOORDEN.has(rest)) return true;
      }
    }
  }
  return false;
}

function ontbrekendVoorRecept(recept, index) {
  const ontbreekt = [], basis = [];
  let aanwezig = 0;
  for (const ingredient of recept?.ingredients || []) {
    if (isBasisIngrediënt(ingredient.name)) { basis.push(ingredient.name); continue; }
    if (ingredientInHuis(ingredient.name, index)) { aanwezig++; continue; }
    ontbreekt.push(ingredient.name);
  }
  return {ontbreekt, aanwezig, basis, klaar:ontbreekt.length === 0};
}

// Eenheden in één vaste vorm zetten, met de factor naar de basisvorm (gram of
// milliliter), zodat 1 kilogram en 500 gram bij elkaar opgeteld kunnen worden.
const EENHEDEN = new Map(Object.entries({
  gram:['g','gr','gram','grammen','grammetje','grammetjes','kg:1000','kilogram:1000','kilogrammen:1000','kilo:1000'],
  milliliter:['ml','milliliter','milliliters','cc','cl:10','l:1000','lt:1000','liter:1000','liters:1000','litertje:1000'],
  stuks:['stuk','stuks','stuksje','st'],
  eetlepel:['el','eetlepel','eetlepels'],
  theelepel:['tl','theelepel','theelepels'],
  blik:['blik','blikken','blikje','blikjes'],
  pak:['pak','pakken','pakje','pakjes'],
  potje:['pot','potten','potje','potjes'],
  zak:['zak','zakken','zakje','zakjes'],
  bos:['bos','bossen','bosje','bosjes'],
  kopje:['kopje','kopjes','cup','cups'],
  teen:['teen','tenen','teentje','teentjes'],
  plak:['plak','plakken','plakje','plakjes'],
  takje:['tak','takken','takje','takjes'],
  snufje:['snufje','snufjes','snuifje'],
  scheutje:['scheut','scheutje','scheutjes'],
  handvol:['handvol','handje','handjes'],
  blad:['blad','bladeren','blaadje','blaadjes'],
  steel:['steel','stelen','steeltje'],
  stengel:['stengel','stengels'],
  sneetje:['sneetje','sneetjes','snede','sneden'],
}));
const EENHEID_VORM = new Map();
for (const [canon, varianten] of EENHEDEN) for (const variant of varianten) {
  const [naam, factor] = variant.split(':');
  EENHEID_VORM.set(naam, {eenheid:canon, factor:Number(factor || 1)});
}

function normaliseerEenheid(eenheid) {
  const sleutel = normaliseer(eenheid);
  if (!sleutel) return {eenheid:'stuks', factor:1};
  return EENHEID_VORM.get(sleutel) || {eenheid:sleutel, factor:1};
}

// Hoeveelheden leesbaar houden: grote getallen heel, kleine met één cijfer
// achter de komma. 350 gram wordt bij 2 personen 175 gram, 1 potje wordt 0,5.
function schaalHoeveelheid(waarde, factor) {
  const uitkomst = Number(waarde) * Number(factor);
  if (!Number.isFinite(uitkomst)) return Number(waarde);
  if (uitkomst >= 10) return Math.round(uitkomst);
  return Math.round(uitkomst * 10) / 10;
}

// Producten die je per stuk koopt (eieren, blikken, pakken) houd je heel:
// driekwart ei slaat nergens op, dus daar wordt het een heel aantal.
const HELE_EENHEDEN = new Set(['stuks','blik','pak','potje','zak','bos','teen','plak','takje','sneetje','kopje','stengel','blad','steel','scheutje','handvol','snufje']);

function schaalHoeveelheidPerEenheid(waarde, factor, eenheid) {
  const uitkomst = schaalHoeveelheid(waarde, factor);
  // Bij stukproducten schuift een uitkomst die bijna een heel aantal is naar dat
  // hele aantal (vier eieren voor drie personen wordt er voor twee personen
  // drie). Een écht deel, zoals een half potje, blijft staan.
  if (HELE_EENHEDEN.has(eenheid) && uitkomst >= 1 && Math.abs(uitkomst - Math.round(uitkomst)) <= 0.34) return Math.round(uitkomst);
  return uitkomst;
}

function schaalIngredienten(ingredients, porties, basisPorties) {
  const lijst = Array.isArray(ingredients) ? ingredients : [];
  const gevraagd = Number(porties), basis = Number(basisPorties);
  if (!Number.isFinite(gevraagd) || gevraagd <= 0 || !Number.isFinite(basis) || basis <= 0 || gevraagd === basis) return lijst.map(i => ({...i}));
  const factor = gevraagd / basis;
  return lijst.map(i => ({...i, quantity:schaalHoeveelheidPerEenheid(i.quantity, factor, normaliseerEenheid(i.unit).eenheid)}));
}

// De grootste eenheid waarin een hoeveelheid nog netjes past.
function toonEenheid(eenheid, waarde) {
  if (eenheid === 'gram' && waarde >= 1000) return {unit:'kilogram', quantity:schaalHoeveelheid(waarde / 1000, 1)};
  if (eenheid === 'milliliter' && waarde >= 1000) return {unit:'liter', quantity:schaalHoeveelheid(waarde / 1000, 1)};
  if (eenheid === 'milliliter') return {unit:'milliliter', quantity:schaalHoeveelheid(waarde, 1)};
  return {unit:eenheid, quantity:schaalHoeveelheid(waarde, 1)};
}

function voegBoodschappenSamen(regels) {
  const per = new Map();
  for (const regel of regels || []) {
    const naam = String(regel?.name ?? '').trim();
    if (!naam) continue;
    const {eenheid, factor} = normaliseerEenheid(regel.unit);
    const sleutel = `${normaliseer(naam)}|${eenheid}`;
    const huidig = per.get(sleutel);
    const hoeveelheid = Number(regel.quantity || 1) * factor;
    const uit = regel.uit ? [regel.uit] : [];
    if (huidig) {
      huidig.basis += Number.isFinite(hoeveelheid) ? hoeveelheid : 0;
      huidig.uit.push(...uit);
    } else per.set(sleutel, {name:naam, eenheid, basis:Number.isFinite(hoeveelheid) ? hoeveelheid : 0, uit});
  }
  return [...per.values()].map(item => ({name:item.name, ...toonEenheid(item.eenheid, item.basis), ...(item.uit.length ? {uit:item.uit} : {})}));
}

// Tijden die in de bereiding genoemd worden, zodat de kookmodus er een timer
// bij kan zetten: 'Bak 3-4 minuten' levert 180 en 240 seconden op.
const TIJD_PATROON = /(\d+)\s*(?:(?:-|–|tot|to)\s*(\d+)\s*)?(uren|uur|minuten|minuut|min|seconden|seconde|sec)\b/gi;
const TIJD_FACTOR = {uren:3600, uur:3600, minuten:60, minuut:60, min:60, seconden:1, seconde:1, sec:1};
function parseStapTimers(tekst) {
  const seconden = [];
  for (const treffer of String(tekst ?? '').matchAll(TIJD_PATROON)) {
    const factor = TIJD_FACTOR[treffer[3].toLowerCase()] || 1;
    seconden.push(Number(treffer[1]) * factor);
    if (treffer[2]) seconden.push(Number(treffer[2]) * factor);
  }
  return seconden;
}

module.exports = {schaalHoeveelheidPerEenheid, normaliseer, woorden, kernWoord, bouwVoorraadIndex, ingredientInHuis, isBasisIngrediënt, ontbrekendVoorRecept, normaliseerEenheid, schaalHoeveelheid, schaalIngredienten, voegBoodschappenSamen, parseStapTimers, BASIS_WOORDEN};
