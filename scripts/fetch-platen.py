#!/usr/bin/env python3
"""Bouwt een lokale tabel met lp-barcodes op uit MusicBrainz.

MusicBrainz kent bij elke uitgave een barcode; die index is doorzoekbaar. De zoek-API
geeft per vraag echter maar ongeveer 400 resultaten, dus een grote vraag wordt steeds
verder opgedeeld (eerst per jaar, dan per status, dan per soort uitgave en ten slotte op
barcode-cijfers) tot elk deel binnen die grens past. Zo krijg je volledige dekking in
plaats van een steekproef.

Gebruik:
    python3 scripts/fetch-platen.py                 # 12", 10" en vinyl
    python3 scripts/fetch-platen.py --met-zeven     # ook 7"-singles
    python3 scripts/fetch-platen.py --alleen-tellen # eerst kijken hoe groot het is

De uitkomst staat in product-data/lp-barcodes.json (open data, MusicBrainz, CC0 1.0).
"""
import argparse
import json
import re
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

WERKMAP = pathlib.Path(__file__).resolve().parent.parent
DOEL = WERKMAP / 'product-data'
VOORTGANG = DOEL / '.voortgang'
BASIS = 'https://musicbrainz.org/ws/2'
UA = 'VoorraadThuis/1.0 (self-hosted huishoudapp; https://github.com/Theberas04/voorraadthuis)'
RUST = 1.1          # MusicBrainz staat ongeveer één verzoek per seconde toe
VENSTER = 400       # meer dan dit kan de zoek-API niet ophalen
PAGINA = 100
FORMATEN = ['12\\" Vinyl', '10\\" Vinyl', 'Vinyl']
STATUSSEN = ['official', 'promotion', 'bootleg', 'pseudo-release']
SOORTEN = ['Album', 'Single', 'EP', 'Other']
JAAR_MIN, JAAR_MAX = 1948, datetime.now(timezone.utc).year


class TeDiep(Exception):
    """De zoek-API wil niet dieper dan dit venster."""


laatste_verzoek = [0.0]


def haal(adres, pogingen=8):
    for poging in range(1, pogingen + 1):
        wachten = RUST - (time.time() - laatste_verzoek[0])
        if wachten > 0:
            time.sleep(wachten)
        laatste_verzoek[0] = time.time()
        vraag = urllib.request.Request(adres, headers={'user-agent': UA, 'accept': 'application/json'})
        try:
            with urllib.request.urlopen(vraag, timeout=60) as antwoord:
                return json.loads(antwoord.read().decode('utf-8'))
        except urllib.error.HTTPError as fout:
            if fout.code == 400:
                raise TeDiep(adres)
            if fout.code in (429, 503, 500, 502, 504):
                time.sleep(min(60, 3 * poging))
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            time.sleep(min(60, 3 * poging))
    return None


def zoek(vraag, offset=0, limiet=PAGINA):
    adres = f'{BASIS}/release/?query={urllib.parse.quote(vraag)}&fmt=json&limit={limiet}&offset={offset}'
    return haal(adres)


def aantal(vraag):
    """Hoeveel uitgaven voldoen aan deze vraag? None als het niet lukt."""
    try:
        gegevens = zoek(vraag, 0, 1)
    except TeDiep:
        return None
    if not gegevens:
        return None
    return gegevens.get('count')


def jaar_van(datum):
    tekst = str(datum or '')
    return tekst[:4] if len(tekst) >= 4 and tekst[:4].isdigit() else ''


def artiest_van(uitgave):
    return ''.join(f"{deel.get('name', '')}{deel.get('joinphrase', '')}"
                   for deel in (uitgave.get('artist-credit') or [])).strip()


def rij_van(uitgave):
    barcode = ''.join(c for c in str(uitgave.get('barcode') or '') if c.isdigit())
    if len(barcode) < 8 or len(barcode) > 14:
        return None, None
    media = (uitgave.get('media') or [{}])[0]
    label = ((uitgave.get('label-info') or [{}])[0].get('label') or {}).get('name', '')
    groep = (uitgave.get('release-group') or {}).get('id', '')
    formaat = media.get('format') or ''
    if media.get('track-count'):
        formaat = f"{formaat} · {media['track-count']} nummers" if formaat else f"{media['track-count']} nummers"
    return barcode, {
        't': (uitgave.get('title') or '').strip()[:160],
        'a': artiest_van(uitgave)[:160],
        'j': jaar_van(uitgave.get('date')),
        'l': (label or '')[:120],
        'f': formaat[:80],
        'm': uitgave.get('id', ''),
        'g': groep,
    }


def oogst(vraag, producten, teller, diepte=0):
    if teller['nieuw'] - teller.get('laatst_bewaard', 0) >= 500:
        teller['laatst_bewaard'] = teller['nieuw']
        bewaar(producten, teller)
    """Haalt alles op wat aan deze vraag voldoet, en splitst waar nodig."""
    try:
        eerste = zoek(vraag, 0, PAGINA)
    except TeDiep:
        return
    if not eerste:
        return
    totaal = eerste.get('count') or 0
    teller['vragen'] += 1
    if totaal == 0:
        return
    if totaal <= VENSTER:
        rijen = eerste.get('releases') or []
        offset = PAGINA
        while rijen and offset < min(totaal, VENSTER):
            try:
                volgende = zoek(vraag, offset, PAGINA)
            except TeDiep:
                break
            if not volgende or not volgende.get('releases'):
                break
            rijen += volgende['releases']
            offset += PAGINA
        nieuw = 0
        for uitgave in rijen:
            barcode, rij = rij_van(uitgave)
            if not barcode:
                continue
            if barcode not in producten:
                producten[barcode] = rij
                nieuw += 1
        teller['nieuw'] += nieuw
        if nieuw:
            print(f'  {nieuw:5} nieuwe barcodes (totaal {len(producten)})  <- {vraag[:110]}', flush=True)
        return
    # Te groot voor één keer: verder opdelen.
    if diepte >= 32:
        print(f'  [!] blijft te groot ({totaal}) en kan niet verder opgedeeld worden: {vraag[:110]}', flush=True)
        teller['te_groot'].append((vraag, totaal))
        return
    if 'AND date:' not in vraag and ' AND NOT date:' not in vraag:
        # Eerst per jaar.
        for jaar in range(JAAR_MIN, JAAR_MAX + 1):
            oogst(f'{vraag} AND date:{jaar}', producten, teller, diepte + 1)
        oogst(f'{vraag} AND NOT date:[1900 TO 2100]', producten, teller, diepte + 1)
        return
    if ' status:' not in vraag:
        for status in STATUSSEN:
            oogst(f'{vraag} AND status:{status}', producten, teller, diepte + 1)
        return
    if 'primarytype:' not in vraag:
        for soort in SOORTEN:
            oogst(f'{vraag} AND primarytype:{soort}', producten, teller, diepte + 1)
        return
    # Splits op het barcode-einde. MusicBrainz normaliseert voorloopnullen in prefixen
    # (0*, 00*, … worden dezelfde brede query); suffix-wildcards blijven onderscheidend.
    suffixen = [onderdeel[len('barcode:*'):] for onderdeel in vraag.split(' AND ')
                if onderdeel.startswith('barcode:*')]
    suffix = suffixen[-1] if suffixen else ''
    if len(suffix) >= 12:
        print(f'  [!] blijft te groot na suffix-splitsing ({totaal}): {vraag[:110]}', flush=True)
        teller['te_groot'].append((vraag, totaal))
        return
    for cijfer in range(10):
        oogst(f'{vraag} AND barcode:*{suffix}{cijfer}', producten, teller, diepte + 1)


def bewaar(producten, teller, definitief=False):
    VOORTGANG.mkdir(parents=True, exist_ok=True)
    (VOORTGANG / 'lp-ruw.json').write_text(json.dumps(producten, ensure_ascii=False, separators=(',', ':')))
    (VOORTGANG / 'lp-voortgang.json').write_text(json.dumps({
        'bijgewerkt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'producten': len(producten),
        'vragen': teller['vragen'],
        'te_groot': [{'vraag': v, 'aantal': n} for v, n in teller['te_groot']],
    }, ensure_ascii=False, indent=1))
    if definitief:
        DOEL.mkdir(parents=True, exist_ok=True)
        schoon = {code: rij for code, rij in sorted(producten.items()) if rij.get('t')}
        (DOEL / 'lp-barcodes.json').write_text(json.dumps(schoon, ensure_ascii=False, separators=(',', ':')))
        print(f'product-data/lp-barcodes.json geschreven: {len(schoon)} barcodes')


def main():
    parser = argparse.ArgumentParser(description='Lp-barcodes oogsten uit MusicBrainz.')
    parser.add_argument('--met-zeven', action='store_true', help='ook 7"-singles meenemen')
    parser.add_argument('--alleen-tellen', action='store_true', help='alleen laten zien hoe groot elk deel is')
    parser.add_argument('--doorschrijven', action='store_true', help='met de bestaande oogst verdergaan')
    keuzes = parser.parse_args()

    formaten = list(FORMATEN) + (['7\\" Vinyl'] if keuzes.met_zeven else [])
    producten = {}
    if keuzes.doorschrijven and (VOORTGANG / 'lp-ruw.json').exists():
        producten = json.loads((VOORTGANG / 'lp-ruw.json').read_text())
        print(f'verder met {len(producten)} barcodes uit de vorige ronde')

    if keuzes.alleen_tellen:
        for formaat in formaten:
            vraag = f'barcode:* AND format:"{formaat}"'
            print(f'{formaat:14} {aantal(vraag)}')
        return

    teller = {'vragen': 0, 'nieuw': 0, 'te_groot': [], 'laatst_bewaard': 0}
    begin = time.time()
    onaf = []
    statuspad = VOORTGANG / 'lp-voortgang.json'
    if keuzes.doorschrijven and statuspad.exists():
        try:
            onaf = json.loads(statuspad.read_text()).get('te_groot', [])
        except (ValueError, OSError):
            onaf = []
    if onaf:
        print(f'== hervatten: {len(onaf)} deelvragen die vorige keer te groot waren ==', flush=True)
        for item in onaf:
            oogst(item['vraag'], producten, teller)
        # De reeds complete resultaten worden niet opnieuw opgehaald; alleen de mislukte
        # deelvragen worden met de langere prefix-splitsing aangevuld.
        bewaar(producten, teller)
    else:
        for formaat in formaten:
            vraag = f'barcode:* AND format:"{formaat}"'
            print(f'== {formaat} ==', flush=True)
            oogst(vraag, producten, teller)
            bewaar(producten, teller)
    bewaar(producten, teller, definitief=True)
    minuten = (time.time() - begin) / 60
    print(f'klaar: {len(producten)} barcodes, {teller["vragen"]} vragen, {minuten:.1f} minuten')
    if teller['te_groot']:
        print(f'let op: {len(teller["te_groot"])} deel(en) bleven te groot:')
        for vraag, n in teller['te_groot'][:10]:
            print(f'   {n:6}  {vraag[:110]}')


if __name__ == '__main__':
    sys.exit(main())
