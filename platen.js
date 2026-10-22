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
  const varianten = new Set([cijfers]);
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
  });

  const lijst = (locatie) => {
    const rijen = locatie
      ? db.prepare('SELECT * FROM platen WHERE locatie=? ORDER BY artiest COLLATE NOCASE, titel COLLATE NOCASE').all(locatie)
      : db.prepare('SELECT * FROM platen ORDER BY artiest COLLATE NOCASE, titel COLLATE NOCASE').all();
    return rijen.map(rij);
  };

  const locaties = () => db.prepare(`SELECT locatie AS naam, COUNT(*) AS aantal FROM platen
      GROUP BY locatie ORDER BY (locatie='') DESC, locatie COLLATE NOCASE`).all()
    .map(r => ({ naam: r.naam || 'Zonder locatie', sleutel: r.naam, aantal: r.aantal }));

  const alles = () => {
    const rijen = lijst();
    return {
      platen: rijen,
      totaal: rijen.length,
      locaties: locaties(),
      stuks: rijen.reduce((som, p) => som + (Number(p.aantal) || 0), 0),
    };
  };

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
        barcode: code,
        mbid: uitgave.id || '',
        titel: leeg(uitgave.title),
        artiest: leeg(artiestVan(uitgave)),
        jaar: jaarVan(uitgave.date),
        label: leeg((labelInfo.label && labelInfo.label.name) || labelInfo['catalog-number'] || ''),
        formaat: leeg(formaatVan(uitgave)),
        genre: leeg(typeVan(uitgave) || uitgave.country || ''),
        hoes,
        bron: 'MusicBrainz',
        licentie: 'CC0 1.0',
        bronUrl: uitgave.id ? `https://musicbrainz.org/release/${uitgave.id}` : '',
      };
    }
    return { gevonden: false, barcode: code, storing };
  }

  async function zoek(code, { force = false } = {}) {
    const schoon = String(code || '').replace(/\D/g, '');
    if (schoon.length < 8 || schoon.length > 14) {
      return { gevonden: false, barcode: schoon, reason: 'ongeldig', message: 'Een barcode hoort uit 8 tot 14 cijfers te bestaan.' };
    }
    const bewaard = leesCache(schoon);
    if (bewaard && !force && !bewaard.verouderd) return { ...bewaard, cached: true };
    const vers = await zoekOnline(schoon);
    if (vers.storing) {
      if (bewaard) return { ...bewaard, cached: true, storing: true };
      return { gevonden: false, barcode: schoon, reason: 'storing', message: 'De databank is even niet bereikbaar. Typ de gegevens zelf in; met “Opnieuw zoeken” probeer je het nog eens.' };
    }
    bewaarCache(schoon, vers);
    return { ...vers, cached: false };
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
    };
    // Dezelfde plaat op dezelfde plek telt op in plaats van dubbel te verschijnen.
    const bestaand = barcode
      ? db.prepare('SELECT id FROM platen WHERE barcode=? AND locatie=? ORDER BY id LIMIT 1').get(barcode, locatie)
      : null;
    if (bestaand) {
      db.prepare(`UPDATE platen SET aantal=aantal+?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(aantal, bestaand.id);
      return { plaat: rij(db.prepare('SELECT * FROM platen WHERE id=?').get(bestaand.id)), opgeteld: true };
    }
    const uitkomst = db.prepare(`INSERT INTO platen(barcode,titel,artiest,jaar,label,formaat,genre,hoes,locatie,notitie,aantal)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(gegevens.barcode, gegevens.titel, gegevens.artiest, gegevens.jaar, gegevens.label, gegevens.formaat,
        gegevens.genre, gegevens.hoes, gegevens.locatie, gegevens.notitie, gegevens.aantal);
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
    };
    if (!velden.titel) throw Error('Een plaat hoort een titel te hebben.');
    let aantal = bestaand.aantal;
    if (invoer.aantal != null && invoer.aantal !== '') {
      aantal = Math.round(Number(invoer.aantal));
      if (!Number.isFinite(aantal) || aantal < 1 || aantal > 99) throw Error('Geef een aantal tussen 1 en 99 op.');
    }
    db.prepare(`UPDATE platen SET titel=?,artiest=?,jaar=?,label=?,formaat=?,genre=?,hoes=?,locatie=?,notitie=?,aantal=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(velden.titel, velden.artiest, velden.jaar, velden.label, velden.formaat, velden.genre, velden.hoes,
        velden.locatie, velden.notitie, aantal, Number(id));
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
      const locatie = url.searchParams.get('locatie');
      const zoekterm = leeg(url.searchParams.get('q'), 60).toLowerCase();
      if (!locatie && !zoekterm) return stuur(res, 200, alles());
      let rijen = lijst(locatie === '' ? '' : locatie || undefined);
      if (locatie === 'leeg') rijen = rijen.filter(p => !p.locatie);
      if (zoekterm) {
        rijen = rijen.filter(p => `${p.titel} ${p.artiest} ${p.jaar} ${p.label} ${p.formaat} ${p.locatie} ${p.notitie}`.toLowerCase().includes(zoekterm));
      }
      return stuur(res, 200, {
        platen: rijen,
        totaal: rijen.length,
        locaties: locaties(),
        stuks: rijen.reduce((som, p) => som + (Number(p.aantal) || 0), 0),
      });
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

  return { handle, alles, lijst, locaties, zoek, voegToe, wijzig, verwijder, bewaarHoes };
}

module.exports = { createPlaten, barcodeVarianten, kiesUitgave };
