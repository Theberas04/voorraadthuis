// Platen: de lp-collectie van het huis. Een plaat wordt toegevoegd door de barcode te
// scannen of te typen; de app zoekt de uitgave op in MusicBrainz (open data, CC0) en haalt
// de hoes bij het Cover Art Archive. Alles wat gevonden is wordt lokaal bewaard, zodat een
// tweede scan meteen goed gaat en de collectie ook zonder internet te bekijken is.
const { URL } = require('node:url');

const UA = 'VoorraadThuis/1.0 (self-hosted huishoudapp; https://github.com/Theberas04/voorraadthuis)';
const MB_BASIS = () => process.env.PLATEN_MB_BASIS || 'https://musicbrainz.org/ws/2';
const CAA_BASIS = () => process.env.PLATEN_CAA_BASIS || 'https://coverartarchive.org';
// Hoe lang een opzoeking geldig blijft voordat we het opnieuw proberen (dertig dagen).
const CACHE_DAGEN = Number(process.env.PLATEN_CACHE_DAGEN || 30);
const MAX_TEKST = 160;
const path = require('node:path');
const fs = require('node:fs');

function leeg(tekst, max = MAX_TEKST) {
  return String(tekst == null ? '' : tekst).trim().slice(0, max);
}

// Barcodes staan in de databank soms met en soms zonder voorloopnullen; probeer de
// varianten die hetzelfde product aanwijzen.
function barcodeVarianten(code) {
  const cijfers = String(code || '').replace(/\D/g, '');
  const varianten = new Set();
  if (cijfers.length === 11) {
    const totaal = [...cijfers].reduce((som, cijfer, index) => som + Number(cijfer) * ((cijfers.length - index) % 2 ? 3 : 1), 0);
    varianten.add(`${cijfers}${(10 - totaal % 10) % 10}`);
  }
  varianten.add(cijfers);
  if (cijfers) {
    varianten.add(cijfers.replace(/^0+/, ''));
    varianten.add(cijfers.padStart(13, '0'));
    varianten.add(cijfers.replace(/^0+/, '').padStart(12, '0'));
  }
  varianten.delete('');
  return [...varianten];
}

function jaarVan(datum) {
  const m = String(datum || '').match(/(\d{4})/);
  return m ? m[1] : '';
}

function artiestVan(uitgave) {
  const krediet = uitgave['artist-credit'];
  if (!Array.isArray(krediet) || !krediet.length) return '';
  return krediet.map(deel => `${deel.name || (deel.artist && deel.artist.name) || ''}${deel.joinphrase || ''}`).join('').trim();
}

function formaatVan(uitgave) {
  const media = (uitgave.media || [])[0] || {};
  const stukken = media.format ? media.format : '';
  const aantal = Number(media['track-count'] || 0);
  const delen = [];
  if (stukken) delen.push(stukken.replace(/"/g, ' inch'));
  if (aantal > 0) delen.push(`${aantal} nummers`);
  return delen.join(' · ');
}

function typeVan(uitgave) {
  const groep = uitgave['release-group'] || {};
  return [groep['primary-type'], ...(groep['secondary-types'] || [])].filter(Boolean).join(' · ');
}

function kiesUitgave(uitgaven) {
  if (!Array.isArray(uitgaven) || !uitgaven.length) return null;
  const score = (u) => {
    let punten = Number(u.score || 0);
    if (jaarVan(u.date)) punten += 5;
    if ((u['label-info'] || []).length) punten += 3;
    const formaat = formaatVan(u).toLowerCase();
    if (formaat.includes('vinyl') || formaat.includes('inch')) punten += 4;
    if (u.country) punten += 1;
    return punten;
  };
  return [...uitgaven].sort((a, b) => score(b) - score(a))[0];
}

function createPlaten({ db, mediaDir, fetchImpl = fetch, nu = () => new Date() }) {
  db.exec(`CREATE TABLE IF NOT EXISTS platen(
      id INTEGER PRIMARY KEY,
      barcode TEXT NOT NULL DEFAULT '',
      titel TEXT NOT NULL,
      artiest TEXT NOT NULL DEFAULT '',
      jaar TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL DEFAULT '',
      formaat TEXT NOT NULL DEFAULT '',
      genre TEXT NOT NULL DEFAULT '',
      hoes TEXT NOT NULL DEFAULT '',
      locatie TEXT NOT NULL DEFAULT '',
      notitie TEXT NOT NULL DEFAULT '',
      aantal INTEGER NOT NULL DEFAULT 1,
      prijs REAL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS platen_locatie ON platen(locatie);
    CREATE TABLE IF NOT EXISTS plaat_cache(
      barcode TEXT PRIMARY KEY,
      titel TEXT NOT NULL DEFAULT '',
      artiest TEXT NOT NULL DEFAULT '',
      jaar TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL DEFAULT '',
      formaat TEXT NOT NULL DEFAULT '',
      genre TEXT NOT NULL DEFAULT '',
      hoes TEXT NOT NULL DEFAULT '',
      mbid TEXT NOT NULL DEFAULT '',
      gevonden INTEGER NOT NULL DEFAULT 0,
      fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

  // Oude installaties krijgen zonder dataverlies een statusveld voor de verlanglijst.
  try { db.exec("ALTER TABLE platen ADD COLUMN gewenst INTEGER NOT NULL DEFAULT 0") } catch { /* bestaat al */ }
  try { db.exec('ALTER TABLE platen ADD COLUMN prijs REAL') } catch { /* bestaat al */ }

  // Een lokale tabel met lp-barcodes uit MusicBrainz (open data, CC0). Zo wordt een
  // gescande plaat ook zonder internet meteen herkend. De tabel wordt uit het bestand in
  // de database gezet en blijft daar staan: zoeken op barcode is daarna indexwerk en het
  // bestand hoeft niet bij elke scan in het geheugen te staan.
  db.exec(`CREATE TABLE IF NOT EXISTS lp_barcodes(
      barcode TEXT PRIMARY KEY,
      titel TEXT NOT NULL DEFAULT '',
      artiest TEXT NOT NULL DEFAULT '',
      jaar TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL DEFAULT '',
      formaat TEXT NOT NULL DEFAULT '',
      mbid TEXT NOT NULL DEFAULT '',
      groep TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS lp_meta(
      sleutel TEXT PRIMARY KEY,
      waarde TEXT NOT NULL DEFAULT ''
    )`);

  const lpBestand = () => process.env.PLATEN_TABEL || path.join(__dirname, 'product-data', 'lp-barcodes.json');
  const meta = (sleutel) => (db.prepare('SELECT waarde FROM lp_meta WHERE sleutel=?').get(sleutel) || {}).waarde || '';
  const zetMeta = (sleutel, waarde) => db.prepare('INSERT INTO lp_meta(sleutel,waarde) VALUES(?,?) ON CONFLICT(sleutel) DO UPDATE SET waarde=excluded.waarde').run(sleutel, String(waarde));
  // De tabel vullen of bijwerken als het bestand nieuwer is dan wat er in de database staat.
  // De vingerafdruk wordt bij elke opzoeking even nagekeken (dat is een stat en twee kleine
  // opzoekingen), zodat een bijgewerkte lijst ook zonder herstart wordt ingelezen.
  function zorgVoorTabel() {
    if (process.env.PLATEN_TABEL === '0') return;
    let kenmerk;
    try { const s = fs.statSync(lpBestand()); kenmerk = `${s.size}:${Math.round(s.mtimeMs)}`; } catch { return }
    if (meta('lp_bestand') === lpBestand() && meta('lp_kenmerk') === kenmerk) return;
    let gegevens;
    try { gegevens = JSON.parse(fs.readFileSync(lpBestand(), 'utf8')); } catch { return }
    const rijen = Object.entries(gegevens).filter(([, rij]) => rij && rij.t);
    if (!rijen.length) return;
    const invoegen = db.prepare('INSERT OR REPLACE INTO lp_barcodes(barcode,titel,artiest,jaar,label,formaat,mbid,groep) VALUES(?,?,?,?,?,?,?,?)');
    db.exec('BEGIN');
    try {
      db.exec('DELETE FROM lp_barcodes');
      for (const [code, rij] of rijen) {
        invoegen.run(code, rij.t || '', rij.a || '', rij.j || '', rij.l || '', rij.f || '', rij.m || '', rij.g || '');
      }
      zetMeta('lp_bestand', lpBestand());
      zetMeta('lp_kenmerk', kenmerk);
      zetMeta('lp_aantal', rijen.length);
      db.exec('COMMIT');
    } catch {
      try { db.exec('ROLLBACK') } catch { /* niets */ }
    }
  }

  const uitTabel = (code) => {
    zorgVoorTabel();
    const ophalen = db.prepare('SELECT * FROM lp_barcodes WHERE barcode=?');
    for (const variant of barcodeVarianten(code)) {
      const rij = ophalen.get(variant);
      if (rij) return { ...rij, barcode: variant };
    }
    return null;
  };
  const aantalInTabel = () => {
    zorgVoorTabel();
    return db.prepare('SELECT COUNT(*) AS n FROM lp_barcodes').get().n;
  };

  // Hoezen worden één keer gedownload en daarna uit de eigen opslag geserveerd; zo blijft
  // de verzameling ook zonder internet compleet en laadt hij op een telefoon meteen.
  const hoesMap = () => path.join(mediaDir || path.dirname(process.env.DB_PATH || './data/voorraad.db'), 'platen');
  try { db.exec("ALTER TABLE platen ADD COLUMN hoes_bron TEXT NOT NULL DEFAULT ''") } catch { /* bestaat al */ }

  function bewaarHoes(id) {
    const plaat = db.prepare('SELECT id,hoes,hoes_bron FROM platen WHERE id=?').get(Number(id));
    if (!plaat) return;
    const bron = plaat.hoes_bron || plaat.hoes;
    if (!/^https?:\/\//i.test(bron)) return;
    if (plaat.hoes_bron !== bron) db.prepare('UPDATE platen SET hoes_bron=? WHERE id=?').run(bron, Number(id));
    if (/^\/api\/platen\/hoes\//.test(plaat.hoes)) return;   // al lokaal
    const map = hoesMap();
    try { fs.mkdirSync(map, { recursive: true }) } catch { return }
    const doel = path.join(map, `${id}.jpg`);
    fetchImpl(bron, { headers: { 'user-agent': UA } })
      .then(async (antwoord) => {
        if (!antwoord.ok) return;
        const soort = String(antwoord.headers.get('content-type') || '');
        if (!soort.startsWith('image/')) return;
        const inhoud = Buffer.from(await antwoord.arrayBuffer());
        if (inhoud.length < 500 || inhoud.length > 6_000_000) return;
        fs.writeFileSync(doel, inhoud);
        db.prepare('UPDATE platen SET hoes=? WHERE id=?').run(`/api/platen/hoes/${id}`, Number(id));
      })
      .catch(() => { /* zonder hoes verder */ });
  }

  function serveerHoes(res, id) {
    const plaat = db.prepare('SELECT hoes,hoes_bron FROM platen WHERE id=?').get(Number(id));
    if (!plaat) { res.writeHead(404); return res.end('Geen hoes'); }
    const bestand = path.join(hoesMap(), `${Number(id)}.jpg`);
    if (!fs.existsSync(bestand)) { res.writeHead(404); return res.end('Geen hoes'); }
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=604800' });
    fs.createReadStream(bestand).pipe(res);
  }

  const rij = (r) => ({
    id: r.id,
    barcode: r.barcode,
    titel: r.titel,
    artiest: r.artiest,
    jaar: r.jaar,
    label: r.label,
    formaat: r.formaat,
    genre: r.genre,
    hoes: r.hoes,
    locatie: r.locatie,
    notitie: r.notitie,
    aantal: r.aantal,
    gewenst: !!r.gewenst,
    prijs: r.prijs == null ? null : Number(r.prijs),
  });

  const lijst = (locatie, gewenst = false) => {
    const sql = gewenst
      ? 'SELECT * FROM platen WHERE gewenst=1 ORDER BY artiest COLLATE NOCASE, titel COLLATE NOCASE'
      : locatie
        ? 'SELECT * FROM platen WHERE gewenst=0 AND locatie=? ORDER BY artiest COLLATE NOCASE, titel COLLATE NOCASE'
        : 'SELECT * FROM platen WHERE gewenst=0 ORDER BY artiest COLLATE NOCASE, titel COLLATE NOCASE';
    const rijen = locatie && !gewenst ? db.prepare(sql).all(locatie) : db.prepare(sql).all();
    return rijen.map(rij);
  };

  const locaties = () => db.prepare(`SELECT locatie AS naam, COUNT(*) AS aantal FROM platen
      WHERE gewenst=0 GROUP BY locatie ORDER BY (locatie='') DESC, locatie COLLATE NOCASE`).all()
    .map(r => ({ naam: r.naam || 'Zonder locatie', sleutel: r.naam, aantal: r.aantal }));

  // Waar staat iets: dezelfde waarde met verschillende spaties of hoofdletters hoort bij
  // elkaar. Zo filtert "the beatles" ook op "The Beatles".
  const gelijk = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  const jaarGetal = (p) => {
    const m = String(p.jaar || '').match(/\d{4}/);
    return m ? Number(m[0]) : null;
  };
  const decenniumVan = (p) => {
    const jaar = jaarGetal(p);
    return jaar === null ? null : Math.floor(jaar / 10) * 10;
  };
  const ONBEKEND = 'onbekend';

  // De keuzelijsten komen uit de hele verzameling (niet uit wat er nu gefilterd is),
  // zodat een keuze nooit zijn eigen opties kwijtraakt.
  function keuzelijsten() {
    const rijen = db.prepare('SELECT genre, artiest, jaar FROM platen WHERE gewenst=0').all();
    const tel = (kies) => {
      const map = new Map();
      for (const r of rijen) {
        const waarde = kies(r);
        if (waarde === null || waarde === undefined || waarde === '') continue;
        map.set(waarde, (map.get(waarde) || 0) + 1);
      }
      return [...map].map(([naam, aantal]) => ({ naam, aantal }))
        .sort((a, b) => b.aantal - a.aantal || String(a.naam).localeCompare(String(b.naam), 'nl'));
    };
    const decennia = tel((r) => {
      const m = String(r.jaar || '').match(/\d{4}/);
      return m ? Math.floor(Number(m[0]) / 10) * 10 : null;
    }).map((d) => ({ naam: String(d.naam), label: `${d.naam} – ${Number(d.naam) + 9}`, aantal: d.aantal }));
    const genres = tel((r) => String(r.genre || '').trim());
    const artiesten = tel((r) => String(r.artiest || '').trim());
    const zonderJaar = rijen.filter((r) => !/\d{4}/.test(String(r.jaar || ''))).length;
    const zonderGenre = rijen.filter((r) => !String(r.genre || '').trim()).length;
    if (zonderJaar) decennia.push({ naam: ONBEKEND, label: 'Jaar onbekend', aantal: zonderJaar });
    if (zonderGenre) genres.push({ naam: ONBEKEND, label: 'Genre onbekend', aantal: zonderGenre });
    return { genres, artiesten, decennia, locaties: locaties() };
  }

  // Filteren: locatie (via de database), genre, artiest, decennium of jaar van–tot, en
  // een zoekterm over alles heen. Alles wat je combineert, geldt tegelijk.
  function zeef({ locatie, genre, artiest, decennium, van, tot, zoekterm, gewenst }) {
    let rijen = lijst(locatie === '' || locatie === undefined ? undefined : locatie, !!gewenst);
    if (locatie === 'leeg') rijen = rijen.filter((p) => !p.locatie);
    if (genre) rijen = rijen.filter((p) => genre === ONBEKEND ? !String(p.genre || '').trim() : gelijk(p.genre, genre));
    if (artiest) rijen = rijen.filter((p) => artiest === ONBEKEND ? !String(p.artiest || '').trim() : gelijk(p.artiest, artiest));
    if (decennium) {
      rijen = rijen.filter((p) => decennium === ONBEKEND ? decenniumVan(p) === null : decenniumVan(p) === Number(decennium));
    }
    if (van !== null && van !== undefined && van !== '') rijen = rijen.filter((p) => { const j = jaarGetal(p); return j !== null && j >= Number(van); });
    if (tot !== null && tot !== undefined && tot !== '') rijen = rijen.filter((p) => { const j = jaarGetal(p); return j !== null && j <= Number(tot); });
    if (zoekterm) {
      rijen = rijen.filter((p) => `${p.titel} ${p.artiest} ${p.jaar} ${p.label} ${p.formaat} ${p.genre} ${p.locatie} ${p.notitie}`.toLowerCase().includes(zoekterm));
    }
    return rijen;
  }

  const antwoord = (rijen, filters) => {
    const prijsStat = db.prepare('SELECT AVG(prijs) AS gemiddelde, COUNT(prijs) AS aantal FROM platen WHERE gewenst=1 AND prijs IS NOT NULL').get();
    return {
      platen: rijen,
      totaal: rijen.length,
      locaties: locaties(),
      stuks: rijen.reduce((som, p) => som + (Number(p.aantal) || 0), 0),
      gemiddeldePrijs: prijsStat.aantal ? Math.round(Number(prijsStat.gemiddelde) * 100) / 100 : null,
      prijsAantal: prijsStat.aantal,
      keuzelijsten: keuzelijsten(),
      filters,
    };
  };

  const alles = () => antwoord(lijst(), {});

  function bewaarCache(code, gegevens) {
    db.prepare(`INSERT INTO plaat_cache(barcode,titel,artiest,jaar,label,formaat,genre,hoes,mbid,gevonden,fetched_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(barcode) DO UPDATE SET titel=excluded.titel,artiest=excluded.artiest,jaar=excluded.jaar,
          label=excluded.label,formaat=excluded.formaat,genre=excluded.genre,hoes=excluded.hoes,
          mbid=excluded.mbid,gevonden=excluded.gevonden,fetched_at=CURRENT_TIMESTAMP`)
      .run(code, gegevens.titel || '', gegevens.artiest || '', gegevens.jaar || '', gegevens.label || '',
        gegevens.formaat || '', gegevens.genre || '', gegevens.hoes || '', gegevens.mbid || '',
        gegevens.gevonden ? 1 : 0);
  }

  function leesCache(code) {
    const r = db.prepare('SELECT * FROM plaat_cache WHERE barcode=?').get(code);
    if (!r) return null;
    const ouderdom = (nu().getTime() - new Date(`${r.fetched_at.replace(' ', 'T')}Z`).getTime()) / 86400000;
    return {
      barcode: code,
      titel: r.titel,
      artiest: r.artiest,
      jaar: r.jaar,
      label: r.label,
      formaat: r.formaat,
      genre: r.genre,
      hoes: r.hoes,
      mbid: r.mbid,
      gevonden: !!r.gevonden,
      verouderd: !(ouderdom < CACHE_DAGEN),
      cached: true,
    };
  }

  // MusicBrainz staat ongeveer één verzoek per seconde toe; te snel achter elkaar geeft
  // een 503. Daarom houden we zelf de maat en proberen we het één keer opnieuw.
  let laatsteVraag = 0;
  async function wachtOpMaat() {
    const wachttijd = 1200 - (Date.now() - laatsteVraag);
    if (wachttijd > 0) await new Promise(r => setTimeout(r, wachttijd));
    laatsteVraag = Date.now();
  }

  async function vraagJson(adres) {
    await wachtOpMaat();
    const antwoord = await fetchImpl(adres, { headers: { 'user-agent': UA, accept: 'application/json' } });
    if (!antwoord.ok) return null;
    return antwoord.json();
  }

  // De hoes bij het Cover Art Archive: de voorplaat als die er is, anders de eerste afbeelding.
  async function hoesBij(mbid) {
    if (!mbid) return '';
    const gegevens = await vraagJson(`${CAA_BASIS()}/release/${mbid}`);
    if (!gegevens || !Array.isArray(gegevens.images) || !gegevens.images.length) return '';
    const voorkant = gegevens.images.find(i => i.front) || gegevens.images[0];
    const maten = voorkant.thumbnails || {};
    return maten.large || maten['500'] || maten.small || voorkant.image || '';
  }

  // Het echte genre (rock, jazz, pop) staat in MusicBrainz bij de uitgave-groep, niet bij
  // de uitgave zelf. Lukt dat niet, dan valt het terug op het soort uitgave (Album, Single).
  const netjes = (t) => { const w = leeg(t, 60); return w ? w.charAt(0).toUpperCase() + w.slice(1) : ''; };
  async function genreBij(uitgave) {
    const soort = typeVan(uitgave) || '';
    const groep = uitgave['release-group'] && uitgave['release-group'].id;
    if (!groep) return soort;
    let gegevens = null;
    try { gegevens = await vraagJson(`${MB_BASIS()}/release-group/${groep}?inc=genres+tags&fmt=json`); } catch { gegevens = null }
    const kies = (lijst) => (Array.isArray(lijst) ? lijst : [])
      .filter((g) => g && g.name).sort((a, b) => (b.count || 0) - (a.count || 0));
    const genres = kies(gegevens && gegevens.genres);
    if (genres.length) return netjes(genres[0].name);
    const tags = kies(gegevens && gegevens.tags);
    if (tags.length) return netjes(tags[0].name);
    return soort;
  }

  async function zoekOnline(code) {
    let storing = false;
    for (const variant of barcodeVarianten(code)) {
      const adres = `${MB_BASIS()}/release/?query=${encodeURIComponent(`barcode:${variant}`)}&fmt=json&limit=10`;
      let gegevens;
      try {
        gegevens = await vraagJson(adres);
        if (gegevens === null) {
          // Even te druk bij de databank: één keer opnieuw, met wat meer rust.
          await new Promise(r => setTimeout(r, 1500));
          laatsteVraag = 0;
          gegevens = await vraagJson(adres);
        }
      } catch {
        return { gevonden: false, storing: true, barcode: code };
      }
      // Geen antwoord van de databank (bijvoorbeeld een storing): niet als 'onbekend'
      // wegschrijven, want dan zou een latere scan het niet meer proberen.
      if (gegevens === null) {
        storing = true;
        break;
      }
      const uitgave = kiesUitgave(gegevens.releases);
      if (!uitgave) continue;
      const labelInfo = (uitgave['label-info'] || [])[0] || {};
      const hoes = await hoesBij(uitgave.id).catch(() => '');
      return {
        gevonden: true,
        barcode: variant,
        mbid: uitgave.id || '',
        titel: leeg(uitgave.title),
        artiest: leeg(artiestVan(uitgave)),
        jaar: jaarVan(uitgave.date),
        label: leeg((labelInfo.label && labelInfo.label.name) || labelInfo['catalog-number'] || ''),
        formaat: leeg(formaatVan(uitgave)),
        genre: leeg(await genreBij(uitgave).catch(() => '')) || leeg(typeVan(uitgave) || uitgave.country || ''),
        hoes,
        bron: 'MusicBrainz',
        licentie: 'CC0 1.0',
        bronUrl: uitgave.id ? `https://musicbrainz.org/release/${uitgave.id}` : '',
      };
    }
    return { gevonden: false, barcode: code, storing };
  }

  // Een treffer in de eigen tabel: meteen antwoord, zonder internet. De hoes halen we
  // gewoon bij het Cover Art Archive op het moment dat de plaat in de verzameling komt.
  function uitEigenTabel(code) {
    const rij = uitTabel(code);
    if (!rij) return null;
    const correctie = rij.groep === 'handmatige-correctie';
    return {
      gevonden: true,
      barcode: rij.barcode || code,
      titel: rij.titel,
      artiest: rij.artiest,
      jaar: rij.jaar,
      label: rij.label,
      formaat: rij.formaat,
      genre: '',
      hoes: rij.mbid ? `${CAA_BASIS()}/release/${rij.mbid}/front-500.jpg` : '',
      mbid: rij.mbid,
      bron: correctie ? 'Gecorrigeerde barcodevermelding' : 'MusicBrainz (eigen lp-lijst)',
      licentie: correctie ? '' : 'CC0 1.0',
      bronUrl: correctie
        ? 'https://codarecords.co.uk/products/elton-john-bbc-sessions-1970-limited-edition-clear-vinyl'
        : rij.mbid ? `https://musicbrainz.org/release/${rij.mbid}` : '',
      uitEigenLijst: true,
      correctie,
      cached: false,
    };
  }

  async function zoek(code, { force = false } = {}) {
    const schoon = String(code || '').replace(/\D/g, '');
    if (schoon.length < 8 || schoon.length > 14) {
      return { gevonden: false, barcode: schoon, reason: 'ongeldig', message: 'Een barcode hoort uit 8 tot 14 cijfers te bestaan.' };
    }
    const eigen = uitEigenTabel(schoon);
    // Een expliciete correctie of genormaliseerde barcode is leidend; geen cache met de
    // oorspronkelijke (onvolledige) code mag die treffer overschrijven.
    if (eigen && (eigen.correctie || eigen.barcode !== schoon)) return eigen;
    const bewaard = leesCache(schoon);
    if (bewaard && !force && !bewaard.verouderd) return { ...bewaard, cached: true };
    // De algemene offline-lijst respecteren we na de cachecheck; force=1 kan die overslaan.
    if (!force && eigen) return eigen;
    const vers = await zoekOnline(schoon);
    if (vers.storing) {
      if (bewaard) return { ...bewaard, cached: true, storing: true };
      return { gevonden: false, barcode: schoon, reason: 'storing', message: 'De databank is even niet bereikbaar. Typ de gegevens zelf in; met “Opnieuw zoeken” probeer je het nog eens.' };
    }
    bewaarCache(schoon, vers);
    return { ...vers, cached: false };
  }

  function leesPrijs(waarde) {
    if (waarde == null || waarde === '') return null;
    const prijs = Number(String(waarde).trim().replace(',', '.'));
    if (!Number.isFinite(prijs) || prijs < 0 || prijs > 100000) throw Error('Vul een richtprijs tussen €0 en €100.000 in.');
    return Math.round(prijs * 100) / 100;
  }

  function voegToe(invoer) {
    const titel = leeg(invoer.titel);
    if (!titel) throw Error('Vul in elk geval de titel van de plaat in.');
    const aantal = invoer.aantal === '' || invoer.aantal == null ? 1 : Math.round(Number(invoer.aantal));
    if (!Number.isFinite(aantal) || aantal < 1 || aantal > 99) throw Error('Geef een aantal tussen 1 en 99 op.');
    const barcode = leeg(invoer.barcode, 20).replace(/\D/g, '');
    const locatie = leeg(invoer.locatie, 60);
    const gegevens = {
      barcode,
      titel,
      artiest: leeg(invoer.artiest),
      jaar: leeg(invoer.jaar, 12),
      label: leeg(invoer.label),
      formaat: leeg(invoer.formaat),
      genre: leeg(invoer.genre, 80),
      hoes: leeg(invoer.hoes, 400),
      locatie,
      notitie: leeg(invoer.notitie, 300),
      aantal,
      prijs: leesPrijs(invoer.prijs),
      gewenst: invoer.gewenst === true || Number(invoer.gewenst) === 1,
    };
    // Een gewenste barcode wordt één keer bijgehouden; hem later toevoegen aan bezit
    // promoveert dezelfde regel in plaats van een tweede plaat te maken.
    if (gegevens.barcode && gegevens.gewenst) {
      const bestaandBezit = db.prepare('SELECT * FROM platen WHERE barcode=? AND gewenst=0 ORDER BY id LIMIT 1').get(gegevens.barcode);
      if (bestaandBezit) return { plaat: rij(bestaandBezit), opgeteld: false, bestondAl: true, alInVerzameling: true };
      const bestaandWens = db.prepare('SELECT * FROM platen WHERE barcode=? AND gewenst=1 ORDER BY id LIMIT 1').get(gegevens.barcode);
      if (bestaandWens) {
        if (invoer.prijs !== undefined && invoer.prijs !== '') db.prepare('UPDATE platen SET prijs=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(gegevens.prijs, bestaandWens.id);
        return { plaat: rij(db.prepare('SELECT * FROM platen WHERE id=?').get(bestaandWens.id)), opgeteld: false, bestondAl: true };
      }
    }
    const bestaand = gegevens.barcode && !gegevens.gewenst
      ? db.prepare('SELECT id FROM platen WHERE barcode=? AND gewenst=0 AND locatie=? ORDER BY id LIMIT 1').get(gegevens.barcode, locatie)
      : null;
    if (bestaand) {
      db.prepare(`UPDATE platen SET aantal=aantal+?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(aantal, bestaand.id);
      return { plaat: rij(db.prepare('SELECT * FROM platen WHERE id=?').get(bestaand.id)), opgeteld: true };
    }
    if (gegevens.barcode && !gegevens.gewenst) {
      const wens = db.prepare('SELECT id FROM platen WHERE barcode=? AND gewenst=1 ORDER BY id LIMIT 1').get(gegevens.barcode);
      if (wens) {
        db.prepare(`UPDATE platen SET titel=?,artiest=?,jaar=?,label=?,formaat=?,genre=?,hoes=?,locatie=?,notitie=?,aantal=?,gewenst=0,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(gegevens.titel, gegevens.artiest, gegevens.jaar, gegevens.label, gegevens.formaat, gegevens.genre,
            gegevens.hoes, gegevens.locatie, gegevens.notitie, gegevens.aantal, wens.id);
        bewaarHoes(wens.id);
        return { plaat: rij(db.prepare('SELECT * FROM platen WHERE id=?').get(wens.id)), opgeteld: false, gekocht: true };
      }
    }
    const uitkomst = db.prepare(`INSERT INTO platen(barcode,titel,artiest,jaar,label,formaat,genre,hoes,locatie,notitie,aantal,prijs,gewenst)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(gegevens.barcode, gegevens.titel, gegevens.artiest, gegevens.jaar, gegevens.label, gegevens.formaat,
        gegevens.genre, gegevens.hoes, gegevens.locatie, gegevens.notitie, gegevens.aantal, gegevens.prijs, gegevens.gewenst ? 1 : 0);
    const id = Number(uitkomst.lastInsertRowid);
    bewaarHoes(id);
    return { plaat: rij(db.prepare('SELECT * FROM platen WHERE id=?').get(id)), opgeteld: false };
  }

  function wijzig(id, invoer) {
    const bestaand = db.prepare('SELECT * FROM platen WHERE id=?').get(Number(id));
    if (!bestaand) return null;
    const velden = {
      titel: invoer.titel == null ? bestaand.titel : leeg(invoer.titel),
      artiest: invoer.artiest == null ? bestaand.artiest : leeg(invoer.artiest),
      jaar: invoer.jaar == null ? bestaand.jaar : leeg(invoer.jaar, 12),
      label: invoer.label == null ? bestaand.label : leeg(invoer.label),
      formaat: invoer.formaat == null ? bestaand.formaat : leeg(invoer.formaat),
      genre: invoer.genre == null ? bestaand.genre : leeg(invoer.genre, 80),
      hoes: invoer.hoes == null ? bestaand.hoes : leeg(invoer.hoes, 400),
      locatie: invoer.locatie == null ? bestaand.locatie : leeg(invoer.locatie, 60),
      notitie: invoer.notitie == null ? bestaand.notitie : leeg(invoer.notitie, 300),
      gewenst: invoer.gewenst == null ? !!bestaand.gewenst : Boolean(invoer.gewenst),
      prijs: Object.hasOwn(invoer, 'prijs') ? leesPrijs(invoer.prijs) : bestaand.prijs,
    };
    if (!velden.titel) throw Error('Een plaat hoort een titel te hebben.');
    let aantal = bestaand.aantal;
    if (invoer.aantal != null && invoer.aantal !== '') {
      aantal = Math.round(Number(invoer.aantal));
      if (!Number.isFinite(aantal) || aantal < 1 || aantal > 99) throw Error('Geef een aantal tussen 1 en 99 op.');
    }
    db.prepare(`UPDATE platen SET titel=?,artiest=?,jaar=?,label=?,formaat=?,genre=?,hoes=?,locatie=?,notitie=?,aantal=?,prijs=?,gewenst=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(velden.titel, velden.artiest, velden.jaar, velden.label, velden.formaat, velden.genre, velden.hoes,
        velden.locatie, velden.notitie, aantal, velden.prijs, velden.gewenst ? 1 : 0, Number(id));
    bewaarHoes(id);
    return rij(db.prepare('SELECT * FROM platen WHERE id=?').get(Number(id)));
  }

  function verwijder(id) {
    const uitkomst = db.prepare('DELETE FROM platen WHERE id=?').run(Number(id));
    return uitkomst.changes > 0;
  }

  function stuur(res, status, gegevens) {
    const tekst = JSON.stringify(gegevens);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(tekst);
  }

  function lichaam(req) {
    return new Promise((resolve, reject) => {
      let s = '';
      req.on('data', c => {
        s += c;
        if (s.length > 100000) reject(Error('Te veel gegevens.'));
      });
      req.on('end', () => {
        try { resolve(JSON.parse(s || '{}')); } catch { reject(Error('Ongeldige gegevens.')); }
      });
    });
  }

  async function handle(req, res, url) {
    const pad = url.pathname;
    if (pad === '/api/platen' && req.method === 'GET') {
      const q = (naam, max) => { const w = url.searchParams.get(naam); return w === null ? null : leeg(w, max); };
      const filters = {
        locatie: q('locatie', 120),
        genre: q('genre', 80),
        artiest: q('artiest', 160),
        decennium: q('decennium', 12),
        van: q('van', 8),
        tot: q('tot', 8),
        zoekterm: (q('q', 60) || '').toLowerCase(),
        gewenst: url.searchParams.get('status') === 'wens',
      };
      const leegAlles = Object.values(filters).every((waarde) => !waarde);
      if (leegAlles) return stuur(res, 200, alles());
      const rijen = zeef(filters);
      return stuur(res, 200, antwoord(rijen, Object.fromEntries(Object.entries(filters).filter(([, w]) => w))));
    }
    if (pad === '/api/platen/keuzelijsten' && req.method === 'GET') return stuur(res, 200, keuzelijsten());
    if (pad === '/api/platen/lijst' && req.method === 'GET') return stuur(res, 200, { aantal: aantalInTabel(), bestand: lpBestand() });
    if (pad === '/api/platen/catalogus' && req.method === 'GET') {
      const term = leeg(url.searchParams.get('q') || '', 80).toLowerCase();
      if (term.length < 2) return stuur(res, 200, { resultaten: [] });
      zorgVoorTabel();
      const resultaten = db.prepare(`SELECT barcode,titel,artiest,jaar,label,formaat,mbid FROM lp_barcodes
          WHERE instr(lower(titel),?)>0 OR instr(lower(artiest),?)>0
          ORDER BY CASE WHEN instr(lower(titel),?)>0 THEN 0 ELSE 1 END, artiest COLLATE NOCASE, titel COLLATE NOCASE
          LIMIT 30`).all(term, term, term).map((r) => ({
        barcode: r.barcode, titel: r.titel, artiest: r.artiest, jaar: r.jaar, label: r.label,
        formaat: r.formaat, hoes: r.mbid ? `${CAA_BASIS()}/release/${r.mbid}/front-500.jpg` : '',
      }));
      return stuur(res, 200, { resultaten });
    }
    if (pad === '/api/platen/locaties' && req.method === 'GET') return stuur(res, 200, locaties());
    const hoesPad = pad.match(/^\/api\/platen\/hoes\/(\d+)$/);
    if (hoesPad && req.method === 'GET') return serveerHoes(res, hoesPad[1]);
    if (pad === '/api/platen/zoek' && req.method === 'GET') {
      const code = url.searchParams.get('code') || '';
      return stuur(res, 200, await zoek(code, { force: url.searchParams.get('force') === '1' }));
    }
    const zoekPad = pad.match(/^\/api\/platen\/zoek\/([0-9A-Za-z]{4,20})$/);
    if (zoekPad && req.method === 'GET') {
      return stuur(res, 200, await zoek(zoekPad[1], { force: url.searchParams.get('force') === '1' }));
    }
    if (pad === '/api/platen' && req.method === 'POST') {
      try { return stuur(res, 201, voegToe(await lichaam(req))); } catch (e) { return stuur(res, 400, { error: e.message }); }
    }
    const een = pad.match(/^\/api\/platen\/(\d+)$/);
    if (een && req.method === 'PATCH') {
      try {
        const plaat = wijzig(een[1], await lichaam(req));
        return plaat ? stuur(res, 200, plaat) : stuur(res, 404, { error: 'Deze plaat staat niet in je verzameling.' });
      } catch (e) { return stuur(res, 400, { error: e.message }); }
    }
    if (een && req.method === 'DELETE') {
      return verwijder(een[1]) ? stuur(res, 200, { ok: true }) : stuur(res, 404, { error: 'Deze plaat staat niet in je verzameling.' });
    }
    return stuur(res, 404, { error: 'Onbekende platenroute.' });
  }

  return { handle, alles, lijst, locaties, keuzelijsten, zeef, zoek, voegToe, wijzig, verwijder, bewaarHoes, aantalInTabel };
}

module.exports = { createPlaten, barcodeVarianten, kiesUitgave };
