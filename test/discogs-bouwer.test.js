// Tests voor de Discogs-pijplijn van VoorraadThuis: de maandelijkse wikkel (ververs-discogs-catalogus.sh)
// en de bouwer van de alleen-lezen vinylcatalogus. Zo kan een volgende verversing niet stil iets anders
// in de catalogus zetten dan de app verwacht.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {DatabaseSync} = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const repo = path.join(__dirname, '..');
const bouwer = path.join(repo, 'scripts/bouw-discogs-vinylcatalogus.py');
const ververser = path.join(repo, 'scripts/ververs-discogs-catalogus.sh');

// Acht releases die samen elke tak raken: goed vinyl, vinyl zonder barcode, een cd, een vinyl
// met een onjuist controlecijfer, een placeholdercode, een 7"-single, een barcode met
// superscript en een barcode met spaties en streepjes. De volgorde van de elementen is die van
// de echte dump: <title> komt ná <artists>, en er staan ook titels van filmpjes en notities in
// die we niet moeten oppikken (die zouden de titel van de uitgave overschrijven).
const PROEFDUMP = `<?xml version="1.0" encoding="UTF-8"?>
<releases>
<release id="1" status="Accepted">
  <artists><artist><id>1</id><name>E.B.E. (2)</name></artist></artists>
  <title>Neural Response EP</title>
  <labels><label name="Force Inc." catno="FI 021" id="5"/></labels>
  <extraartists><artist><id>2</id><name>Niet Deze</name></artist></extraartists>
  <formats><format name="Vinyl" qty="1" text=""><descriptions><description>12"</description><description>EP</description></descriptions></format></formats>
  <genres><genre>Electronic</genre></genres>
  <styles><style>Deep House</style></styles>
  <country>Germany</country>
  <released>2000</released>
  <notes>De titel van deze uitgave staat hierboven; dit is een filmpjestitel: <title>Filmpje In De Notities</title>.</notes>
  <videos><video src="https://www.youtube.com/watch?v=x" duration="338" embed="true"><title>Filmpje, geen uitgavetitel</title></video></videos>
  <identifiers><identifier type="Barcode" value="7961220922684"/></identifiers>
</release>
<release id="2" status="Accepted">
  <artists><artist><name>Iemand</name></artist></artists>
  <title>Zonder streepjescode</title>
  <labels><label name="Label X" catno="X1"/></labels>
  <formats><format name="Vinyl"><descriptions><description>LP</description></descriptions></format></formats>
  <released>1999</released>
</release>
<release id="3" status="Accepted">
  <artists><artist><name>Cd Artiest</name></artist></artists>
  <title>Een cd dus</title>
  <labels><label name="Label Y"/></labels>
  <formats><format name="CD"><descriptions><description>Album</description></descriptions></format></formats>
  <released>2001</released>
  <identifiers><identifier type="Barcode" value="602557983234"/></identifiers>
</release>
<release id="4" status="Accepted">
  <artists><artist><name>Fout</name></artist></artists>
  <title>Onjuiste code</title>
  <formats><format name="Vinyl"><descriptions><description>7"</description></descriptions></format></formats>
  <released>1968</released>
  <identifiers><identifier type="Barcode" value="1234567890123"/></identifiers>
</release>
<release id="5" status="Accepted">
  <artists><artist><name>Leeg</name></artist></artists>
  <title>Placeholder</title>
  <formats><format name="Vinyl"/></formats>
  <released>1970</released>
  <identifiers><identifier type="Barcode" value="1111111111111"/></identifiers>
</release>
<release id="6" status="Accepted">
  <artists><artist><name>Singel</name></artist></artists>
  <title>Zeven inch met code</title>
  <labels><label name="Label Z"/></labels>
  <formats><format name="Vinyl"><descriptions><description>7"</description><description>Single</description></descriptions></format></formats>
  <released>1965</released>
  <identifiers><identifier type="Barcode" value="0602445070718"/><identifier type="Barcode" value="87137484"/></identifiers>
</release>
<release id="7" status="Accepted">
  <artists><artist><name>Raar</name></artist></artists>
  <title>Superscript-barcode</title>
  <formats><format name="Vinyl"/></formats>
  <released>1972</released>
  <identifiers><identifier type="Barcode" value="⁰¹²³⁴⁵⁶⁷⁸⁹⁰¹²"/></identifiers>
</release>
<release id="8" status="Accepted">
  <artists><artist><name>Sperock</name></artist></artists>
  <title>Met spaties en streepjes</title>
  <labels><label name="D.J. International Records" catno="DJ 989"/></labels>
  <formats><format name="Vinyl" qty="1" text=""><descriptions><description>12"</description><description>33 ⅓ RPM</description></descriptions></format></formats>
  <released>1991</released>
  <identifiers><identifier type="Barcode" description="" value="0 00758 0989-1 5"/></identifiers>
</release>
</releases>
`;

function maakProefdump(map) {
  const dump = path.join(map, 'discogs_20261101_releases.xml.gz');
  fs.writeFileSync(dump, zlib.gzipSync(Buffer.from(PROEFDUMP, 'utf8')));
  return dump;
}

test('de bouwer zet alleen geldige vinylbarcodes in de catalogus en schrijft het verslag', () => {
  const map = fs.mkdtempSync(path.join(os.tmpdir(), 'discogs-bouw-'));
  try {
    const dump = maakProefdump(map);
    const uit = path.join(map, 'catalogus.sqlite');
    const verslagpad = path.join(map, 'verslag.json');
    execFileSync('python3', [bouwer, '--dump', dump, '--uit', uit, '--verslag', verslagpad],
      {encoding: 'utf8', stdio: 'pipe'});

    const verslag = JSON.parse(fs.readFileSync(verslagpad, 'utf8'));
    assert.equal(verslag.releases, 8);
    assert.equal(verslag.links, 4, 'vier koppelingen: een release met twee barcodes telt twee keer');
    assert.equal(verslag.unieke_barcodes, 4);
    assert.equal(verslag.geen_vinyl, 1, 'de cd valt af');
    assert.equal(verslag.geen_barcode, 1);
    assert.equal(verslag.ongeldige_barcode, 2, 'een onjuist controlecijfer en een superscriptcode vallen af');
    assert.equal(verslag.placeholder, 1, 'een code met alleen dezelfde cijfers valt af');
    assert.equal(verslag.placeholder_codes, 1);
    assert.equal(verslag.onverwacht, 0, 'geen enkel record mag de ronde laten klappen');
    assert.ok(verslag.gz_sha256 && verslag.gz_sha256.length === 64, 'het controlegetal van de asset staat erbij');
    assert.ok(fs.existsSync(path.join(map, 'catalogus.sqlite.gz')), 'de asset wordt ingepakt');

    const db = new DatabaseSync(uit, {readOnly: true});
    const rijen = db.prepare('SELECT barcode,release_id,title,artist,year,label,format,genre,style FROM records ORDER BY barcode').all();
    assert.equal(rijen.length, 4);
    assert.equal(rijen.filter(r => r.release_id === '6').length, 2,
      'een uitgave met twee barcodes levert twee rijen op');
    rijen.forEach((rij) => {
      assert.ok(rij.title.length > 0, `rij ${rij.barcode} hoort een titel te hebben`);
      assert.ok(rij.artist.length > 0, `rij ${rij.barcode} hoort een artiest te hebben`);
    });
    const eerste = rijen.find(r => r.barcode === '7961220922684');
    assert.equal(eerste.release_id, '1');
    assert.equal(eerste.title, 'Neural Response EP');
    assert.equal(eerste.artist, 'E.B.E. (2)', 'de eerste artiest, niet de extra artiest');
    assert.equal(eerste.year, '2000');
    assert.equal(eerste.label, 'Force Inc.');
    assert.equal(eerste.format, 'Vinyl / 12-inch / EP');
    assert.equal(eerste.genre, 'Electronic');
    assert.equal(eerste.style, 'Deep House');
    assert.equal(rijen.find(r => r.barcode === '0602445070718').format, 'Vinyl / 7-inch / Single');
    const gespatieerd = rijen.find(r => r.barcode === '000758098915');
    assert.ok(gespatieerd, 'spaties en streepjes in de barcode worden weggelaten');
    assert.equal(gespatieerd.title, 'Met spaties en streepjes');
    assert.equal(gespatieerd.format, 'Vinyl / 12-inch / 33 ⅓ RPM');
    const tabel = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='records_fts'").get();
    assert.equal(tabel.n, 1, 'de zoekindex hoort er te zijn');
    const treffer = db.prepare('SELECT title FROM records_fts WHERE records_fts MATCH ?').all('neural');
    assert.equal(treffer.length, 1, 'de trigram-zoekindex vindt de titel');
    assert.equal(treffer[0].title, 'Neural Response EP');
    db.close();
  } finally {
    fs.rmSync(map, {recursive: true, force: true});
  }
});

test('de maandelijkse wikkel publiceert niets zonder --doen en is syntactisch in orde', () => {
  execFileSync('bash', ['-n', ververser], {stdio: 'pipe'});
  const tekst = fs.readFileSync(ververser, 'utf8');
  const regels = tekst.split('\n');
  regels.forEach((regel, nummer) => assert.equal((regel.match(/"/g) || []).length % 2, 0,
    `ververs-discogs-catalogus.sh regel ${nummer + 1}: oneven aantal aanhalingstekens`));
  assert.match(tekst, /if \[ "\$DOEN" = "1" \]; then[\s\S]*gh release create/, 'publiceren hoort achter --doen te zitten');
  assert.match(tekst, /--doen/, 'de proefstand hoort genoemd te worden');
  assert.match(tekst, /CATALOG_SHA256/, 'de pin in het ophaalscript hoort bijgewerkt te worden');
  assert.match(tekst, /product-data\/README\.md/, 'de cijfers in het README horen bijgewerkt te worden');
});
