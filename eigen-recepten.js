'use strict';
// Eigen recepten: wat de gebruiker zelf in het receptenboek zet, met een foto,
// voedingswaarde per portie en dieetkeuzes. Ze staan in de eigen database en
// komen bij het opstarten naast de ingebouwde en geïmporteerde recepten te staan.
//
// Eigen recepten krijgen een eigen id-reeks (vanaf 900000), zodat ze nooit met de
// ingebouwde recepten (1–5) of de geïmporteerde recepten botsen. Een recept is
// alleen via deze module te wijzigen of te verwijderen: de meegeleverde recepten
// zijn niet aan te passen.
const fs = require('node:fs');
const path = require('node:path');

const ID_BASIS = 900000;
const MAX_NAAM = 120;
const MAX_LAND = 60;
const MAX_OMSCHRIJVING = 600;
const MAX_INGREDIENTEN = 80;
const MAX_STAPPEN = 60;
const MAX_STAP = 400;
const MAX_EENHEID = 24;
// De dieetkeuzes staan op één plek, zodat de app en de server dezelfde lijst gebruiken.
const DIETEN = [
  { id: 'vegetarisch', naam: 'Vegetarisch' },
  { id: 'veganistisch', naam: 'Veganistisch' },
  { id: 'glutenvrij', naam: 'Glutenvrij' },
  { id: 'lactosevrij', naam: 'Lactosevrij' },
  { id: 'notenvrij', naam: 'Notenvrij' },
];
const VOEDING = { kcal: 2000, eiwit: 500, koolhydraten: 500, vet: 500 };

function tekst(waarde, max) {
  return String(waarde ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function isEigenId(id) {
  return Number.isFinite(Number(id)) && Number(id) >= ID_BASIS;
}

function createEigenRecepten({ db, mediaDir }) {
  const MEDIA_DIR = mediaDir;
  db.exec(`CREATE TABLE IF NOT EXISTS eigen_recepten(
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    cuisine TEXT NOT NULL DEFAULT 'Nederland',
    description TEXT NOT NULL DEFAULT '',
    servings INTEGER,
    time INTEGER,
    ingredients TEXT NOT NULL DEFAULT '[]',
    steps TEXT NOT NULL DEFAULT '[]',
    dieet TEXT NOT NULL DEFAULT '',
    kcal REAL,
    eiwit REAL,
    koolhydraten REAL,
    vet REAL,
    foto TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);

  const leesLijst = (waarde) => {
    try { const uit = JSON.parse(waarde || '[]'); return Array.isArray(uit) ? uit : [] } catch { return [] }
  };

  // Een leeg voedingsveld blijft leeg; alleen een ingevuld getal telt.
  const getalOfNull = (waarde) => {
    if (waarde === null || waarde === undefined || waarde === '') return null;
    const getal = Number(waarde);
    return Number.isFinite(getal) ? getal : null;
  };

  // Database-rij naar hetzelfde recept-formaat als de rest van het boek.
  function naarRecept(rij) {
    if (!rij) return null;
    return {
      id: ID_BASIS + Number(rij.id),
      name: rij.name,
      cuisine: rij.cuisine,
      description: rij.description,
      servings: rij.servings ?? null,
      time: rij.time ?? null,
      ingredients: leesLijst(rij.ingredients),
      steps: leesLijst(rij.steps),
      dieet: rij.dieet ? rij.dieet.split(',').filter(Boolean) : [],
      voedingswaarde: { kcal: getalOfNull(rij.kcal), eiwit: getalOfNull(rij.eiwit), koolhydraten: getalOfNull(rij.koolhydraten), vet: getalOfNull(rij.vet) },
      foto: rij.foto || '',
      eigen: true,
    };
  }

  const rijId = (id) => Number(id) - ID_BASIS;

  function lijst() {
    return db.prepare('SELECT * FROM eigen_recepten ORDER BY name COLLATE NOCASE, id').all().map(naarRecept);
  }

  function leesGetal(waarde, { max, veld, decimaal = false }) {
    if (waarde === undefined || waarde === null || waarde === '') return null;
    const getal = Number(waarde);
    if (!Number.isFinite(getal) || getal < 0 || getal > max) throw Error(`Vul een ${veld} tussen 0 en ${max} in.`);
    return decimaal ? Math.round(getal * 10) / 10 : Math.round(getal);
  }

  // Controleert de invoer en levert de velden zoals ze opgeslagen worden.
  function leesInvoer(invoer = {}, bestaand = null) {
    const bron = bestaand || {};
    const name = tekst(invoer.name ?? bron.name, MAX_NAAM);
    if (!name) throw Error('Vul een naam in voor dit recept.');
    const cuisine = tekst(invoer.cuisine ?? bron.cuisine, MAX_LAND) || 'Nederland';
    const description = String(invoer.description ?? bron.description ?? '').trim().slice(0, MAX_OMSCHRIJVING);

    let servings = invoer.servings === undefined ? (bron.servings ?? null) : invoer.servings;
    if (servings === '' || servings === null || servings === undefined) servings = null;
    else {
      servings = Math.round(Number(servings));
      if (!Number.isFinite(servings) || servings < 1 || servings > 24) throw Error('Geef het aantal porties tussen 1 en 24 op.');
    }
    let time = invoer.time === undefined ? (bron.time ?? null) : invoer.time;
    if (time === '' || time === null || time === undefined) time = null;
    else {
      time = Math.round(Number(time));
      if (!Number.isFinite(time) || time < 0 || time > 1440) throw Error('Geef de bereidingstijd in minuten op (0–1440).');
    }

    const ingredientenBron = invoer.ingredients === undefined ? (bestaand ? bestaand.ingredients : []) : invoer.ingredients;
    if (!Array.isArray(ingredientenBron)) throw Error('De ingrediënten horen als lijst te komen.');
    if (ingredientenBron.length > MAX_INGREDIENTEN) throw Error(`Een recept kan maximaal ${MAX_INGREDIENTEN} ingrediënten hebben.`);
    const ingredients = ingredientenBron.map((ruw) => {
      const naam = tekst(ruw && ruw.name, 80);
      if (!naam) throw Error('Elk ingrediënt heeft een naam nodig.');
      const quantity = Number(ruw && ruw.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000) throw Error(`Vul een hoeveelheid tussen 0 en 100000 in bij ${naam}.`);
      const unitRuw = String((ruw && ruw.unit) ?? '').replace(/\s+/g, ' ').trim();
      const unit = unitRuw || 'stuks';
      if (unit.length > MAX_EENHEID) throw Error(`De eenheid bij ${naam} is te lang (maximaal ${MAX_EENHEID} tekens).`);
      return { name: naam, quantity, unit };
    });

    const stappenBron = invoer.steps === undefined ? (bestaand ? bestaand.steps : []) : invoer.steps;
    if (!Array.isArray(stappenBron)) throw Error('De bereiding hoort als lijst met stappen te komen.');
    if (stappenBron.length > MAX_STAPPEN) throw Error(`Een recept kan maximaal ${MAX_STAPPEN} stappen hebben.`);
    const steps = stappenBron.map((stap) => {
      const schoon = String(stap ?? '').replace(/\s+/g, ' ').trim();
      if (!schoon) throw Error('Elke stap in de bereiding heeft tekst nodig.');
      return schoon.slice(0, MAX_STAP);
    });

    const dieetBron = invoer.dieet === undefined ? (bestaand ? bestaand.dieet : []) : invoer.dieet;
    if (!Array.isArray(dieetBron)) throw Error('De dieetkeuzes horen als lijst te komen.');
    const dieet = [...new Set(dieetBron.map((keuze) => tekst(keuze, 40).toLowerCase()).filter(Boolean))];
    const onbekend = dieet.filter((keuze) => !DIETEN.some((d) => d.id === keuze));
    if (onbekend.length) throw Error(`Onbekende dieetkeuze: ${onbekend.join(', ')}. Kies uit ${DIETEN.map((d) => d.id).join(', ')}.`);

    const voedingBron = invoer.voedingswaarde === undefined ? {} : invoer.voedingswaarde;
    if (voedingBron && typeof voedingBron !== 'object') throw Error('De voedingswaarde hoort als getallen te komen.');
    // Wat je niet meestuurt blijft staan: een leeg veld wist de waarde niet.
    const bronVoeding = { ...((bestaand && bestaand.voedingswaarde) || {}), ...(voedingBron || {}) };
    const voedingswaarde = {
      kcal: leesGetal(bronVoeding.kcal, { max: VOEDING.kcal, veld: 'voedingswaarde (kcal per portie)' }),
      eiwit: leesGetal(bronVoeding.eiwit, { max: VOEDING.eiwit, veld: 'voedingswaarde (gram eiwit per portie)', decimaal: true }),
      koolhydraten: leesGetal(bronVoeding.koolhydraten, { max: VOEDING.koolhydraten, veld: 'voedingswaarde (gram koolhydraten per portie)', decimaal: true }),
      vet: leesGetal(bronVoeding.vet, { max: VOEDING.vet, veld: 'voedingswaarde (gram vet per portie)', decimaal: true }),
    };

    return { name, cuisine, description, servings, time, ingredients, steps, dieet, voedingswaarde, foto: bron.foto || '' };
  }

  function bewaar(id, velden) {
    db.prepare(`UPDATE eigen_recepten SET name=?,cuisine=?,description=?,servings=?,time=?,ingredients=?,steps=?,dieet=?,kcal=?,eiwit=?,koolhydraten=?,vet=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(velden.name, velden.cuisine, velden.description, velden.servings, velden.time,
        JSON.stringify(velden.ingredients), JSON.stringify(velden.steps), velden.dieet.join(','),
        velden.voedingswaarde.kcal, velden.voedingswaarde.eiwit, velden.voedingswaarde.koolhydraten, velden.voedingswaarde.vet, rijId(id));
  }

  function maak(invoer) {
    const velden = leesInvoer(invoer);
    const uitkomst = db.prepare(`INSERT INTO eigen_recepten(name,cuisine,description,servings,time,ingredients,steps,dieet,kcal,eiwit,koolhydraten,vet)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(velden.name, velden.cuisine, velden.description, velden.servings, velden.time,
        JSON.stringify(velden.ingredients), JSON.stringify(velden.steps), velden.dieet.join(','),
        velden.voedingswaarde.kcal, velden.voedingswaarde.eiwit, velden.voedingswaarde.koolhydraten, velden.voedingswaarde.vet);
    return naarRecept(db.prepare('SELECT * FROM eigen_recepten WHERE id=?').get(Number(uitkomst.lastInsertRowid)));
  }

  function wijzig(id, invoer) {
    if (!isEigenId(id)) return null;
    const bestaand = naarRecept(db.prepare('SELECT * FROM eigen_recepten WHERE id=?').get(rijId(id)));
    if (!bestaand) return null;
    const velden = leesInvoer(invoer, bestaand);
    bewaar(id, velden);
    return naarRecept(db.prepare('SELECT * FROM eigen_recepten WHERE id=?').get(rijId(id)));
  }

  function verwijder(id) {
    if (!isEigenId(id)) return false;
    const rij = db.prepare('SELECT foto FROM eigen_recepten WHERE id=?').get(rijId(id));
    if (!rij) return false;
    db.prepare('DELETE FROM eigen_recepten WHERE id=?').run(rijId(id));
    if (rij.foto) {
      try { fs.rmSync(path.join(MEDIA_DIR, path.basename(rij.foto)), { force: true }); } catch { /* foto mag ontbreken */ }
    }
    return true;
  }

  // De foto komt als base64 binnen; het soort bestand leiden we uit de inhoud af,
  // zodat een verkeerd bestandstype nooit als foto in de map belandt.
  function bewaarFoto(id, data) {
    if (!isEigenId(id)) throw Error('Dit recept staat niet in je eigen recepten.');
    const recept = db.prepare('SELECT id FROM eigen_recepten WHERE id=?').get(rijId(id));
    if (!recept) throw Error('Dit recept staat niet in je eigen recepten.');
    if (typeof data !== 'string' || !data.trim()) throw Error('Kies een foto van maximaal 4 MB (JPEG, PNG of WebP).');
    const beeld = Buffer.from(data.replace(/^data:[^,]+,/, ''), 'base64');
    if (beeld.length < 100) throw Error('De foto lijkt leeg.');
    if (beeld.length > 4_000_000) throw Error('Kies een foto van maximaal 4 MB (JPEG, PNG of WebP).');
    const soort = beeld[0] === 0xff && beeld[1] === 0xd8 && beeld[2] === 0xff ? 'jpg'
      : beeld[0] === 0x89 && beeld[1] === 0x50 && beeld[2] === 0x4e ? 'png'
        : beeld.subarray(0, 4).toString('ascii') === 'RIFF' ? 'webp' : null;
    if (!soort) throw Error('De foto moet een JPEG-, PNG- of WebP-afbeelding zijn.');
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const bestand = `recept-${rijId(id)}.${soort}`;
    fs.writeFileSync(path.join(MEDIA_DIR, bestand), beeld);
    const url = `/media/${bestand}`;
    db.prepare('UPDATE eigen_recepten SET foto=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(url, rijId(id));
    return url;
  }

  // Bestaat dit eigen recept? De routes gebruiken dit om 404 van 400 te onderscheiden.
  function heeft(id) {
    if (!isEigenId(id)) return false;
    return Boolean(db.prepare('SELECT 1 FROM eigen_recepten WHERE id=?').get(rijId(id)));
  }

  return { lijst, maak, wijzig, verwijder, bewaarFoto, naarRecept, heeft, isEigenId, ID_BASIS, DIETEN };
}

module.exports = { createEigenRecepten, DIETEN, ID_BASIS, isEigenId };
