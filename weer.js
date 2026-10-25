// Het weer voor het kledingadvies. De verwachting komt van Open-Meteo: een
// openbare dienst zonder sleutel en zonder account. De app bewaart de plaats en
// de verwachting in de eigen database, zodat een advies niet bij elk verzoek
// opnieuw opgehaald wordt en zonder internet blijft doorwerken.
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const VERWACHTING = 'https://api.open-meteo.com/v1/forecast';

// Weercodes van de WMO, in het Nederlands.
const WEERCODES = new Map([[0,'onbewolkt'],[1,'licht bewolkt'],[2,'half bewolkt'],[3,'bewolkt'],[45,'mist'],[48,'mist met rijp'],[51,'motregen'],[53,'motregen'],[55,'stevige motregen'],[56,'ijzel'],[57,'ijzel'],[61,'regen'],[63,'regen'],[65,'zware regen'],[66,'ijzel'],[67,'ijzel'],[71,'sneeuw'],[73,'sneeuw'],[75,'zware sneeuw'],[77,'sneeuwkorrels'],[80,'buien'],[81,'buien'],[82,'zware buien'],[85,'sneeuwbuien'],[86,'sneeuwbuien'],[95,'onweer'],[96,'onweer met hagel'],[99,'onweer met hagel']]);

// Wat het weer betekent voor je kleding, in gewone taal.
// Getallen met een komma, zoals gebruikelijk in het Nederlands.
const nlGetal = waarde => String(waarde).replace('.', ',');

function weerAdvies(weer) {
  if (!weer) return {redenen:[], koud:false, warm:false, regen:false, windSterk:false, jasNodig:false};
  const regen = Number(weer.regenkans) >= 50;
  const koud = Number(weer.tempMax) <= 5;
  const fris = !koud && Number(weer.tempMax) <= 12;
  const warm = Number(weer.tempMax) >= 22;
  const windSterk = Number(weer.wind) >= 40;
  const redenen = [`Weer: ${nlGetal(weer.tempMax)} °C (min ${nlGetal(weer.tempMin)}), ${weer.regenkans}% kans op regen, wind ${nlGetal(weer.wind)} km/u — ${weer.omschrijving}`];
  if (regen) redenen.push('Kans op regen: neem een jas die tegen een bui kan en waterdicht schoeisel, geen suède of leer.');
  if (koud) redenen.push(`Het wordt niet warmer dan ${nlGetal(weer.tempMax)} °C: een warme jas en een extra laag.`);
  else if (fris) redenen.push(`Het blijft fris (${nlGetal(weer.tempMax)} °C): doe een jas of dikke trui aan.`);
  if (warm) redenen.push(`Het wordt ${nlGetal(weer.tempMax)} °C: lichte kleding, een jas kan thuisblijven.`);
  if (windSterk) redenen.push(`Het waait hard (${nlGetal(weer.wind)} km/u): kies een winddichte jas.`);
  return {redenen, koud, fris, warm, regen, windSterk, jasNodig:!warm, schoenenWaterdicht:regen};
}

function createWeer({db, fetchImpl = fetch, nu = () => new Date(), auto = true, ttlUren = 3}) {
  db.exec(`CREATE TABLE IF NOT EXISTS weer_instellingen(id INTEGER PRIMARY KEY CHECK(id=1), plaats TEXT NOT NULL DEFAULT '', land TEXT NOT NULL DEFAULT '', lat REAL, lon REAL, aan INTEGER NOT NULL DEFAULT 1, bijgewerkt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS weer_dagen(plaats TEXT NOT NULL, datum TEXT NOT NULL, temp_max REAL, temp_min REAL, regenkans INTEGER, wind REAL, code INTEGER, opgehaald TEXT NOT NULL, PRIMARY KEY(plaats,datum))`);

  function instellingen() {
    const rij = db.prepare('SELECT * FROM weer_instellingen WHERE id=1').get();
    if (!rij) return {plaats:'', land:'', lat:null, lon:null, aan:true};
    return {plaats:rij.plaats, land:rij.land, lat:rij.lat ?? null, lon:rij.lon ?? null, aan:Boolean(rij.aan)};
  }

  function bewaarRij(waarden) {
    const huidig = db.prepare('SELECT * FROM weer_instellingen WHERE id=1').get();
    const samen = {...(huidig || {plaats:'', land:'', lat:null, lon:null, aan:1}), ...waarden};
    db.prepare(`INSERT INTO weer_instellingen(id,plaats,land,lat,lon,aan,bijgewerkt) VALUES(1,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET plaats=excluded.plaats,land=excluded.land,lat=excluded.lat,lon=excluded.lon,aan=excluded.aan,bijgewerkt=excluded.bijgewerkt`)
      .run(samen.plaats ?? '', samen.land ?? '', samen.lat ?? null, samen.lon ?? null, samen.aan ? 1 : 0, new Date().toISOString().replace(/\.\d+Z$/, 'Z'));
  }

  async function zoekPlaats(naam) {
    try {
      const antwoord = await fetchImpl(`${GEOCODE}?name=${encodeURIComponent(naam)}&count=1&language=nl&format=json`);
      if (!antwoord || antwoord.ok === false) return null;
      const gegevens = await antwoord.json();
      const treffer = (gegevens?.results || [])[0];
      if (!treffer || !Number.isFinite(Number(treffer.latitude))) return null;
      return {plaats:treffer.name, land:treffer.country || '', lat:Number(treffer.latitude), lon:Number(treffer.longitude)};
    } catch {
      return null;
    }
  }

  async function bewaar({plaats, lat, lon, land} = {}) {
    if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))) {
      const naam = String(plaats || '').trim() || 'Eigen plek';
      bewaarRij({plaats:naam, land:String(land || ''), lat:Number(lat), lon:Number(lon)});
      return instellingen();
    }
    const naam = String(plaats ?? '').trim();
    if (!naam) throw Error('Vul een plaats in voor het weer.');
    if (naam.length > 60) throw Error('Die plaatsnaam is te lang.');
    const gevonden = await zoekPlaats(naam);
    if (!gevonden) throw Error(`De plaats "${naam}" kon ik niet vinden. Controleer de spelling, of er is geen verbinding met de plaatsendienst.`);
    bewaarRij(gevonden);
    return instellingen();
  }

  // De plaats wissen is iets anders dan het weer uitzetten: de instelling
  // blijft staan, alleen de verwachting verdwijnt.
  function wissen() {
    bewaarRij({plaats:'', land:'', lat:null, lon:null});
    return instellingen();
  }

  function zetAan(aan) {
    bewaarRij({aan:Boolean(aan)});
    return instellingen().aan;
  }

  function omschrijving(code) {
    return WEERCODES.get(Number(code)) || 'wisselvallig';
  }

  function uitRij(rij) {
    if (!rij) return null;
    return {datum:rij.datum, tempMax:rij.temp_max, tempMin:rij.temp_min, regenkans:rij.regenkans, wind:rij.wind, code:rij.code, omschrijving:omschrijving(rij.code), plaats:rij.plaats};
  }

  async function voorDatum(datum) {
    if (!auto) return null;
    const inst = instellingen();
    if (!inst.aan || !inst.plaats || inst.lat == null || inst.lon == null) return null;
    const bewaard = db.prepare('SELECT * FROM weer_dagen WHERE plaats=? AND datum=?').get(inst.plaats, datum);
    if (bewaard) {
      const ouder = (nu().getTime() - new Date(bewaard.opgehaald).getTime()) / 3600000;
      if (ouder < ttlUren) return uitRij(bewaard);
    }
    try {
      const adres = `${VERWACHTING}?latitude=${inst.lat}&longitude=${inst.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max,weathercode&timezone=Europe/Amsterdam&start_date=${datum}&end_date=${datum}`;
      const antwoord = await fetchImpl(adres);
      if (!antwoord || antwoord.ok === false) throw Error('geen antwoord');
      const gegevens = await antwoord.json();
      const dag = gegevens?.daily;
      const plek = (dag?.time || []).indexOf(datum);
      if (!dag || plek < 0) throw Error('dag niet gevonden');
      const rij = {
        plaats:inst.plaats, datum,
        temp_max:Number(dag.temperature_2m_max[plek]),
        temp_min:Number(dag.temperature_2m_min[plek]),
        regenkans:Number(dag.precipitation_probability_max?.[plek] ?? 0),
        wind:Number(dag.windspeed_10m_max?.[plek] ?? 0),
        code:Number(dag.weathercode?.[plek] ?? -1),
      };
      db.prepare(`INSERT INTO weer_dagen(plaats,datum,temp_max,temp_min,regenkans,wind,code,opgehaald) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(plaats,datum) DO UPDATE SET temp_max=excluded.temp_max,temp_min=excluded.temp_min,regenkans=excluded.regenkans,wind=excluded.wind,code=excluded.code,opgehaald=excluded.opgehaald`)
        .run(rij.plaats, rij.datum, rij.temp_max, rij.temp_min, rij.regenkans, rij.wind, rij.code, nu().toISOString());
      return uitRij(rij);
    } catch {
      // Geen verbinding of een onbruikbaar antwoord: dan liever een oude
      // verwachting of helemaal geen weer, zonder het advies te laten vallen.
      return uitRij(bewaard);
    }
  }

  return {instellingen, bewaar, zoekPlaats, zetAan, wissen, voorDatum, advies:weerAdvies, omschrijving};
}

module.exports = {createWeer, advies:weerAdvies, omschrijving:code => WEERCODES.get(Number(code)) || 'wisselvallig'};
