// Beheer: het beheerdersgedeelte achter een wachtwoord. Daar staat het versienummer,
// kun je controleren of er een nieuwe versie is, en kun je de app bijwerken zonder
// naar de console te gaan.
//
// De app zelf draait onbevoorrecht en met NoNewPrivileges; hij kan dus geen systeem-
// diensten herstarten. Daarom werkt de knop met een vlagbestand: de app schrijft
// 'update-aanvraag' in zijn gegevensmap, en een systemd-padunit (als root) start het
// bijwerkscript. Zo blijft het sandboxprofiel van de dienst intact.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO = 'Theberas04/voorraadthuis';
const COOKIE = 'vt_beheer';
const ZITTING_DAGEN = 30;
const POGINGEN_MAX = 8;
const POGINGEN_VENSTER_MIN = 15;
const WACHTWOORD_MIN = 10;

function leeg(tekst, max = 200){
  return String(tekst == null ? '' : tekst).replace(/\s+/g, ' ').trim().slice(0, max);
}

function hashWachtwoord(wachtwoord){
  const zout = crypto.randomBytes(16).toString('hex');
  const sleutel = crypto.scryptSync(wachtwoord, zout, 32, {N: 16384, r: 8, p: 1}).toString('hex');
  return `scrypt$16384$8$1$${zout}$${sleutel}`;
}

function kloptWachtwoord(wachtwoord, bewaard){
  try {
    const [soort, n, r, p, zout, sleutel] = String(bewaard).split('$');
    if (soort !== 'scrypt') return false;
    const berekend = crypto.scryptSync(wachtwoord, zout, Buffer.from(sleutel, 'hex').length, {N: Number(n), r: Number(r), p: Number(p)});
    return crypto.timingSafeEqual(berekend, Buffer.from(sleutel, 'hex'));
  } catch { return false; }
}

function leesVersie(pad){
  try {
    const regels = fs.readFileSync(pad, 'utf8').split('\n').map(r => r.trim());
    return {sha: regels[0] || '', datum: regels[1] || '', onderwerp: regels[2] || '', bestand: pad};
  } catch { return {sha: '', datum: '', onderwerp: '', bestand: pad}; }
}

function createBeheer({db, appDir, dataDir, repo = REPO, fetchImpl = fetch, omgevingWachtwoord = process.env.ADMIN_WACHTWOORD || '', nu = () => new Date()}){
  const versiePad = process.env.VERSIE_PAD || path.join(appDir, 'VERSIE');
  const logPad = process.env.UPDATE_LOG_PAD || path.join(dataDir, 'update-log.txt');
  const vraagPad = process.env.UPDATE_VRAAG_PAD || path.join(dataDir, 'update-aanvraag');
  const padUnit = process.env.UPDATE_PATH_UNIT || '/etc/systemd/system/voorraadthuis-update.path';

  db.exec(`CREATE TABLE IF NOT EXISTS beheer(
      id INTEGER PRIMARY KEY CHECK(id=1),
      wachtwoord TEXT NOT NULL,
      ingesteld_op TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      gewijzigd_op TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS beheer_sessies(
      token TEXT PRIMARY KEY,
      gemaakt_op TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      verloopt_op TEXT NOT NULL,
      ip TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS beheer_pogingen(
      ip TEXT PRIMARY KEY,
      aantal INTEGER NOT NULL DEFAULT 0,
      sinds TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

  const stuur = (res, status, gegevens, koppen = {}) => {
    res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...koppen});
    res.end(JSON.stringify(gegevens));
  };
  const stuur403 = (res, melding = 'Log eerst in als beheerder.') => stuur(res, 401, {error: melding});

  // ---- Wachtwoord en bijhouden van pogingen ------------------------------------
  function ingesteld(){
    if (omgevingWachtwoord) return true;
    return Boolean(db.prepare('SELECT 1 FROM beheer WHERE id=1').get());
  }

  function zetWachtwoord(wachtwoord){
    const schoon = String(wachtwoord || '');
    if (schoon.length < WACHTWOORD_MIN) throw Error(`Kies een wachtwoord van minstens ${WACHTWOORD_MIN} tekens.`);
    if (schoon.length > 200) throw Error('Dat wachtwoord is te lang.');
    const bestaand = db.prepare('SELECT * FROM beheer WHERE id=1').get();
    const hash = hashWachtwoord(schoon);
    if (bestaand) db.prepare('UPDATE beheer SET wachtwoord=?, gewijzigd_op=CURRENT_TIMESTAMP WHERE id=1').run(hash);
    else db.prepare('INSERT INTO beheer(id,wachtwoord) VALUES(1,?)').run(hash);
    db.prepare('DELETE FROM beheer_sessies').run();
    return true;
  }

  function teVeelPogingen(ip){
    const rij = db.prepare('SELECT * FROM beheer_pogingen WHERE ip=?').get(ip);
    if (!rij) return 0;
    const sinds = Date.parse(rij.sinds) || 0;
    if (Date.now() - sinds > POGINGEN_VENSTER_MIN * 60_000) {
      db.prepare('DELETE FROM beheer_pogingen WHERE ip=?').run(ip);
      return 0;
    }
    if (rij.aantal < POGINGEN_MAX) return 0;
    const wachten = Math.ceil((POGINGEN_VENSTER_MIN * 60_000 - (Date.now() - sinds)) / 60_000);
    return Math.max(1, wachten);
  }

  // De tijd komt uit de klok van dit proces en niet uit SQLite: CURRENT_TIMESTAMP is UTC
  // zonder tijdzone, en JavaScript leest die zonder tijdzone als lokale tijd. Daarmee leek een verse
  // poging uren oud en werd de teller veel te vroeg weer op nul gezet.
  function telPoging(ip){
    db.prepare(`INSERT INTO beheer_pogingen(ip,aantal,sinds) VALUES(?,1,?)
        ON CONFLICT(ip) DO UPDATE SET aantal=aantal+1`)
      .run(ip, nu().toISOString());
  }

  function wisPogingen(ip){
    db.prepare('DELETE FROM beheer_pogingen WHERE ip=?').run(ip);
  }

  // ---- Sessies -----------------------------------------------------------------
  function nieuweSessie(ip){
    const token = crypto.randomBytes(32).toString('hex');
    const verloopt = new Date(Date.now() + ZITTING_DAGEN * 86_400_000).toISOString();
    db.prepare('INSERT INTO beheer_sessies(token,verloopt_op,ip) VALUES(?,?,?)').run(token, verloopt, ip);
    db.prepare('DELETE FROM beheer_sessies WHERE verloopt_op < ?').run(new Date().toISOString());
    return token;
  }

  function koekjes(req){
    const ruw = req.headers.cookie || '';
    return Object.fromEntries(ruw.split(';').map(deel => {
      const punt = deel.indexOf('=');
      return punt === -1 ? [deel.trim(), ''] : [deel.slice(0, punt).trim(), decodeURIComponent(deel.slice(punt + 1).trim())];
    }).filter(([naam]) => naam));
  }

  function ingelogd(req){
    const token = koekjes(req)[COOKIE];
    if (!token) return null;
    const zitting = db.prepare('SELECT * FROM beheer_sessies WHERE token=?').get(token);
    if (!zitting) return null;
    if (Date.parse(zitting.verloopt_op) < Date.now()) {
      db.prepare('DELETE FROM beheer_sessies WHERE token=?').run(token);
      return null;
    }
    return token;
  }

  function ipVan(req){
    return leeg((req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket?.remoteAddress || '', 60);
  }

  // Een wijziging van buitenaf moet van deze app zelf komen: een eigen kop én het
  // Origin-adres moet bij deze host horen. Zo kan een andere pagina niet meeliften
  // op een openstaande beheerderssessie.
  function vanDezeApp(req){
    if (req.headers['x-voorraadthuis'] !== 'beheer') return false;
    const oorsprong = req.headers.origin;
    if (!oorsprong) return true;
    try {
      const hun = new URL(oorsprong);
      const host = String(req.headers.host || '').split(':')[0];
      return hun.hostname === host || hun.hostname === 'localhost' || hun.hostname === '127.0.0.1';
    } catch { return false; }
  }

  // ---- Versie en beschikbare update --------------------------------------------
  function versie(){
    return leesVersie(versiePad);
  }

  let nieuwsteCache = {op: 0, gegevens: null};

  async function nieuwste({ververs = false} = {}){
    // In de tests en op een toestel zonder internet is de controle uit te zetten.
    if (process.env.BEHEER_OFFLINE === '1') return {gelukt: false, reden: 'De controle op nieuwe versies staat uit in deze omgeving.'};
    if (!ververs && nieuwsteCache.gegevens && Date.now() - nieuwsteCache.op < 5 * 60_000) return nieuwsteCache.gegevens;
    try {
      const antwoord = await fetchImpl(`https://api.github.com/repos/${repo}/commits/main`, {
        headers: {'user-agent': 'VoorraadThuis/1.0 (zelf-gehoste thuisapp)', accept: 'application/vnd.github+json'},
        signal: AbortSignal.timeout(8000),
      });
      if (!antwoord.ok) return {gelukt: false, reden: `GitHub antwoordde met ${antwoord.status}.`};
      const gegevens = await antwoord.json();
      const uitkomst = {
        gelukt: true,
        sha: String(gegevens.sha || ''),
        kort: String(gegevens.sha || '').slice(0, 7),
        datum: String(gegevens.commit?.author?.date || ''),
        onderwerp: leeg((gegevens.commit?.message || '').split('\n')[0], 160),
        opgehaald: nu().toISOString(),
      };
      nieuwsteCache = {op: Date.now(), gegevens: uitkomst};
      return uitkomst;
    } catch (fout) {
      return {gelukt: false, reden: 'GitHub was niet bereikbaar.'};
    }
  }

  function logRegels(aantal = 120){
    try {
      const regels = fs.readFileSync(logPad, 'utf8').split('\n').filter(Boolean);
      return regels.slice(-aantal);
    } catch { return []; }
  }

  function updateBezig(){
    try {
      const inhoud = fs.readFileSync(vraagPad, 'utf8').trim();
      const tijd = Number((inhoud.split('\n')[1] || '').trim()) || 0;
      const ouder = Date.now() - (tijd || fs.statSync(vraagPad).mtimeMs);
      return ouder < 15 * 60_000;
    } catch { return false; }
  }

  function kanBijwerken(){
    if (!fs.existsSync(padUnit)) return false;
    try { fs.accessSync(path.dirname(vraagPad), fs.constants.W_OK); return true; }
    catch { return false; }
  }

  function vraagUpdate(sha){
    if (!kanBijwerken()) throw Error('Bijwerken vanaf deze pagina is nog niet ingericht; draai een keer het bijwerkscript op de host.');
    const gewenst = /^[0-9a-f]{7,40}$/.test(String(sha || '')) ? String(sha) : 'main';
    fs.mkdirSync(path.dirname(vraagPad), {recursive: true});
    fs.writeFileSync(vraagPad, `${gewenst}\n${Date.now()}\n`);
    return {gevraagd: true, versie: gewenst};
  }

  // ---- Status voor de pagina ---------------------------------------------------
  async function status(req, {ververs = false} = {}){
    const huidig = versie();
    const laatste = await nieuwste({ververs});
    const nieuw = Boolean(laatste.gelukt && laatste.sha && laatste.sha !== huidig.sha);
    return {
      ingesteld: ingesteld(),
      ingelogd: Boolean(ingelogd(req)),
      wachtwoordUitOmgeving: Boolean(omgevingWachtwoord),
      huidig,
      beschikbaar: laatste,
      nieuw,
      updateBezig: updateBezig(),
      kanBijwerken: kanBijwerken(),
      log: logRegels(),
    };
  }

  // ---- Routes -------------------------------------------------------------------
  async function handle(req, res, url){
    const pad = url.pathname;
    const ip = ipVan(req);
    const lichaam = async () => {
      try { return await leesLichaam(req); }
      catch (fout) { stuur(res, 400, {error: fout.message}); return null; }
    };

    if (pad === '/api/beheer/status' && req.method === 'GET') {
      const binnen = Boolean(ingelogd(req));
      if (!binnen) {
        return stuur(res, 200, {
          ingesteld: ingesteld(), ingelogd: false, wachtwoordUitOmgeving: Boolean(omgevingWachtwoord),
          nieuw: false, updateBezig: false, kanBijwerken: kanBijwerken(), log: [],
        });
      }
      return stuur(res, 200, await status(req, {ververs: url.searchParams.get('ververs') === '1'}));
    }

    if (pad === '/api/beheer/wachtwoord' && req.method === 'POST') {
      const gegevens = await lichaam();
      if (!gegevens) return;
      if (!vanDezeApp(req)) return stuur(res, 403, {error: 'Deze aanvraag komt niet uit de app zelf.'});
      try {
        if (ingesteld()) {
          if (!ingelogd(req)) return stuur403(res);
          const bestaand = db.prepare('SELECT * FROM beheer WHERE id=1').get();
          const goed = (omgevingWachtwoord && gegevens.oudWachtwoord === omgevingWachtwoord)
            || (bestaand && kloptWachtwoord(String(gegevens.oudWachtwoord || ''), bestaand.wachtwoord));
          if (!goed) return stuur(res, 401, {error: 'Het huidige wachtwoord klopt niet.'});
        }
        zetWachtwoord(gegevens.wachtwoord);
        const token = nieuweSessie(ip);
        return stuur(res, 200, {ingesteld: true, ingelogd: true}, {['set-cookie']: koekje(req, token)});
      } catch (fout) { return stuur(res, 400, {error: fout.message}); }
    }

    if (pad === '/api/beheer/inloggen' && req.method === 'POST') {
      if (!vanDezeApp(req)) return stuur(res, 403, {error: 'Deze aanvraag komt niet uit de app zelf.'});
      const wachten = teVeelPogingen(ip);
      if (wachten) return stuur(res, 429, {error: `Te veel pogingen. Probeer het over ${wachten} minuten opnieuw.`});
      const gegevens = await lichaam();
      if (!gegevens) return;
      const bewaard = db.prepare('SELECT * FROM beheer WHERE id=1').get();
      const goed = (omgevingWachtwoord && gegevens.wachtwoord === omgevingWachtwoord)
        || (bewaard && kloptWachtwoord(String(gegevens.wachtwoord || ''), bewaard.wachtwoord));
      if (!goed) {
        telPoging(ip);
        return stuur(res, 401, {error: 'Dat wachtwoord klopt niet.'});
      }
      wisPogingen(ip);
      const token = nieuweSessie(ip);
      return stuur(res, 200, {ingelogd: true}, {['set-cookie']: koekje(req, token)});
    }

    if (pad === '/api/beheer/uitloggen' && req.method === 'POST') {
      const token = ingelogd(req);
      if (token) db.prepare('DELETE FROM beheer_sessies WHERE token=?').run(token);
      return stuur(res, 200, {ingelogd: false}, {['set-cookie']: `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`});
    }

    if (pad === '/api/beheer/update' && req.method === 'POST') {
      if (!vanDezeApp(req)) return stuur(res, 403, {error: 'Deze aanvraag komt niet uit de app zelf.'});
      if (!ingelogd(req)) return stuur403(res);
      const gegevens = await lichaam();
      if (!gegevens) return;
      try { return stuur(res, 200, vraagUpdate(gegevens.sha)); }
      catch (fout) { return stuur(res, 400, {error: fout.message}); }
    }

    return stuur(res, 404, {error: 'Onbekende beheerroute.'});
  }

  function koekje(req, token){
    const beveiligd = Boolean(req.socket?.encrypted) ? '; Secure' : '';
    return `${COOKIE}=${token}; Path=/; Max-Age=${ZITTING_DAGEN * 86_400}; HttpOnly; SameSite=Strict${beveiligd}`;
  }

  function leesLichaam(req, max = 20_000){
    return new Promise((klaar, mis) => {
      let brokken = '';
      req.on('data', stuk => {
        brokken += stuk;
        if (brokken.length > max) { mis(Error('De invoer is te groot.')); req.destroy(); }
      });
      req.on('error', mis);
      req.on('end', () => {
        try { klaar(brokken ? JSON.parse(brokken) : {}); }
        catch { mis(Error('De invoer is geen geldige JSON.')); }
      });
    });
  }

  return {handle, ingesteld, zetWachtwoord, versie, nieuwste, status, vraagUpdate, kanBijwerken, logRegels, hashWachtwoord, kloptWachtwoord, WACHTWOORD_MIN, COOKIE};
}

module.exports = {createBeheer, hashWachtwoord, kloptWachtwoord, WACHTWOORD_MIN, COOKIE};
