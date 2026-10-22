#!/usr/bin/env python3
"""Haalt de huismerken van Nederlandse supermarkten uit Open Food Facts.

Het resultaat staat in `product-data/`:

- `nl-huismerken.json` — per barcode de naam, het merk, de hoeveelheid en de winkel;
- `winkelprefixen.json` — welke barcode-reeksen bij welke supermarkt horen.

Daarmee herkent de app huismerken meteen, zonder opzoeking bij de databank. Open Food
Facts is open data onder de ODbL 1.0; de bestanden gaan daarom met naamsvermelding mee.

Gebruik:  python3 scripts/fetch-huismerken.py [--pagina-grootte 100]
De zoek-API van Open Food Facts vraagt om rustig aan te doen (ongeveer tien zoekvragen
per minuut), dus dit duurt een tijdje. De voortgang wordt per pagina bewaard.
"""
import argparse
import collections
import json
import subprocess
import time
from pathlib import Path

UA = 'VoorraadThuis/1.0 (self-hosted huishoudapp; https://github.com/Theberas04/voorraadthuis)'
MERKEN = ['albert-heijn', 'jumbo', 'lidl', 'aldi', 'plus', 'dirk', 'coop-nl', 'vomar',
          'spar', 'hoogvliet', 'dekamarkt', 'poiesz', 'jan-linders', 'boni', 'mcd',
          'digros', 'bas-van-der-heijden',
          # Huismerken van Lidl en Aldi staan in de databank onder hun eigen merknaam
          # (bijv. milbona, k-classic). Zonder deze merken blijft het grootste deel van
          # die schappen onbekend; ze worden hierna aan de juiste keten gekoppeld.
          'ah', 'jumbo-extra', 'milbona', 'freeway', 'pilos', 'dulano', 'vitasia', 'italiamo',
          'combino', 'belbake', 'cien', 'w5', 'sondey', 'alesto', 'solevita', 'crownfield',
          'snack-day', 'chef-select', 'tradizionale', 'maribel', 'gut-bio', 'milsani',
          'berghoff', 'k-classic', 'golden-river', 'aldi-nord', 'netto', 'norma']
NAMEN = {
    'albert-heijn': 'Albert Heijn', 'jumbo': 'Jumbo', 'lidl': 'Lidl', 'aldi': 'Aldi',
    'plus': 'PLUS', 'dirk': 'Dirk', 'coop-nl': 'Coop', 'vomar': 'Vomar', 'spar': 'Spar',
    'hoogvliet': 'Hoogvliet', 'dekamarkt': 'DekaMarkt', 'poiesz': 'Poiesz',
    'jan-linders': 'Jan Linders', 'boni': 'Boni', 'mcd': 'MCD', 'digros': 'Digros',
    'bas-van-der-heijden': 'Bas van der Heijden',
    # Merknamen waaronder huismerken van Lidl en Aldi in de databank staan.
    'ah': 'Albert Heijn', 'jumbo-extra': 'Jumbo', 'milbona': 'Lidl', 'freeway': 'Lidl', 'pilos': 'Lidl',
    'dulano': 'Lidl', 'vitasia': 'Lidl', 'italiamo': 'Lidl', 'combino': 'Lidl', 'belbake': 'Lidl', 'cien': 'Lidl',
    'w5': 'Lidl', 'sondey': 'Lidl', 'alesto': 'Lidl', 'solevita': 'Lidl', 'crownfield': 'Lidl',
    'snack-day': 'Lidl', 'chef-select': 'Lidl', 'tradizionale': 'Lidl', 'maribel': 'Lidl',
    'gut-bio': 'Aldi', 'milsani': 'Aldi', 'berghoff': 'Aldi', 'k-classic': 'Aldi', 'golden-river': 'Aldi',
    'aldi-nord': 'Aldi', 'netto': 'Netto', 'norma': 'Norma',
}
VELDEN = ('code,product_name,product_name_nl,generic_name,generic_name_nl,brands,quantity,'
          'categories_tags,image_front_small_url,lang')
WORTEL = Path(__file__).resolve().parent.parent
DOEL = WORTEL / 'product-data'
TIJDELIJK = DOEL / '.voortgang'


def haal(url, pogingen=4):
    for poging in range(pogingen):
        r = subprocess.run(['curl', '-sS', '-m', '40', '-A', UA, '-w', '\n%{http_code}', url],
                           capture_output=True, text=True)
        body, _, code = r.stdout.rpartition('\n')
        try:
            gegevens = json.loads(body)
            if code.strip() == '200':
                return gegevens
        except Exception:
            pass
        time.sleep(5 + 5 * poging)
    return None


def ophalen(pagina_grootte, rust):
    DOEL.mkdir(parents=True, exist_ok=True)
    TIJDELIJK.mkdir(parents=True, exist_ok=True)
    bestand = TIJDELIJK / 'ruw.json'
    voortgang_bestand = TIJDELIJK / 'voortgang.json'
    producten = json.loads(bestand.read_text()) if bestand.exists() else {}
    voortgang = json.loads(voortgang_bestand.read_text()) if voortgang_bestand.exists() else {}
    for merk in MERKEN:
        if voortgang.get(merk, {}).get('klaar'):
            print(f'{merk}: al klaar ({voortgang[merk]["aantal"]})', flush=True)
            continue
        pagina = voortgang.get(merk, {}).get('pagina', 1)
        aantal = voortgang.get(merk, {}).get('aantal', 0)
        while True:
            gegevens = haal(f'https://world.openfoodfacts.org/api/v2/search?brands_tags={merk}'
                            f'&fields={VELDEN}&page_size={pagina_grootte}&page={pagina}')
            if not gegevens:
                print(f'{merk}: pagina {pagina} mislukt; gestopt', flush=True)
                break
            rijen = gegevens.get('products', [])
            for rij in rijen:
                code = str(rij.get('code') or '').strip()
                naam = (rij.get('product_name_nl') or rij.get('generic_name_nl') or rij.get('product_name')
                        or rij.get('generic_name') or '').strip()
                if not code or not naam:
                    continue
                producten[code] = {
                    'n': naam[:120],
                    'm': str(rij.get('brands') or '').split(',')[0].strip()[:60],
                    'h': str(rij.get('quantity') or '').strip()[:40],
                    't': str(rij.get('lang') or '').strip()[:8],
                    'k': ','.join(rij.get('categories_tags') or [])[:200],
                    'w': NAMEN.get(merk, merk),
                }
                aantal += 1
            voortgang[merk] = {'pagina': pagina, 'aantal': aantal, 'klaar': len(rijen) < pagina_grootte}
            voortgang_bestand.write_text(json.dumps(voortgang, indent=1))
            bestand.write_text(json.dumps(producten, ensure_ascii=False, separators=(',', ':')))
            print(f'{merk}: pagina {pagina} -> {len(rijen)} rijen ({aantal} totaal)', flush=True)
            if len(rijen) < pagina_grootte:
                break
            pagina += 1
            time.sleep(rust)
        time.sleep(3)
    return producten


def geldige_gtin(code):
    """Alleen barcodes die een scanner echt kan lezen: lengte 8/12/13/14 en kloppend controlecijfer."""
    if not (code.isdigit() and len(code) in (8, 12, 13, 14)):
        return False
    cijfers = [int(c) for c in code]
    *rest, controle = cijfers
    som = sum(cijfer * (3 if i % 2 == 0 else 1) for i, cijfer in enumerate(reversed(rest)))
    return (10 - som % 10) % 10 == controle


def wegschrijven(producten):
    per_winkel = collections.Counter(rij['w'] for rij in producten.values())
    tellers = {7: collections.defaultdict(collections.Counter), 6: collections.defaultdict(collections.Counter)}
    for code, rij in producten.items():
        # Naast gewone EAN-13 gebruiken supermarkten ook EAN-8 voor kleine artikelen.
        # Een barcode met een verkeerd controlecijfer kan geen scanner produceren; die
        # laten we weg zodat de tabel alleen codes bevat die je echt kunt scannen.
        if not geldige_gtin(code):
            continue
        for lengte in (7, 6):
            tellers[lengte][code[:lengte]][rij['w']] += 1
    prefixen = {}
    for lengte in (7, 6):
        for prefix, teller in tellers[lengte].items():
            winkel, aantal = teller.most_common(1)[0]
            if winkel and aantal >= 8 and aantal / sum(teller.values()) >= 0.7:
                prefixen.setdefault(prefix, winkel)
    (DOEL / 'nl-huismerken.json').write_text(json.dumps(producten, ensure_ascii=False, separators=(',', ':')))
    (DOEL / 'winkelprefixen.json').write_text(json.dumps(dict(sorted(prefixen.items())), ensure_ascii=False, indent=0).replace('\n', ''))
    print(json.dumps({
        'huismerkproducten': len(producten),
        'per_winkel': per_winkel.most_common(),
        'winkelprefixen': len(prefixen),
    }, ensure_ascii=False, indent=1))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pagina-grootte', type=int, default=100)
    parser.add_argument('--rust', type=float, default=7.0, help='seconden tussen twee zoekvragen')
    args = parser.parse_args()
    wegschrijven(ophalen(args.pagina_grootte, args.rust))


if __name__ == '__main__':
    main()
