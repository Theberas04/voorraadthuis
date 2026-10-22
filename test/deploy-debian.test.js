import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(hier, '..');
const script = path.join(root, 'deploy/proxmox/upgrade-debian-13.sh');
const inhoud = fs.readFileSync(script, 'utf8');

// Het binnenwerk (alles tussen <<'BINNEN' en het afsluitende BINNEN) is het deel dat
// ín de container draait. Dat lossen we hier los zodat we het echt kunnen uitproberen.
function binnenwerk() {
  const regels = inhoud.split('\n');
  const begin = regels.findIndex((r) => r.includes("<<'BINNEN'"));
  const eind = regels.findIndex((r, i) => i > begin && r.trim() === 'BINNEN');
  assert.ok(begin > 0 && eind > begin, 'het binnenwerk staat tussen <<\'BINNEN\' en BINNEN');
  return regels.slice(begin + 1, eind).join('\n');
}

function proefmap({metBookworm = true} = {}) {
  const map = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-debian13-'));
  fs.mkdirSync(path.join(map, 'apt/sources.list.d'), {recursive: true});
  const bron = path.join(map, 'apt');
  if (metBookworm) {
    fs.writeFileSync(path.join(bron, 'sources.list'), 'deb http://deb.debian.org/debian bookworm main contrib\ndeb http://security.debian.org/debian-security bookworm-security main\n');
    fs.writeFileSync(path.join(bron, 'sources.list.d/debian.sources'),
      'Types: deb\nURIs: http://deb.debian.org/debian\nSuites: bookworm bookworm-updates\nComponents: main\n');
  }
  // Deze bron hoort níet aangeraakt te worden: er staat geen codenaam in.
  fs.writeFileSync(path.join(bron, 'sources.list.d/nodesource.list'),
    'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main\n');
  // De codenaam komt normaal uit /etc/os-release; in de proef uit een eigen bestand
  // (dit apparaat draait zelf al Debian 13, dus het echte bestand zegt 'trixie').
  fs.writeFileSync(path.join(map, 'debian_version'), '12.11\n');
  fs.writeFileSync(path.join(map, 'os-release'), 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nVERSION_CODENAME=bookworm\n');
  const bewaard = path.join(map, 'bewaard');
  const binnen = path.join(map, 'binnen.sh');
  fs.writeFileSync(binnen, binnenwerk());
  return {map, bron, bewaard, binnen};
}

test('de scriptbestanden voor de systeemsprong zijn syntactisch correct', () => {
  execFileSync('bash', ['-n', script]);
  const {binnen} = proefmap();
  execFileSync('bash', ['-n', binnen]);
});

test('het binnenwerk zet bookworm om naar trixie en laat andere bronnen met rust', () => {
  const {bron, bewaard, binnen, map} = proefmap();
  const uit = execFileSync('bash', [binnen], {
    env: {...process.env, DROOG: '1', BRONNEN: bron, BEWAAR: bewaard,
      VERSIE_BESTAND: path.join(map, 'debian_version'), OS_RELEASE: path.join(map, 'os-release')}, encoding: 'utf8',
  });
  const bronnenlijst = fs.readFileSync(path.join(bron, 'sources.list'), 'utf8');
  const deb822 = fs.readFileSync(path.join(bron, 'sources.list.d/debian.sources'), 'utf8');
  assert.match(bronnenlijst, /trixie main/, 'de gewone bron staat op trixie');
  assert.match(bronnenlijst, /trixie-security/, 'ook de beveiligingsbron is omgezet');
  assert.match(deb822, /Suites: trixie trixie-updates/, 'een deb822-bron wordt ook omgezet');
  assert.ok(!/bookworm/.test(bronnenlijst + deb822), 'er blijft geen bookworm staan');
  assert.equal(fs.readFileSync(path.join(bron, 'sources.list.d/nodesource.list'), 'utf8'),
    'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main\n',
    'een bron zonder codenaam blijft precies zoals hij was');
  assert.ok(fs.existsSync(path.join(bewaard, 'sources.list.voor')), 'de oude bron wordt bewaard');
  assert.ok(fs.existsSync(path.join(bewaard, 'debian.sources.voor')), 'de oude deb822-bron wordt bewaard');
  assert.match(uit, /DROGE PROEF/, 'de droge proef meldt zich');
  fs.rmSync(map, {recursive: true, force: true});
});

test('het binnenwerk stopt als er geen enkele bron op bookworm staat', () => {
  const {bron, bewaard, binnen, map} = proefmap({metBookworm: false});
  let code = 0;
  try {
    execFileSync('bash', [binnen], {env: {...process.env, DROOG: '1', BRONNEN: bron, BEWAAR: bewaard,
      VERSIE_BESTAND: path.join(map, 'debian_version'), OS_RELEASE: path.join(map, 'os-release')}, encoding: 'utf8'});
  } catch (fout) {
    code = fout.status;
  }
  assert.equal(code, 5, 'zonder bookworm-bron stopt het binnenwerk met code 5');
  assert.ok(!fs.existsSync(path.join(bewaard, 'sources.list.voor')), 'er wordt niets bewaard als er niets te doen is');
  fs.rmSync(map, {recursive: true, force: true});
});

test('de sprong van Debian 12 naar 13 is voorzichtig opgezet', () => {
  // Momentopname en terugweg: zonder die twee beginnen we niet.
  assert.match(inhoud, /pct snapshot "\$CTID" "\$SNAPSHOT"/, 'er wordt een momentopname gemaakt');
  assert.match(inhoud, /pct rollback "\$CTID" "\$SNAPSHOT"/, 'terugzetten gebeurt met pct rollback');
  assert.match(inhoud, /Geen momentopname mogelijk/, 'zonder momentopname begint het script niet');
  assert.match(inhoud, /ZONDER_SNAPSHOT=1/, 'er is een noodluik, met waarschuwing');
  // De database gaat mee naar buiten en blijft in de container staan.
  assert.match(inhoud, /voor-debian13\/voorraad\.db/);
  assert.match(inhoud, /pct pull "\$CTID" \/root\/voor-debian13\/voorraad\.db/);
  // Node 22.5+ is nodig voor node:sqlite: na de sprong wordt dat gecontroleerd en zo nodig hersteld.
  assert.match(inhoud, /v22\.\[5-9\]\*/, 'de Node-versie wordt gecontroleerd');
  assert.match(inhoud, /node_22\.x nodistro main/, 'Node 22 wordt zo nodig opnieuw geïnstalleerd');
  // Alleen de sprong 12 -> 13, geen andere codenamen.
  assert.ok(!/bullseye|buster|forky/.test(inhoud), 'geen andere Debian-versies in het script');
  assert.match(inhoud, /VANAF_CODENAAM=bookworm/);
  assert.match(inhoud, /DOEL_CODENAAM=trixie/);
  // De app moet het na de sprong doen, anders komt de momentopname terug.
  assert.match(inhoud, /healthz/);
  assert.match(inhoud, /Momentopname \$SNAPSHOT terugzetten/);
  assert.match(inhoud, /GEEN_TERUG=1/);
});

test('de leeswijzer verwijst naar het sprongscript', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /upgrade-debian-13\.sh/, 'de leeswijzer noemt het script');
  assert.match(readme, /Debian 13/, 'de leeswijzer noemt Debian 13');
});

test('het controleerscript kijkt naar de dingen die een bijwerking laten mislukken', () => {
  const bestand = path.join(root, 'deploy/proxmox/check-voorraadthuis.sh');
  execFileSync('bash', ['-n', bestand]);
  const tekst = fs.readFileSync(bestand, 'utf8');
  // Netwerk, dienst, Node (met node:sqlite), poorten, geheugen en het journaal: precies de
  // dingen die 'App-healthcheck mislukt' kunnen veroorzaken.
  for (const stuk of ['ip -4 -o addr show', 'systemctl is-active voorraadthuis', 'node --version',
    'node:sqlite', 'ss -ltnp', 'free -m', 'journalctl -u voorraadthuis', '/healthz',
    'node_22.x nodistro main', 'provision-voorraadthuis.sh']) {
    assert.ok(tekst.includes(stuk), `het controleerscript mist ${stuk}`);
  }
  // Een gestopte container hoort niet als fout te eindigen, maar met de opdracht erbij.
  const stub = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-pct-'));
  fs.writeFileSync(path.join(stub, 'pct'), '#!/usr/bin/env bash\ncase "$1" in\n status) echo "status: stopped";;\n config) echo "memory: 512";;\nesac\n');
  fs.chmodSync(path.join(stub, 'pct'), 0o755);
  const uit = execFileSync('bash', [bestand, '101'], {env: {...process.env, PATH: `${stub}:${process.env.PATH}`}, encoding: 'utf8'});
  assert.match(uit, /De container draait niet/);
  assert.match(uit, /pct start 101/);
  fs.rmSync(stub, {recursive: true, force: true});
});

test('de bijwerking is geduldig en zegt wat er misgaat', () => {
  const bestand = path.join(root, 'deploy/proxmox/update-from-github.sh');
  const tekst = fs.readFileSync(bestand, 'utf8');
  // Niet na vijftien seconden al 'mislukt': een kleine container heeft langer nodig.
  assert.match(tekst, /for _ in \$\(seq 1 60\)/, 'de gezondheidscontrole wacht lang genoeg');
  assert.match(tekst, /diagnose\(\)/, 'er is een diagnosefunctie');
  assert.match(tekst, /App-healthcheck mislukt[^']*' >&2; diagnose; rollback/, 'bij een mislukte controle komt de diagnose mee');
  // Een container met de oude nginx-opzet wordt vóór het wijzigen herkend.
  assert.match(tekst, /command -v nginx/, 'het script kijkt of deze container nog de oude opzet heeft');
  assert.match(tekst, /Er is niets gewijzigd\./, 'en wijzigt dan niets');
});
