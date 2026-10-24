const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const repo = path.join(__dirname, '..');
const helper = path.join(repo, 'deploy/proxmox/fetch-discogs-catalog.sh');

test('de Discogs-catalogus wordt uitgepakt, gevalideerd en eenzelfde versie wordt hergebruikt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discogs-install-'));
  try {
    const database = path.join(dir, 'fixture.sqlite');
    const db = new DatabaseSync(database);
    db.exec(`CREATE TABLE records (
      barcode TEXT NOT NULL, release_id TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL,
      year TEXT NOT NULL, label TEXT NOT NULL, format TEXT NOT NULL, genre TEXT NOT NULL, style TEXT NOT NULL,
      PRIMARY KEY(barcode,release_id)
    ) WITHOUT ROWID;
    CREATE VIRTUAL TABLE records_fts USING fts5(title,artist,barcode UNINDEXED,release_id UNINDEXED,tokenize='trigram');
    INSERT INTO records VALUES('7961220922684','21','Neural Response EP','E.B.E. (2)','2000','Force Inc.','Vinyl / 12-inch / EP','Electronic','Deep House');
    INSERT INTO records_fts(title,artist,barcode,release_id) SELECT title,artist,barcode,release_id FROM records;`);
    db.close();
    const archive = path.join(dir, 'catalog.sqlite.gz');
    fs.writeFileSync(archive, zlib.gzipSync(fs.readFileSync(database)));
    const sha = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    const destination = path.join(dir, 'installed', 'discogs-vinyl.sqlite');

    execFileSync('bash', [helper, '--local', `file://${archive}`, sha, destination], {encoding: 'utf8'});
    assert.ok(fs.statSync(destination).size > 0);
    const installed = new DatabaseSync(destination, {readOnly: true});
    assert.equal(installed.prepare('SELECT COUNT(*) AS n FROM records').get().n, 1);
    assert.equal(installed.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='records_fts'").get().n, 1);
    installed.close();

    const again = execFileSync('bash', [helper, '--local', `file://${archive}`, sha, destination], {encoding: 'utf8'});
    assert.match(again, /aanwezig/i);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('een onjuiste checksum vervangt geen eerder geïnstalleerde catalogus', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'discogs-checksum-'));
  try {
    const database = path.join(dir, 'fixture.sqlite');
    const db = new DatabaseSync(database);
    db.exec(`CREATE TABLE records (
      barcode TEXT NOT NULL, release_id TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL,
      year TEXT NOT NULL, label TEXT NOT NULL, format TEXT NOT NULL, genre TEXT NOT NULL, style TEXT NOT NULL,
      PRIMARY KEY(barcode,release_id)
    ) WITHOUT ROWID;
    CREATE VIRTUAL TABLE records_fts USING fts5(title,artist,barcode UNINDEXED,release_id UNINDEXED,tokenize='trigram');
    INSERT INTO records VALUES('7961220922684','21','Neural Response EP','E.B.E. (2)','2000','Force Inc.','Vinyl / LP','Electronic','Deep House');
    INSERT INTO records_fts(title,artist,barcode,release_id) SELECT title,artist,barcode,release_id FROM records;`);
    db.close();
    const archive = path.join(dir, 'catalog.sqlite.gz');
    fs.writeFileSync(archive, zlib.gzipSync(fs.readFileSync(database)));
    const sha = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    const destination = path.join(dir, 'installed', 'discogs-vinyl.sqlite');
    execFileSync('bash', [helper, '--local', `file://${archive}`, sha, destination], {encoding: 'utf8'});
    const before = crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex');
    assert.throws(() => execFileSync('bash', [helper, '--local', `file://${archive}`, '0'.repeat(64), destination], {encoding: 'utf8'}));
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex'), before);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('installatie en updates koppelen de catalogus aan de blijvende LXC-data', () => {
  const deploy = path.join(repo, 'deploy/proxmox');
  const provision = fs.readFileSync(path.join(deploy, 'provision-voorraadthuis.sh'), 'utf8');
  const update = fs.readFileSync(path.join(deploy, 'update-from-github.sh'), 'utf8');
  assert.match(provision, /Environment=PLATEN_DISCOGS_DB=\/var\/lib\/voorraadthuis\/discogs-vinyl\.sqlite/);
  assert.match(provision, /fetch-discogs-catalog\.sh.*\$CTID/);
  assert.ok(update.includes('Environment=PLATEN_DISCOGS_DB=/var/lib/voorraadthuis/discogs-vinyl.sqlite'));
  assert.match(update, /fetch-discogs-catalog\.sh.*\$CTID/);
  assert.ok(update.indexOf('fetch-discogs-catalog.sh') < update.indexOf('systemctl stop voorraadthuis'));
});
