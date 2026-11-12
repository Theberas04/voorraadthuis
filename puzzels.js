// Puzzels: de legpuzzelverzameling. Werkt als de platenverzameling, maar met de bron
// die er voor puzzels is: Open Products Facts (open data, ODbL 1.0). Een gescande
// barcode wordt daar opgezocht; wat je zelf invult blijft leidend en wordt lokaal
// bewaard, zodat een volgende scan meteen raak is — ook zonder internet.
//
// Foto's uit de databank nemen we niet over (dat mag niet zomaar); de app bewaart
// alleen je eigen foto van de doos en verwijst naar de bronpagina.
const fs = require('node:fs');
const path = require('node:path');

const MAX_TEKST = 300;
const STATUSSEN = ['nieuw', 'bezig', 'gedaan', 'uitgeleend'];
const STATUS_TEKST = { nieuw: 'Nieuw', bezig: 'Mee bezig', gedaan: 'Gemaakt', uitgeleend: 'Uitgeleend' };
const SOORTEN = ['landschap', 'kunst', 'dieren', 'steden', 'vervoer', 'fantasy', 'kinderpuzzel', 'anders'];
const BRON = 'Open Products Facts';
const BRON_LICENTIE = 'ODbL 1.0';
const BRON_PAGINA = code => `https://world.openproductsfacts.org/product/${code}/`;

function leeg(tekst, max = MAX_TEKST){
  return String(tekst == null ? '' : tekst).replace(/\s+/g, ' ').trim().slice(0, max);
}

function normaliseerCode(code){
  const cijfers = String(code == null ? '' : code).replace(/\D/g, '');
  return cijfers.length >= 8 && cijfers.length <= 14 ? cijfers : '';
}

// Het aantal stukken staat bijna altijd in de naam of in de hoeveelheid van de bron.
function stukkenUit(tekst){
  const bron = String(tekst || '');
  const metWoord = /(\d{2,5})\s*(?:pi[eè]ces?|pieces?|teile|stukjes|stuks|pcs|parts)/i.exec(bron);
  const los = /(\d{3,5})/.exec(bron);
  const waarde = Number((metWoord || los || [])[1]);
  return Number.isFinite(waarde) && waarde >= 20 && waarde <= 20000 ? waarde : null;
}

function createPuzzels({ db, mediaDir, fetchImpl = fetch, bronAan = true, nu = () => new Date() }){
  db.exec(`CREATE TABLE IF NOT EXISTS puzzels(
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL DEFAULT '',
      titel TEXT NOT NULL,
      merk TEXT NOT NULL DEFAULT '',
      stukken INTEGER,
      soort TEXT NOT NULL DEFAULT '',
      jaar TEXT NOT NULL DEFAULT '',
      formaat TEXT NOT NULL DEFAULT '',
      locatie TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'nieuw',
      uitgeleend_aan TEXT NOT NULL DEFAULT '',
      uitgeleend_op TEXT NOT NULL DEFAULT '',
      aantal INTEGER NOT NULL DEFAULT 1,
      notitie TEXT NOT NULL DEFAULT '',
      foto TEXT NOT NULL DEFAULT '',
      bron TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS puzzels_status ON puzzels(status);
    CREATE TABLE IF NOT EXISTS puzzel_barcodes(
      code TEXT PRIMARY KEY,
      titel TEXT NOT NULL DEFAULT '',
      merk TEXT NOT NULL DEFAULT '',
      stukken INTEGER,
      soort TEXT NOT NULL DEFAULT '',
      bron TEXT NOT NULL DEFAULT '',
      gevonden INTEGER NOT NULL DEFAULT 0,
      opgezocht_op TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);

  const stuur = (res, status, gegevens) => {
    const tekst = JSON.stringify(gegevens);
    res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});
    res.end(tekst);
  };

  const rij = id => db.prepare('SELECT * FROM puzzels WHERE id=?').get(Number(id));

  function naarBuiten(puzzel){
    if (!puzzel) return null;
    return {
      ...puzzel,
      stukken: puzzel.stukken == null ? null : Number(puzzel.stukken),
      aantal: Number(puzzel.aantal) || 1,
      statusTekst: STATUS_TEKST[puzzel.status] || puzzel.status,
      bronPagina: puzzel.code ? BRON_PAGINA(puzzel.code) : '',
    };
  }

  function gezocht(rijen){
    return rijen.map(naarBuiten);
  }

  // ---- De bron: een barcode opzoeken ------------------------------------------
  async function zoekBijBron(code){
    if (!bronAan) return {gevonden: false, reden: 'De databank staat uit in de instellingen.'};
    const adres = `https://world.openproductsfacts.org/api/v2/product/${code}.json`;
    try {
      const antwoord = await fetchImpl(adres, {
        headers: {'user-agent': 'VoorraadThuis/1.0 (zelf-gehoste thuisapp)'},
        signal: AbortSignal.timeout(8000),
      });
      if (!antwoord.ok) return {gevonden: false, reden: 'Deze barcode staat niet in de databank.'};
      const gegevens = await antwoord.json();
      const product = gegevens && gegevens.product;
      if (!product || !product.code) return {gevonden: false, reden: 'Deze barcode staat niet in de databank.'};
      const naam = leeg(product.product_name || product.product_name_nl || product.generic_name || '', 120);
      const merk = leeg(product.brands || '', 80).split(',')[0].trim();
      const categorieen = Array.isArray(product.categories_tags) ? product.categories_tags.join(' ') : '';
      return {
        gevonden: true,
        titel: naam,
        merk,
        stukken: stukkenUit(product.quantity) || stukkenUit(naam),
        soort: /jigsaw|puzzle/i.test(categorieen) ? '' : leeg(String(product.categories || '').split(',')[0], 40),
        bron: BRON,
        bronLicentie: BRON_LICENTIE,
        bronPagina: BRON_PAGINA(code),
      };
    } catch (fout) {
      return {gevonden: false, reden: 'De databank was niet bereikbaar.'};
    }
  }

  function uitCache(code){
    return db.prepare('SELECT * FROM puzzel_barcodes WHERE code=?').get(code) || null;
  }

  function bewaarCache(code, gegevens){
    db.prepare(`INSERT INTO puzzel_barcodes(code,titel,merk,stukken,soort,bron,gevonden,opgezocht_op)
        VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(code) DO UPDATE SET titel=excluded.titel,merk=excluded.merk,stukken=excluded.stukken,
          soort=excluded.soort,bron=excluded.bron,gevonden=excluded.gevonden,opgezocht_op=CURRENT_TIMESTAMP`)
      .run(code, gegevens.titel || '', gegevens.merk || '', gegevens.stukken || null, gegevens.soort || '',
        gegevens.bron || '', gegevens.gevonden ? 1 : 0);
  }

  // Zoeken bij een scan: eerst wat we al weten (snel en zonder internet), dan de bron.
  async function zoekCode(code, {ververs = false} = {}){
    const schoon = normaliseerCode(code);
    if (!schoon) throw Error('Vul een geldige barcode in (8 tot 14 cijfers).');
    const inBezit = db.prepare('SELECT * FROM puzzels WHERE code=?').get(schoon);
    if (inBezit && !ververs) {
      return {code: schoon, bekend: true, inBezit: true, puzzel: naarBuiten(inBezit), bron: 'eigen verzameling'};
    }
    const bewaard = uitCache(schoon);
    if (bewaard && !ververs) {
      return {
        code: schoon, bekend: true, inBezit: Boolean(inBezit),
        voorstel: {titel: bewaard.titel, merk: bewaard.merk, stukken: bewaard.stukken, soort: bewaard.soort},
        gevonden: Boolean(bewaard.gevonden), bron: bewaard.bron || 'eigen invoer', puzzel: inBezit ? naarBuiten(inBezit) : null,
      };
    }
    const uitkomst = await zoekBijBron(schoon);
    if (uitkomst.gevonden) bewaarCache(schoon, uitkomst);
    return {
      code: schoon, bekend: false, inBezit: Boolean(inBezit),
      voorstel: uitkomst.gevonden
        ? {titel: uitkomst.titel, merk: uitkomst.merk, stukken: uitkomst.stukken, soort: uitkomst.soort}
        : null,
      gevonden: Boolean(uitkomst.gevonden),
      reden: uitkomst.reden || '',
      bron: uitkomst.gevonden ? BRON : '',
      bronLicentie: BRON_LICENTIE,
      bronPagina: uitkomst.gevonden ? BRON_PAGINA(schoon) : '',
    };
  }

  // ---- Toevoegen, wijzigen, verwijderen --------------------------------------
  // Een bewaarde puzzel terugzetten naar de vorm waarin we invoer lezen, zodat een
  // gedeeltelijke wijziging (alleen de status bijvoorbeeld) de rest niet leegmaakt.
  function naarInvoer(puzzel){
    return {
      code: puzzel.code, titel: puzzel.titel, merk: puzzel.merk, stukken: puzzel.stukken,
      soort: puzzel.soort, jaar: puzzel.jaar, formaat: puzzel.formaat, locatie: puzzel.locatie,
      status: puzzel.status, uitgeleendAan: puzzel.uitgeleend_aan, uitgeleendOp: puzzel.uitgeleend_op,
      aantal: puzzel.aantal, notitie: puzzel.notitie,
    };
  }

  function leesInvoer(x, bestaand){
    const puzzel = {
      code: normaliseerCode(x.code) || (bestaand ? bestaand.code : ''),
      titel: leeg(x.titel, 120),
      merk: leeg(x.merk, 80),
      stukken: x.stukken === '' || x.stukken == null ? null : Math.round(Number(x.stukken)),
      soort: leeg(x.soort, 40),
      jaar: leeg(x.jaar, 12),
      formaat: leeg(x.formaat, 60),
      locatie: leeg(x.locatie, 60),
      status: leeg(x.status, 12) || 'nieuw',
      uitgeleend_aan: leeg(x.uitgeleendAan, 80),
      uitgeleend_op: leeg(x.uitgeleendOp, 12),
      aantal: x.aantal === '' || x.aantal == null ? 1 : Math.round(Number(x.aantal)),
      notitie: leeg(x.notitie, MAX_TEKST),
    };
    if (!puzzel.titel) throw Error('Geef de puzzel een titel (wat staat er op de doos?).');
    if (puzzel.stukken != null && (!Number.isFinite(puzzel.stukken) || puzzel.stukken < 4 || puzzel.stukken > 50000)) throw Error('Vul het aantal stukken in (4 tot 50000).');
    if (!Number.isFinite(puzzel.aantal) || puzzel.aantal < 1 || puzzel.aantal > 99) throw Error('Het aantal exemplaren loopt van 1 tot 99.');
    if (!STATUSSEN.includes(puzzel.status)) throw Error('Kies een status: nieuw, mee bezig, gemaakt of uitgeleend.');
    if (puzzel.status === 'uitgeleend' && !puzzel.uitgeleend_aan) throw Error('Vul in aan wie je hem hebt uitgeleend.');
    // De uitleeninformatie hoort alleen bij de status uitgeleend; komt de puzzel terug,
    // dan verdwijnt de naam er weer af.
    if (puzzel.status !== 'uitgeleend') { puzzel.uitgeleend_aan = ''; puzzel.uitgeleend_op = ''; }
    return puzzel;
  }

  function maak(x){
    const puzzel = leesInvoer(x);
    if (puzzel.code && db.prepare('SELECT 1 FROM puzzels WHERE code=?').get(puzzel.code)) {
      throw Error('Deze barcode zit al in je verzameling.');
    }
    const uitkomst = db.prepare(`INSERT INTO puzzels(code,titel,merk,stukken,soort,jaar,formaat,locatie,status,uitgeleend_aan,uitgeleend_op,aantal,notitie)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(puzzel.code, puzzel.titel, puzzel.merk, puzzel.stukken, puzzel.soort,
      puzzel.jaar, puzzel.formaat, puzzel.locatie, puzzel.status, puzzel.uitgeleend_aan, puzzel.uitgeleend_op, puzzel.aantal, puzzel.notitie);
    const nieuw = rij(uitkomst.lastInsertRowid);
    // Voortaan is deze barcode bekend, ook zonder internet: wat jij invult is leidend.
    if (nieuw.code) {
      bewaarCache(nieuw.code, {
        titel: nieuw.titel, merk: nieuw.merk, stukken: nieuw.stukken, soort: nieuw.soort,
        bron: nieuw.bron || 'eigen invoer', gevonden: true,
      });
    }
    return naarBuiten(nieuw);
  }

  function wijzig(id, x){
    const bestaand = rij(id);
    if (!bestaand) return null;
    const puzzel = leesInvoer({...naarInvoer(bestaand), ...x, code: x.code === undefined ? bestaand.code : x.code}, bestaand);
    if (puzzel.code && puzzel.code !== bestaand.code) {
      const ander = db.prepare('SELECT id FROM puzzels WHERE code=? AND id<>?').get(puzzel.code, bestaand.id);
      if (ander) throw Error('Die barcode hoort al bij een andere puzzel in je verzameling.');
    }
    db.prepare(`UPDATE puzzels SET code=?,titel=?,merk=?,stukken=?,soort=?,jaar=?,formaat=?,locatie=?,status=?,
        uitgeleend_aan=?,uitgeleend_op=?,aantal=?,notitie=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(puzzel.code, puzzel.titel, puzzel.merk, puzzel.stukken, puzzel.soort, puzzel.jaar, puzzel.formaat,
        puzzel.locatie, puzzel.status, puzzel.uitgeleend_aan, puzzel.uitgeleend_op, puzzel.aantal, puzzel.notitie, bestaand.id);
    if (puzzel.code) {
      bewaarCache(puzzel.code, {
        titel: puzzel.titel, merk: puzzel.merk, stukken: puzzel.stukken, soort: puzzel.soort,
        bron: bestaand.bron || 'eigen invoer', gevonden: true,
      });
    }
    return naarBuiten(rij(bestaand.id));
  }

  function verwijder(id){
    const bestaand = rij(id);
    if (!bestaand) return null;
    const foto = bestaand.foto;
    db.prepare('DELETE FROM puzzels WHERE id=?').run(bestaand.id);
    if (foto && foto.startsWith('/media/')) {
      try { fs.rmSync(path.join(mediaDir, path.basename(foto)), {force: true}); } catch { /* niet erg */ }
    }
    return {verwijderd: bestaand.id};
  }

  function bewaarFoto(id, data){
    const bestaand = rij(id);
    if (!bestaand) throw Error('Deze puzzel staat niet in je verzameling.');
    if (typeof data !== 'string' || !data.trim()) throw Error('Kies een foto van maximaal 4 MB (JPEG, PNG of WebP).');
    const beeld = Buffer.from(data.replace(/^data:[^,]+,/, ''), 'base64');
    if (beeld.length < 100) throw Error('De foto lijkt leeg.');
    if (beeld.length > 4_000_000) throw Error('Kies een foto van maximaal 4 MB (JPEG, PNG of WebP).');
    const soort = beeld[0] === 0xff && beeld[1] === 0xd8 && beeld[2] === 0xff ? 'jpg'
      : beeld[0] === 0x89 && beeld[1] === 0x50 && beeld[2] === 0x4e ? 'png'
        : beeld.subarray(0, 4).toString('ascii') === 'RIFF' ? 'webp' : null;
    if (!soort) throw Error('De foto moet een JPEG-, PNG- of WebP-afbeelding zijn.');
    fs.mkdirSync(mediaDir, {recursive: true});
    const bestand = `puzzel-${bestaand.id}.${soort}`;
    fs.writeFileSync(path.join(mediaDir, bestand), beeld);
    const url = `/media/${bestand}`;
    db.prepare('UPDATE puzzels SET foto=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(url, bestaand.id);
    return url;
  }

  // ---- Overzicht, filters en keuzelijsten ------------------------------------
  function zeef({zoekterm, merk, stukken, status, locatie}){
    const alle = db.prepare('SELECT * FROM puzzels ORDER BY titel COLLATE NOCASE').all();
    const term = (zoekterm || '').toLowerCase();
    return alle.filter(p => {
      if (merk && p.merk !== merk) return false;
      if (stukken && Number(p.stukken) !== Number(stukken)) return false;
      if (status && p.status !== status) return false;
      if (locatie && p.locatie !== locatie) return false;
      if (term) {
        const hooiberg = `${p.titel} ${p.merk} ${p.soort} ${p.locatie} ${p.notitie} ${p.code}`.toLowerCase();
        if (!hooiberg.includes(term)) return false;
      }
      return true;
    });
  }

  function keuzelijsten(){
    const rijen = db.prepare('SELECT merk,stukken,locatie,status,COUNT(*) AS aantal FROM puzzels GROUP BY merk,stukken,locatie,status').all();
    const verzamel = (veld, sorteren) => {
      const map = new Map();
      for (const r of rijen) {
        const waarde = r[veld];
        if (waarde === '' || waarde === null) continue;
        map.set(waarde, (map.get(waarde) || 0) + r.aantal);
      }
      return [...map].map(([naam, aantal]) => ({naam, aantal})).sort(sorteren);
    };
    const alle = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(aantal),0) AS stuks FROM puzzels').get();
    const perStatus = STATUSSEN.map(s => ({
      status: s, naam: STATUS_TEKST[s],
      aantal: db.prepare('SELECT COALESCE(SUM(aantal),0) AS n FROM puzzels WHERE status=?').get(s).n,
    }));
    return {
      merken: verzamel('merk', (a, b) => a.naam.localeCompare(b.naam, 'nl')),
      stukken: verzamel('stukken', (a, b) => Number(a.naam) - Number(b.naam)),
      locaties: verzamel('locatie', (a, b) => a.naam.localeCompare(b.naam, 'nl')),
      statussen: STATUSSEN.map(s => ({status: s, naam: STATUS_TEKST[s]})),
      perStatus,
      soorten: SOORTEN,
      totaal: alle.stuks,
      dozen: alle.n,
    };
  }

  function filtersUit(url){
    return {
      zoekterm: leeg(url.searchParams.get('q') || '', 60),
      merk: leeg(url.searchParams.get('merk') || '', 80),
      stukken: leeg(url.searchParams.get('stukken') || '', 8),
      status: leeg(url.searchParams.get('status') || '', 12),
      locatie: leeg(url.searchParams.get('locatie') || '', 60),
    };
  }

  // ---- Printbare lijst ---------------------------------------------------------
  // Dezelfde verzameling als op de pagina, maar op papier: één regel per puzzel, de
  // dozen geteld, en de filters die op dat moment aanstaan erbij vermeld. Via de knop
  // (of Ctrl/Cmd + P) is dit ook als PDF te bewaren.
  function veilig(tekst){
    return String(tekst == null ? '' : tekst).replace(/[&<>"]/g, t => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[t]));
  }

  function vandaag(){
    return nu().toLocaleDateString('nl-NL', {day: 'numeric', month: 'long', year: 'numeric'});
  }

  function filterTekst(filters){
    const delen = [];
    if (filters.zoekterm) delen.push(`zoekterm "${filters.zoekterm}"`);
    if (filters.merk) delen.push(`merk ${filters.merk}`);
    if (filters.stukken) delen.push(`${filters.stukken} stukken`);
    if (filters.status) delen.push(`status ${STATUS_TEKST[filters.status] || filters.status}`);
    if (filters.locatie) delen.push(`plek ${filters.locatie}`);
    return delen.join(' · ');
  }

  function telPer(rijen, sleutelVan){
    const map = new Map();
    for (const p of rijen) {
      const sleutel = sleutelVan(p);
      if (!sleutel) continue;
      const vorige = map.get(sleutel) || {naam: sleutel, dozen: 0, puzzels: 0};
      vorige.dozen += Number(p.aantal) || 1;
      vorige.puzzels += 1;
      map.set(sleutel, vorige);
    }
    return [...map.values()].sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
  }

  function printHtml(filters){
    // Dezelfde omzetting als naar de pagina (gezocht): anders staat de status hier als
    // 'uitgeleend' in plaats van 'Uitgeleend' en ontbreekt het aantal.
    const rijen = gezocht(zeef(filters));
    const dozen = rijen.reduce((som, p) => som + (Number(p.aantal) || 1), 0);
    const perPlek = telPer(rijen, p => p.locatie);
    const perStatus = STATUSSEN.map(st => {
      const van = rijen.filter(p => p.status === st);
      return {naam: STATUS_TEKST[st], dozen: van.reduce((som, p) => som + (Number(p.aantal) || 1), 0), puzzels: van.length};
    }).filter(r => r.puzzels);
    const regel = (p) => `<tr>
      <td>${veilig(p.titel)}${p.code ? `<br><span class="code">${veilig(p.code)}</span>` : ''}</td>
      <td>${veilig(p.merk)}</td>
      <td class="num">${p.stukken ? p.stukken : '—'}</td>
      <td>${veilig(p.soort)}</td>
      <td>${veilig(p.jaar)}</td>
      <td>${veilig(p.formaat)}</td>
      <td>${veilig(p.locatie)}</td>
      <td class="num">${p.aantal}</td>
      <td>${veilig(p.statusTekst)}${p.status === 'uitgeleend' && p.uitgeleend_aan ? `<br><span class="code">bij ${veilig(p.uitgeleend_aan)}${p.uitgeleend_op ? ` sinds ${veilig(p.uitgeleend_op)}` : ''}</span>` : ''}</td>
      <td>${veilig(p.notitie)}</td>
    </tr>`;
    const somRegel = (naam, rij) => `<tr><th colspan="7">${veilig(naam)}</th><th class="num">${rij.dozen}</th><td colspan="2">${rij.puzzels} ${rij.puzzels === 1 ? 'puzzel' : 'puzzels'}</td></tr>`;
    return `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mijn puzzelverzameling</title>
<style>
  :root{color-scheme:light}
  body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1c2822;background:#fff;margin:24px auto;max-width:1400px;padding:0 18px}
  h1{font-size:22px;margin:0 0 6px}
  p.meta{margin:0 0 4px;color:#43574b}
  p.uitleg{margin:0 0 14px;color:#5d6b62;font-size:13px}
  button{font:inherit;background:#173c32;color:#fff;border:0;border-radius:9px;padding:9px 14px;cursor:pointer}
  a.csv{font:inherit;margin-left:10px;color:#173c32}
  table{border-collapse:collapse;width:100%;margin-top:14px;font-size:12.5px}
  th,td{border:1px solid #dbe7d7;padding:5px 7px;text-align:left;vertical-align:top}
  thead th{background:#f3f7f1;white-space:nowrap}
  tfoot th,tfoot td{background:#f3f7f1;font-weight:600}
  td.num,th.num{text-align:right;white-space:nowrap}
  .code{color:#5d6b62;font-size:11px}
  @page{size:A4 landscape;margin:12mm}
  .alleen-papier{display:none}
  @media print{button,a.csv,.alleen-scherm{display:none} .alleen-papier{display:inline} body{margin:0;max-width:none} thead th{background:#eee}}
</style></head>
<body>
<h1>Mijn puzzelverzameling</h1>
<p class="meta">Opgesteld op ${veilig(vandaag())} · ${rijen.length} ${rijen.length === 1 ? 'puzzel' : 'puzzels'} · ${dozen} ${dozen === 1 ? 'doos' : 'dozen'}</p>
${filterTekst(filters) ? `<p class="meta">Filter: ${veilig(filterTekst(filters))}</p>` : ''}
<p class="uitleg"><span class="alleen-scherm">Afdrukken of bewaren als PDF: gebruik de knop hieronder of Ctrl/Cmd + P (het blad staat op A4 liggend). Dezelfde lijst is er ook als <a class="csv" href="/api/puzzels/lijst.csv${urlVan(filters)}">CSV-bestand</a> voor een spreadsheet.</span><span class="alleen-papier">Deze lijst is op A4 liggend gemaakt; bewaar hem als PDF via Ctrl/Cmd + P.</span></p>
<button type="button" onclick="window.print()">🖨 Afdrukken of bewaar als PDF</button>
<table>
<thead><tr><th>Titel</th><th>Merk</th><th class="num">Stukken</th><th>Soort</th><th>Jaar</th><th>Formaat</th><th>Plek</th><th class="num">Aantal</th><th>Status</th><th>Notitie</th></tr></thead>
<tbody>${rijen.map(regel).join('')}</tbody>
<tfoot>
<tr><th colspan="7">Totaal</th><th class="num">${dozen} ${dozen === 1 ? 'doos' : 'dozen'}</th><td colspan="2">${rijen.length} ${rijen.length === 1 ? 'puzzel' : 'puzzels'}</td></tr>
${perStatus.length > 1 ? perStatus.map(r => somRegel(r.naam, r)).join('') : ''}
${perPlek.length > 1 ? perPlek.map(r => somRegel('Plek: ' + r.naam, r)).join('') : ''}
</tfoot>
</table>
</body></html>`;
  }

  function urlVan(filters){
    const vraag = new URLSearchParams();
    if (filters.zoekterm) vraag.set('q', filters.zoekterm);
    if (filters.merk) vraag.set('merk', filters.merk);
    if (filters.stukken) vraag.set('stukken', filters.stukken);
    if (filters.status) vraag.set('status', filters.status);
    if (filters.locatie) vraag.set('locatie', filters.locatie);
    const tekst = vraag.toString();
    return tekst ? `?${tekst}` : '';
  }

  // Dezelfde lijst als CSV, met een puntkomma als scheiding (zoals Excel in Nederland
  // verwacht).
  function printCsv(filters){
    const veld = (waarde) => {
      const tekst = String(waarde ?? '');
      return /[";\n]/.test(tekst) ? `"${tekst.replace(/"/g, '""')}"` : tekst;
    };
    const kop = ['titel', 'code', 'merk', 'stukken', 'soort', 'jaar', 'formaat', 'plek', 'aantal', 'status', 'uitgeleend_aan', 'uitgeleend_op', 'notitie'];
    const regels = [kop.join(';')];
    for (const p of gezocht(zeef(filters))) {
      regels.push([veld(p.titel), veld(p.code), veld(p.merk), p.stukken == null ? '' : p.stukken, veld(p.soort),
        veld(p.jaar), veld(p.formaat), veld(p.locatie), p.aantal, veld(p.statusTekst), veld(p.uitgeleend_aan),
        veld(p.uitgeleend_op), veld(p.notitie)].join(';'));
    }
    return regels.join('\n') + '\n';
  }

  function overzicht(filters){
    const rijen = zeef(filters);
    const dozen = rijen.reduce((som, p) => som + (Number(p.aantal) || 1), 0);
    return {
      puzzels: gezocht(rijen),
      gevonden: dozen,
      dozen,
      keuzelijsten: keuzelijsten(),
      bron: {naam: BRON, licentie: BRON_LICENTIE, aan: Boolean(bronAan)},
    };
  }

  // ---- Routes -----------------------------------------------------------------
  async function handle(req, res, url){
    const pad = url.pathname;
    if (pad === '/api/puzzels' && req.method === 'GET') {
      return stuur(res, 200, overzicht(filtersUit(url)));
    }
    if ((pad === '/api/puzzels/lijst' || pad === '/api/puzzels/lijst.csv') && req.method === 'GET') {
      const filters = filtersUit(url);
      if (pad.endsWith('.csv')) {
        res.writeHead(200, {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="puzzels-lijst-${nu().toISOString().slice(0, 10)}.csv"`,
          'cache-control': 'no-store',
        });
        return res.end(printCsv(filters));
      }
      res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
      return res.end(printHtml(filters));
    }
    if (pad === '/api/puzzels/keuzelijsten' && req.method === 'GET') return stuur(res, 200, keuzelijsten());

    if (pad === '/api/puzzels/zoek' && req.method === 'GET') {
      const code = url.searchParams.get('code') || '';
      const ververs = url.searchParams.get('ververs') === '1';
      try { return stuur(res, 200, await zoekCode(code, {ververs})); }
      catch (fout) { return stuur(res, 400, {error: fout.message}); }
    }

    if (pad === '/api/puzzels' && req.method === 'POST') {
      const gegevens = await leesLichaam(req);
      try { return stuur(res, 201, {puzzel: maak(gegevens)}); }
      catch (fout) { return stuur(res, 400, {error: fout.message}); }
    }

    const fotoPad = pad.match(/^\/api\/puzzels\/(\d+)\/foto$/);
    if (fotoPad && req.method === 'POST') {
      const gegevens = await leesLichaam(req, 6_000_000);
      try { return stuur(res, 200, {foto: bewaarFoto(Number(fotoPad[1]), gegevens.afbeelding)}); }
      catch (fout) { return stuur(res, 400, {error: fout.message}); }
    }

    const idPad = pad.match(/^\/api\/puzzels\/(\d+)$/);
    if (idPad) {
      const id = Number(idPad[1]);
      if (req.method === 'GET') {
        const puzzel = rij(id);
        return puzzel ? stuur(res, 200, naarBuiten(puzzel)) : stuur(res, 404, {error: 'Deze puzzel bestaat niet (meer).'});
      }
      if (req.method === 'PATCH' || req.method === 'PUT') {
        const gegevens = await leesLichaam(req);
        try {
          const uitkomst = wijzig(id, gegevens);
          return uitkomst ? stuur(res, 200, {puzzel: uitkomst}) : stuur(res, 404, {error: 'Deze puzzel bestaat niet (meer).'});
        } catch (fout) { return stuur(res, 400, {error: fout.message}); }
      }
      if (req.method === 'DELETE') {
        const uitkomst = verwijder(id);
        return uitkomst ? stuur(res, 200, uitkomst) : stuur(res, 404, {error: 'Deze puzzel bestaat niet (meer).'});
      }
    }
    return stuur(res, 404, {error: 'Onbekende puzzelroute.'});
  }

  function leesLichaam(req, max = 1_000_000){
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

  return {handle, zoekCode, maak, wijzig, verwijder, bewaarFoto, overzicht, keuzelijsten, zoekBijBron, printHtml, printCsv, zeef, STATUSSEN, SOORTEN, normaliseerCode, stukkenUit};
}

module.exports = {createPuzzels, STATUSSEN, STATUS_TEKST, SOORTEN, normaliseerCode, stukkenUit};
