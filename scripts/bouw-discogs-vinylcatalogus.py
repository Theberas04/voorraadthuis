#!/usr/bin/env python3
"""Bouwt de alleen-lezen Discogs-vinylcatalogus uit een maandelijkse Discogs-release-dump.

Gebruik:
    python3 scripts/bouw-discogs-vinylcatalogus.py --dump /pad/discogs_20261101_releases.xml.gz
    python3 scripts/bouw-discogs-vinylcatalogus.py --url  <downloadadres> --uit product-data/discogs-vinyl.sqlite

Wat het doet: leest de releases-dump (XML, gzip) stroomgewijs — dus zonder hem eerst uit te
pakken — en zet elke vinyluitgave met een geldige barcode in een SQLite-database:

    records      barcode, release_id, title, artist, year, label, format, genre, style
                 (primaire sleutel barcode + release_id; één barcode kan bij meerdere persingen horen)
    records_fts  dezelfde velden, doorzoekbaar met de trigram-tokenizer (titel, artiest, barcode)

Alleen metadata: geen hoesafbeeldingen, geen gebruikers- of marketplacegegevens.
De gegevens komen uit de maandelijkse Discogs-dumps, CC0 No Rights Reserved
(https://data.discogs.com/). Naamsvermelding: Discogs-bijdragers.

De uitkomst wordt als release-asset gepubliceerd (zie product-data/README.md) en de app haalt
hem op met deploy/proxmox/fetch-discogs-catalog.sh. Het verslag naast de database
(product-data/discogs-catalogus-verslag.json) vult de getallen in dat README.
"""

import argparse
import gzip
import hashlib
import json
import os
import pathlib
import re
import sqlite3
import subprocess
import sys
import time
import urllib.parse
import xml.sax
import xml.sax.handler

WERKMAP = pathlib.Path(__file__).resolve().parent.parent
STANDAARD_UIT = WERKMAP / "product-data" / "discogs-vinyl.sqlite"
STANDAARD_VERSLAG = WERKMAP / "product-data" / "discogs-catalogus-verslag.json"
LP_BARCODES = WERKMAP / "product-data" / "lp-barcodes.json"

MAAT = re.compile(r'^(\d+)("|″)?$')
INCH = {'12': '12-inch', '10': '10-inch', '7': '7-inch'}


def normaliseer_barcode(waarde):
    """Discogs schrijft barcodes vaak met spaties en streepjes ('0 00758 0989-1 5').
    Alleen de gewone cijfers tellen, zodat een scan of getypte code altijd past."""
    return re.sub(r'[^0-9]', '', waarde or '')


def alleen_cijfers(waarde):
    """Alleen de gewone cijfers 0-9. Discogs bevat soms tekens die Python wél als cijfer ziet
    (zoals het superscript '⁰'), waar int() vervolgens op stukloopt."""
    return bool(waarde) and all('0' <= teken <= '9' for teken in waarde)


def geldige_barcode(waarde):
    """GTIN-8/12/13/14 met kloppend controlecijfer; placeholders (alle cijfers gelijk) vallen af."""
    waarde = (waarde or '').strip()
    if not alleen_cijfers(waarde) or len(waarde) not in (8, 12, 13, 14):
        return False
    if len(set(waarde)) == 1:
        return False
    som = 0
    for i, cijfer in enumerate(reversed(waarde[:-1])):
        som += int(cijfer) * (3 if i % 2 == 0 else 1)
    return (10 - som % 10) % 10 == int(waarde[-1])


def nette_beschrijving(tekst):
    """'12"' wordt '12-inch', de rest blijft zoals Discogs het schrijft."""
    tekst = (tekst or '').strip()
    m = MAAT.match(tekst)
    if m:
        return INCH.get(m.group(1), tekst)
    return tekst


class Releaselezer(xml.sax.handler.ContentHandler):
    """Stroomlezer: houdt per <release> bij wat we nodig hebben en gooit de rest weg."""

    def __init__(self, invoegen, verslag, meld_elke=500_000):
        super().__init__()
        self.invoegen = invoegen
        self.verslag = verslag
        self.meld_elke = meld_elke
        self.aan = False
        self.diepte_artiesten = 0
        self.diepte_extra = 0
        self.diepte_labels = 0
        self.diepte_beschrijvingen = 0
        self.vak = None          # welk tekstvak vult het huidige element
        self.vak_element = None  # bij welk element dat tekstvak hoort
        self.pad = []            # de elementen waarin we nu zitten, om ouders te kunnen zien
        self.placeholder_codes = set()
        self.leeg()

    def leeg(self):
        self.vak, self.vak_element = None, None
        self.release_id = ''
        self.titel = ''
        self.artiest = ''
        self.label = ''
        self.jaar = ''
        self.genres = []
        self.stijlen = []
        self.formaten = []       # lijst van (is_vinyl, beschrijving)
        self.barcodes = []
        self.huidig_formaat = None

    # --- elementen ---------------------------------------------------------
    def startElement(self, naam, attrs):
        if naam == 'release':
            self.aan = True
            self.leeg()
            self.pad = [naam]
            self.release_id = (attrs.get('id') or '').strip()
            self.verslag['releases'] += 1
            if self.verslag['releases'] % self.meld_elke == 0:
                print(f"  {self.verslag['releases']:,} releases gelezen "
                      f"({self.verslag['links']:,} vinylregels)".replace(',', '.'), flush=True)
            return
        if not self.aan:
            return
        ouder = self.pad[-1] if self.pad else ''
        self.pad.append(naam)

        if naam == 'artists':
            self.diepte_artiesten += 1
        elif naam == 'extraartists':
            self.diepte_extra += 1
        elif naam == 'labels':
            self.diepte_labels += 1
        elif naam == 'descriptions':
            self.diepte_beschrijvingen += 1
        elif naam == 'name' and ouder == 'artist' and self.diepte_artiesten and not self.diepte_extra and not self.artiest:
            self.vak, self.vak_element = 'artiest', naam
        elif naam == 'title' and ouder == 'release':
            # de titel van de uitgave; <title> bestaat ook onder <video>, <track> en in <notes>
            self.vak, self.vak_element = 'titel', naam
        elif naam == 'label' and ouder == 'labels' and not self.label:
            self.label = (attrs.get('name') or '').strip()
        elif naam == 'format':
            self.huidig_formaat = {'naam': (attrs.get('name') or '').strip(), 'beschrijvingen': []}
            self.formaten.append(self.huidig_formaat)
        elif naam == 'description' and ouder == 'descriptions' and self.huidig_formaat is not None:
            self.vak, self.vak_element = 'beschrijving', naam
        elif naam == 'genre':
            self.vak, self.vak_element = 'genre', naam
        elif naam == 'style':
            self.vak, self.vak_element = 'stijl', naam
        elif naam == 'released' and not self.jaar:
            self.vak, self.vak_element = 'jaar', naam
        elif naam == 'identifier' and (attrs.get('type') or '').lower() == 'barcode':
            waarde = (attrs.get('value') or '').strip()
            if waarde:
                self.barcodes.append(waarde)

    def characters(self, tekst):
        if not self.aan or not self.vak or not tekst:
            return
        if not self.pad or self.pad[-1] != self.vak_element:
            return          # tekst van een ander element (bijv. een titel in <notes>) hoort hier niet
        if self.vak == 'titel':
            self.titel += tekst
        elif self.vak == 'artiest':
            self.artiest += tekst
        elif self.vak == 'beschrijving':
            if self.huidig_formaat is not None:
                self.huidig_formaat['_tekst'] = self.huidig_formaat.get('_tekst', '') + tekst
        elif self.vak == 'genre':
            self.genres.append(tekst)
        elif self.vak == 'stijl':
            self.stijlen.append(tekst)
        elif self.vak == 'jaar':
            self.jaar += tekst

    def endElement(self, naam):
        if naam == 'release':
            self.pad = []
            try:
                self.verwerk()
            except Exception as fout:  # één raar record mag een ronde van uren niet stoppen
                self.verslag['onverwacht'] += 1
                if self.verslag['onverwacht'] <= 10:
                    print(f"  (release {self.release_id} overgeslagen: {fout})", flush=True)
            self.aan = False
            self.vak, self.vak_element = None, None
            return
        if not self.aan:
            return
        if naam == 'artists':
            self.diepte_artiesten = max(0, self.diepte_artiesten - 1)
        elif naam == 'extraartists':
            self.diepte_extra = max(0, self.diepte_extra - 1)
        elif naam == 'labels':
            self.diepte_labels = max(0, self.diepte_labels - 1)
        elif naam == 'descriptions':
            self.diepte_beschrijvingen = max(0, self.diepte_beschrijvingen - 1)
        elif naam == 'description':
            if self.huidig_formaat is not None:
                tekst = nette_beschrijving(self.huidig_formaat.pop('_tekst', ''))
                if tekst:
                    self.huidig_formaat['beschrijvingen'].append(tekst)
        elif naam == 'format':
            self.huidig_formaat = None
        elif naam in ('title', 'name', 'genre', 'style', 'released'):
            self.vak, self.vak_element = None, None
        if self.pad:
            self.pad.pop()

    # --- de rij ------------------------------------------------------------
    def verwerk(self):
        vinyl = None
        for formaat in self.formaten:
            naam = formaat['naam'].lower()
            if 'vinyl' in naam or any('vinyl' in b.lower() for b in formaat['beschrijvingen']):
                vinyl = formaat
                break
        if vinyl is None:
            self.verslag['geen_vinyl'] += 1
            return
        if not self.barcodes:
            self.verslag['geen_barcode'] += 1
            return
        kandidaten = list(dict.fromkeys(b for b in (normaliseer_barcode(b) for b in self.barcodes) if b))
        goed = [b for b in kandidaten if geldige_barcode(b)]
        if not goed:
            if any(len(set(b)) == 1 for b in kandidaten):
                self.verslag['placeholder'] += 1
                self.placeholder_codes.update(b for b in kandidaten if len(set(b)) == 1)
            else:
                self.verslag['ongeldige_barcode'] += 1
            return

        formaat_tekst = ' / '.join([vinyl['naam']] + vinyl['beschrijvingen']).strip(' /')
        jaar = re.sub(r'[^0-9]', '', self.jaar)[:4]
        titel = ' '.join(self.titel.split())
        artiest = ' '.join(self.artiest.split())
        genres = ' / '.join(dict.fromkeys(g.strip() for g in self.genres if g.strip()))
        stijlen = ' / '.join(dict.fromkeys(s.strip() for s in self.stijlen if s.strip()))
        for barcode in goed:
            # Eén uitgave mag meerdere barcodes hebben (bijvoorbeeld twee persingen onder één invoer).
            # De app zoekt op elke barcode, dus ze horen allemaal in de catalogus; het zoeken op
            # varianten met andere voorloopnullen doet de app zelf (barcodeVarianten in platen.js).
            self.invoegen((barcode, self.release_id, titel, artiest, jaar, self.label,
                           formaat_tekst, genres, stijlen))
            self.verslag['links'] += 1


def haal_op(url, doel):
    print(f"Ophalen: {url}", flush=True)
    subprocess.run(['curl', '-L', '--fail', '--retry', '5', '--retry-delay', '10', '-C', '-',
                    '-o', str(doel), url], check=True)


def lees_dump(pad, lezer):
    begon = time.time()
    with gzip.open(pad, 'rb') as stroom:
        ontleder = xml.sax.make_parser()
        ontleder.setContentHandler(lezer)
        ontleder.parse(stroom)
    return time.time() - begon


def main():
    ontleder = argparse.ArgumentParser(description='Bouwt de Discogs-vinylcatalogus uit een release-dump.')
    bron = ontleder.add_mutually_exclusive_group(required=True)
    bron.add_argument('--dump', help='bestaand bestand discogs_<datum>_releases.xml.gz')
    bron.add_argument('--url', help='adres van de dump; wordt opgehaald naar --werkmap')
    ontleder.add_argument('--werkmap', default='/home/hermes/discogs-work',
                          help='waar een opgehaalde dump terechtkomt')
    ontleder.add_argument('--uit', default=str(STANDAARD_UIT))
    ontleder.add_argument('--verslag', default=str(STANDAARD_VERSLAG))
    args = ontleder.parse_args()

    dump = pathlib.Path(args.dump) if args.dump else None
    if dump is None:
        naam = urllib.parse.unquote(args.url.split('/')[-1]) or 'discogs_releases.xml.gz'
        naam = naam if naam.endswith('.gz') else naam + '.gz'
        dump = pathlib.Path(args.werkmap) / naam
        if not dump.exists():
            dump.parent.mkdir(parents=True, exist_ok=True)
            haal_op(args.url, dump)
    if not dump.exists():
        sys.exit(f'De dump staat er niet: {dump}')

    datum = re.search(r'(\d{8})', dump.name)
    datum = datum.group(1) if datum else ''
    verslag = {'dump': dump.name, 'dumpdatum': datum, 'releases': 0, 'links': 0, 'onverwacht': 0,
               'geen_vinyl': 0, 'geen_barcode': 0, 'ongeldige_barcode': 0, 'placeholder': 0}
    print(f"Lezen: {dump.name} ({dump.stat().st_size / 1e9:.2f} GB)", flush=True)

    uit = pathlib.Path(args.uit)
    uit.parent.mkdir(parents=True, exist_ok=True)
    if uit.exists():
        uit.unlink()
    db = sqlite3.connect(uit)
    db.executescript("""
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        CREATE TABLE records (
          barcode TEXT NOT NULL, release_id TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL,
          year TEXT NOT NULL, label TEXT NOT NULL, format TEXT NOT NULL, genre TEXT NOT NULL,
          style TEXT NOT NULL, PRIMARY KEY(barcode, release_id)
        ) WITHOUT ROWID;
    """)
    db.commit()

    wachtrij = []

    def invoegen(rij):
        wachtrij.append(rij)
        if len(wachtrij) >= 20_000:
            db.executemany('INSERT OR IGNORE INTO records VALUES (?,?,?,?,?,?,?,?,?)', wachtrij)
            db.commit()
            wachtrij.clear()

    lezer = Releaselezer(invoegen, verslag)
    verslag['duur_lezen_s'] = round(lees_dump(dump, lezer), 1)
    if wachtrij:
        db.executemany('INSERT OR IGNORE INTO records VALUES (?,?,?,?,?,?,?,?,?)', wachtrij)
        wachtrij.clear()
    db.commit()
    verslag['placeholder_codes'] = len(lezer.placeholder_codes)

    print('Zoekindex (trigram) bouwen...', flush=True)
    db.executescript("""
        CREATE VIRTUAL TABLE records_fts USING fts5(
          title, artist, barcode UNINDEXED, release_id UNINDEXED, tokenize='trigram');
        INSERT INTO records_fts(title, artist, barcode, release_id)
          SELECT title, artist, barcode, release_id FROM records;
    """)
    db.commit()
    db.execute("INSERT INTO records_fts(records_fts) VALUES('optimize')")
    db.commit()

    verslag['unieke_barcodes'] = db.execute('SELECT COUNT(DISTINCT barcode) FROM records').fetchone()[0]
    verslag['rijen'] = db.execute('SELECT COUNT(*) FROM records').fetchone()[0]
    db.close()

    # Vergelijking met de lokale MusicBrainz-barcodelijst (voor de cijfers in het README).
    if LP_BARCODES.exists():
        mb = {str(sleutel).strip() for sleutel in json.loads(LP_BARCODES.read_text('utf-8'))}
        db = sqlite3.connect(f'file:{uit}?mode=ro', uri=True)
        eigen = {rij[0] for rij in db.execute('SELECT DISTINCT barcode FROM records')}
        db.close()
        verslag['musicbrainz_barcodes'] = len(mb)
        verslag['in_beide'] = len(eigen & mb)
        verslag['nieuw_tov_musicbrainz'] = len(eigen - mb)

    verslag['bestand'] = str(uit.relative_to(WERKMAP)) if str(uit).startswith(str(WERKMAP)) else str(uit)
    verslag['bytes'] = uit.stat().st_size
    print('Inpakken en controlegetal bepalen...', flush=True)
    gz = pathlib.Path(str(uit) + '.gz')
    with open(uit, 'rb') as bron_bestand, gzip.open(gz, 'wb', compresslevel=9) as doel:
        while True:
            brok = bron_bestand.read(8 * 1024 * 1024)
            if not brok:
                break
            doel.write(brok)
    sha = hashlib.sha256()
    with open(gz, 'rb') as bestand:
        for brok in iter(lambda: bestand.read(8 * 1024 * 1024), b''):
            sha.update(brok)
    verslag['gz_bestand'] = gz.name
    verslag['gz_bytes'] = gz.stat().st_size
    verslag['gz_sha256'] = sha.hexdigest()
    verslag['asset_naam'] = f'discogs-vinyl-{datum}.sqlite.gz' if datum else gz.name

    pathlib.Path(args.verslag).write_text(json.dumps(verslag, indent=2, ensure_ascii=False) + '\n', 'utf-8')

    print()
    print(f"Dump            : {verslag['dump']} ({verslag['dumpdatum']})")
    print(f"Releases gelezen: {verslag['releases']:,}".replace(',', '.'))
    print(f"Vinylregels     : {verslag['links']:,}".replace(',', '.'))
    print(f"Unieke barcodes : {verslag['unieke_barcodes']:,}".replace(',', '.'))
    if 'nieuw_tov_musicbrainz' in verslag:
        print(f"  nieuw t.o.v. MusicBrainz: {verslag['nieuw_tov_musicbrainz']:,}".replace(',', '.'))
    print(f"Overgeslagen    : geen vinyl {verslag['geen_vinyl']:,}, "
          f"geen barcode {verslag['geen_barcode']:,}, ongeldige barcode {verslag['ongeldige_barcode']:,}"
          .replace(',', '.'))
    if verslag.get('onverwacht'):
        print(f"Onverwacht      : {verslag['onverwacht']:,}".replace(',', '.')
              + ' releases overgeslagen wegens een onverwachte fout')
    print(f"Leestijd        : {verslag['duur_lezen_s']} s")
    print(f"Database        : {verslag['bytes'] / 1e6:.1f} MB -> {gz.name} "
          f"({verslag['gz_bytes'] / 1e6:.1f} MB)")
    print(f"SHA-256         : {verslag['gz_sha256']}")
    print(f"Verslag         : {args.verslag}")


if __name__ == '__main__':
    main()
