#!/usr/bin/env python3
"""Haalt de huismerken van supermarkten uit Open Food Facts.

Het resultaat staat in `product-data/`:

- `nl-huismerken.json` — per barcode de naam, het merk, de hoeveelheid en de winkel;
- `winkelprefixen.json` — welke barcode-reeksen bij welke supermarkt horen.

Daarmee herkent de app huismerken meteen, zonder opzoeking bij de databank. Open Food
Facts is open data onder de ODbL 1.0; de bestanden gaan daarom met naamsvermelding mee.

Naast de Nederlandse ketens worden ook de Duitse en Belgische ketens opgehaald. Bij die
twee landen staat er een landfilter in de zoekvraag: zonder dat filter zou bijvoorbeeld
Carrefour vooral Franse producten opleveren en niet de Belgische.

Gebruik:  python3 scripts/fetch-huismerken.py [--pagina-grootte 100] [--rust 7]
De zoek-API van Open Food Facts vraagt om rustig aan te doen (ongeveer tien zoekvragen
per minuut), dus dit duurt een tijdje. De voortgang wordt per pagina bewaard in
`product-data/.voortgang/`, zodat een onderbroken oogst verdergaat waar hij gebleven was.
"""
import argparse
import collections
import json
import re
import subprocess
import time
from pathlib import Path

UA = 'VoorraadThuis/1.0 (self-hosted huishoudapp; https://github.com/Theberas04/voorraadthuis)'

# Welke merken worden opgehaald. 'land' is optioneel: zonder land wordt niet op land
# gefilterd (zoals de Nederlandse oogst), met land komt er een landfilter in de zoekvraag.
MERKEN = [
    # --- Nederland: de ketens ---
    {'merk': 'albert-heijn', 'winkel': 'Albert Heijn'},
    {'merk': 'jumbo', 'winkel': 'Jumbo'},
    {'merk': 'lidl', 'winkel': 'Lidl'},
    {'merk': 'aldi', 'winkel': 'Aldi'},
    {'merk': 'plus', 'winkel': 'PLUS'},
    {'merk': 'dirk', 'winkel': 'Dirk'},
    {'merk': 'coop-nl', 'winkel': 'Coop'},
    {'merk': 'vomar', 'winkel': 'Vomar'},
    {'merk': 'spar', 'winkel': 'Spar'},
    {'merk': 'hoogvliet', 'winkel': 'Hoogvliet'},
    {'merk': 'dekamarkt', 'winkel': 'DekaMarkt'},
    {'merk': 'poiesz', 'winkel': 'Poiesz'},
    {'merk': 'jan-linders', 'winkel': 'Jan Linders'},
    {'merk': 'boni', 'winkel': 'Boni'},
    {'merk': 'mcd', 'winkel': 'MCD'},
    {'merk': 'digros', 'winkel': 'Digros'},
    {'merk': 'bas-van-der-heijden', 'winkel': 'Bas van der Heijden'},
    # --- Nederland: huismerken die onder hun eigen merknaam in de databank staan ---
    {'merk': 'ah', 'winkel': 'Albert Heijn'},
    {'merk': 'jumbo-extra', 'winkel': 'Jumbo'},
    {'merk': 'milbona', 'winkel': 'Lidl'},
    {'merk': 'freeway', 'winkel': 'Lidl'},
    {'merk': 'pilos', 'winkel': 'Lidl'},
    {'merk': 'dulano', 'winkel': 'Lidl'},
    {'merk': 'vitasia', 'winkel': 'Lidl'},
    {'merk': 'italiamo', 'winkel': 'Lidl'},
    {'merk': 'combino', 'winkel': 'Lidl'},
    {'merk': 'belbake', 'winkel': 'Lidl'},
    {'merk': 'cien', 'winkel': 'Lidl'},
    {'merk': 'w5', 'winkel': 'Lidl'},
    {'merk': 'sondey', 'winkel': 'Lidl'},
    {'merk': 'alesto', 'winkel': 'Lidl'},
    {'merk': 'solevita', 'winkel': 'Lidl'},
    {'merk': 'crownfield', 'winkel': 'Lidl'},
    {'merk': 'snack-day', 'winkel': 'Lidl'},
    {'merk': 'chef-select', 'winkel': 'Lidl'},
    {'merk': 'tradizionale', 'winkel': 'Lidl'},
    {'merk': 'maribel', 'winkel': 'Lidl'},
    {'merk': 'gut-bio', 'winkel': 'Aldi'},
    {'merk': 'milsani', 'winkel': 'Aldi'},
    {'merk': 'berghoff', 'winkel': 'Aldi'},
    {'merk': 'golden-river', 'winkel': 'Aldi'},
    {'merk': 'aldi-nord', 'winkel': 'Aldi'},
    {'merk': 'netto', 'winkel': 'Netto'},
    {'merk': 'norma', 'winkel': 'Norma'},
    # --- Duitsland ---
    {'merk': 'rewe', 'winkel': 'REWE', 'land': 'en:germany'},
    {'merk': 'rewe-beste-wahl', 'winkel': 'REWE', 'land': 'en:germany'},
    {'merk': 'ja', 'winkel': 'REWE', 'land': 'en:germany'},
    {'merk': 'kaufland', 'winkel': 'Kaufland', 'land': 'en:germany'},
    {'merk': 'k-classic', 'winkel': 'Kaufland', 'land': 'en:germany'},
    {'merk': 'k-bio', 'winkel': 'Kaufland', 'land': 'en:germany'},
    {'merk': 'k-take-it', 'winkel': 'Kaufland', 'land': 'en:germany'},
    {'merk': 'edeka', 'winkel': 'Edeka', 'land': 'en:germany'},
    {'merk': 'gut-und-guenstig', 'winkel': 'Edeka', 'land': 'en:germany'},
    {'merk': 'aldi-sud', 'winkel': 'Aldi Süd', 'land': 'en:germany'},
    {'merk': 'aldi-nord', 'winkel': 'Aldi Nord', 'land': 'en:germany'},
    {'merk': 'penny', 'winkel': 'Penny', 'land': 'en:germany'},
    {'merk': 'netto-marken-discount', 'winkel': 'Netto', 'land': 'en:germany'},
    {'merk': 'tegut', 'winkel': 'tegut', 'land': 'en:germany'},
    {'merk': 'globus', 'winkel': 'Globus', 'land': 'en:germany'},
    {'merk': 'marktkauf', 'winkel': 'Marktkauf', 'land': 'en:germany'},
    {'merk': 'real', 'winkel': 'real', 'land': 'en:germany'},
    {'merk': 'diska', 'winkel': 'Diska', 'land': 'en:germany'},
    {'merk': 'famila', 'winkel': 'Famila', 'land': 'en:germany'},
    {'merk': 'nahkauf', 'winkel': 'nahkauf', 'land': 'en:germany'},
    {'merk': 'hit', 'winkel': 'HIT', 'land': 'en:germany'},
    {'merk': 'dennree', 'winkel': 'Dennree', 'land': 'en:germany'},
    {'merk': 'denns-bio-markt', 'winkel': 'denns Biomarkt', 'land': 'en:germany'},
    {'merk': 'alnatura', 'winkel': 'Alnatura', 'land': 'en:germany'},
    {'merk': 'rossmann', 'winkel': 'Rossmann', 'land': 'en:germany'},
    {'merk': 'dm', 'winkel': 'dm', 'land': 'en:germany'},
    # --- België ---
    {'merk': 'colruyt', 'winkel': 'Colruyt', 'land': 'en:belgium'},
    {'merk': 'everyday', 'winkel': 'Colruyt', 'land': 'en:belgium'},
    {'merk': 'bio-time', 'winkel': 'Colruyt', 'land': 'en:belgium'},
    {'merk': 'okay', 'winkel': 'Okay', 'land': 'en:belgium'},
    {'merk': 'delhaize', 'winkel': 'Delhaize', 'land': 'en:belgium'},
    {'merk': '365', 'winkel': 'Delhaize', 'land': 'en:belgium'},
    {'merk': 'care', 'winkel': 'Delhaize', 'land': 'en:belgium'},
    {'merk': 'proxy-delhaize', 'winkel': 'Proxy Delhaize', 'land': 'en:belgium'},
    {'merk': 'carrefour', 'winkel': 'Carrefour', 'land': 'en:belgium'},
    {'merk': 'albert-heijn', 'winkel': 'Albert Heijn', 'land': 'en:belgium'},
    {'merk': 'intermarche', 'winkel': 'Intermarché', 'land': 'en:belgium'},
    {'merk': 'match', 'winkel': 'Match', 'land': 'en:belgium'},
    {'merk': 'cora', 'winkel': 'Cora', 'land': 'en:belgium'},
]

VELDEN = ('code,product_name,product_name_nl,generic_name,generic_name_nl,brands,quantity,'
          'categories_tags,image_front_small_url,lang')
WORTEL = Path(__file__).resolve().parent.parent
DOEL = WORTEL / 'product-data'
TIJDELIJK = DOEL / '.voortgang'
# Wachttijden tussen pogingen als de databank een pagina weigert (dat gebeurt bij drukte).
# De databank laat bij drukte ongeveer de helft van de verzoeken vallen (status 503).
# Veel korte pogingen werken daar beter tegen dan een paar lange wachttijden.
WACHTTIJDEN = [10, 10, 15, 20, 30, 45, 60, 90, 120, 180]

# De zoek-API gaat niet dieper dan pagina 10 (duizend producten). Grote ketens worden
# daarom eerst opgedeeld op voedingswaarde en, als een deel nog te groot is, per productgroep.
GRADEN = ['a', 'b', 'c', 'd', 'e', 'unknown']
HOOFDGROEPEN = [
    'en:beverages', 'en:snacks', 'en:dairies', 'en:meats', 'en:fats', 'en:cereals-and-potatoes',
    'en:fruits-and-vegetables-based-foods', 'en:desserts', 'en:condiments', 'en:seafood',
    'en:meals', 'en:sweet-snacks',
]

def normaliseer_merk(tekst):
    """'K-Classic' en 'k classic' worden allebei 'k-classic', zodat de correctietabel werkt."""
    t = (tekst or '').lower().strip()
    t = t.replace('ä', 'ae').replace('ö', 'oe').replace('ü', 'ue').replace('ß', 'ss')
    return re.sub(r'[^a-z0-9]+', '-', t).strip('-')


# Welke merknaam bij welke winkel hoort. Elke keten uit MERKEN staat erin (zodat een
# oudere rij waarin alleen de merknaam is opgeslagen ook de juiste winkel krijgt), plus de
# huismerken die onder hun eigen naam in de databank staan. Dit corrigeert ook rijen die
# eerder aan de verkeerde winkel hingen: de Kaufland-huismerken (k-classic enzovoort)
# stonden in de eerste oogst bij Aldi.
WINKEL_VAN_MERK = {normaliseer_merk(invoer['merk']): invoer['winkel'] for invoer in MERKEN}
WINKEL_VAN_MERK.update({
    'k-bio': 'Kaufland', 'k-take-it': 'Kaufland',
    'beste-wahl': 'REWE', 'ja-natuerlich': 'REWE', 'gut-guenstig': 'Edeka',
    'everyday': 'Colruyt', 'bio-time': 'Colruyt', '365': 'Delhaize', 'care': 'Delhaize',
    'milbona': 'Lidl', 'freeway': 'Lidl', 'pilos': 'Lidl', 'dulano': 'Lidl', 'vitasia': 'Lidl',
    'italiamo': 'Lidl', 'combino': 'Lidl', 'belbake': 'Lidl', 'cien': 'Lidl', 'w5': 'Lidl',
    'sondey': 'Lidl', 'alesto': 'Lidl', 'solevita': 'Lidl', 'crownfield': 'Lidl',
    'snack-day': 'Lidl', 'chef-select': 'Lidl', 'tradizionale': 'Lidl', 'maribel': 'Lidl',
    'gut-bio': 'Aldi', 'milsani': 'Aldi', 'berghoff': 'Aldi', 'golden-river': 'Aldi',
})


def winkel_van(bron, terugval):
    """De winkel die bij deze rij hoort: het merk is leidend, daarna de al opgeslagen naam."""
    for naam in bron:
        winkel = WINKEL_VAN_MERK.get(normaliseer_merk(naam))
        if winkel:
            return winkel
    return terugval


class TeDiep(Exception):
    """De databank weigert deze pagina: dieper dan duizend producten gaat de zoek-API niet."""


def haal(url, pogingen=10):
    for poging in range(pogingen):
        r = subprocess.run(['curl', '-sS', '-m', '40', '-A', UA, '-w', '\n%{http_code}', url],
                           capture_output=True, text=True)
        body, _, code = r.stdout.rpartition('\n')
        if code.strip() == '401':
            raise TeDiep()
        try:
            gegevens = json.loads(body)
            if code.strip() == '200':
                return gegevens
        except Exception:
            pass
        wacht = WACHTTIJDEN[min(poging, len(WACHTTIJDEN) - 1)]
        print(f'  pagina mislukt (poging {poging + 1}); opnieuw over {wacht} s', flush=True)
        time.sleep(wacht)
    return None


def geldige_gtin(code):
    """Alleen barcodes die een scanner echt kan lezen: lengte 8/12/13/14 en kloppend controlecijfer."""
    if not (code.isdigit() and len(code) in (8, 12, 13, 14)):
        return False
    cijfers = [int(c) for c in code]
    *rest, controle = cijfers
    som = sum(cijfer * (3 if i % 2 == 0 else 1) for i, cijfer in enumerate(reversed(rest)))
    return (10 - som % 10) % 10 == controle




def haal_reeks(adres_basis, sleutel, winkel, pagina_grootte, rust, producten, voortgang, voortgang_bestand, bestand):
    """Haalt alle pagina's van één zoekvraag op.

    Geeft 'klaar' (alles binnen), 'vol' (de databank wil niet dieper dan pagina 10) of
    'mislukt' (tijdelijke storing). De voortgang gaat per zoekvraag naar schijf, zodat een
    onderbroken oogst verdergaat waar hij gebleven was.
    """
    staat = voortgang.get(sleutel, {})
    if staat.get('klaar'):
        print(f'{sleutel}: al klaar ({staat["aantal"]})', flush=True)
        return 'klaar'
    pagina = staat.get('pagina', 1)
    aantal = staat.get('aantal', 0)
    while True:
        # Bij pagina 11 en verder zit de zoekvraag vrijwel zeker aan zijn plafond; dan is
        # lang doorproberen zinloos.
        try:
            gegevens = haal(f'{adres_basis}&page_size={pagina_grootte}&page={pagina}',
                            pogingen=4 if pagina >= 11 else 10)
        except TeDiep:
            gegevens = None
        if not gegevens:
            if pagina >= 11:
                # De zoek-API gaat niet dieper dan pagina 10; deze zoekvraag zit aan zijn plafond.
                print(f'{sleutel}: plafond bij pagina {pagina} ({aantal} rijen)', flush=True)
                voortgang[sleutel] = {'pagina': pagina, 'aantal': aantal, 'klaar': False, 'vol': True}
                voortgang_bestand.write_text(json.dumps(voortgang, indent=1))
                return 'vol'
            print(f'{sleutel}: pagina {pagina} blijft mislukken; gestopt', flush=True)
            return 'mislukt'
        rijen = gegevens.get('products', [])
        for rij in rijen:
            code = str(rij.get('code') or '').strip()
            naam = (rij.get('product_name_nl') or rij.get('generic_name_nl') or rij.get('product_name')
                    or rij.get('generic_name') or '').strip()
            if not code or not naam or not geldige_gtin(code):
                continue
            producten[code] = {
                'n': naam[:120],
                'm': str(rij.get('brands') or '').split(',')[0].strip()[:60],
                'h': str(rij.get('quantity') or '').strip()[:40],
                't': str(rij.get('lang') or '').strip()[:8],
                'k': ','.join(rij.get('categories_tags') or [])[:200],
                'w': winkel_van((rij.get('brands'),), winkel),
            }
            aantal += 1
        klaar = len(rijen) < pagina_grootte
        voortgang[sleutel] = {'pagina': pagina, 'aantal': aantal, 'klaar': klaar}
        voortgang_bestand.write_text(json.dumps(voortgang, indent=1))
        bestand.write_text(json.dumps(producten, ensure_ascii=False, separators=(',', ':')))
        print(f'{sleutel}: pagina {pagina} -> {len(rijen)} rijen ({aantal} totaal)', flush=True)
        if klaar:
            return 'klaar'
        pagina += 1
        time.sleep(rust)


def aantal_producten(merk, land):
    """Hoeveel producten heeft deze zoekvraag in totaal? (één verzoek)"""
    adres = f'https://world.openfoodfacts.org/api/v2/search?brands_tags={merk}&fields=code&page_size=1'
    if land:
        adres += f'&countries_tags={land}'
    try:
        gegevens = haal(adres, pogingen=3)
    except TeDiep:
        return None
    return (gegevens or {}).get('count')


def ophalen(pagina_grootte, rust):
    DOEL.mkdir(parents=True, exist_ok=True)
    TIJDELIJK.mkdir(parents=True, exist_ok=True)
    bestand = TIJDELIJK / 'ruw.json'
    voortgang_bestand = TIJDELIJK / 'voortgang.json'
    producten = json.loads(bestand.read_text()) if bestand.exists() else {}
    voortgang = json.loads(voortgang_bestand.read_text()) if voortgang_bestand.exists() else {}
    for invoer in MERKEN:
        merk, land, winkel = invoer['merk'], invoer.get('land'), invoer['winkel']
        basis = f'https://world.openfoodfacts.org/api/v2/search?brands_tags={merk}&fields={VELDEN}'
        if land:
            basis += f'&countries_tags={land}'
        sleutel = f'{land}:{merk}' if land else merk
        if voortgang.get(sleutel, {}).get('klaar'):
            print(f'{sleutel}: al klaar ({voortgang[sleutel]["aantal"]})', flush=True)
            continue
        # Een zoekvraag levert hooguit duizend producten op (de databank gaat niet dieper dan
        # pagina 10). Bij een grote keten wordt de vraag daarom opgedeeld op voedingswaarde
        # (a tot en met e, plus wat onbekend is), zodat elk deel onder dat plafond blijft.
        totaal = aantal_producten(merk, land) if land else None
        # Lukt de telling niet (de databank weigert nogal eens), dan gaan we voor de
        # veilige kant: opdelen levert in het slechtste geval wat extra zoekvragen op.
        if totaal is None or totaal > 800:
            print(f'{sleutel}: {totaal} producten — opgedeeld in {len(GRADEN)} delen', flush=True)
            for graad in GRADEN:
                deel = f'{sleutel}|{graad}'
                uitkomst = haal_reeks(f'{basis}&nutrition_grades_tags={graad}', deel, winkel, pagina_grootte,
                                      rust, producten, voortgang, voortgang_bestand, bestand)
                if uitkomst == 'vol':
                    print(f'{deel}: nog te groot — extra opdeling per productgroep', flush=True)
                    for groep in HOOFDGROEPEN:
                        haal_reeks(f'{basis}&nutrition_grades_tags={graad}&categories_tags={groep}',
                                   f'{deel}|{groep}', winkel, pagina_grootte, rust, producten, voortgang,
                                   voortgang_bestand, bestand)
                time.sleep(2)
        else:
            haal_reeks(basis, sleutel, winkel, pagina_grootte, rust, producten, voortgang, voortgang_bestand, bestand)
        time.sleep(3)
    return producten


def wegschrijven(producten):
    per_winkel = collections.Counter(rij['w'] for rij in producten.values())
    tellers = {7: collections.defaultdict(collections.Counter), 6: collections.defaultdict(collections.Counter)}
    for code, rij in producten.items():
        # Naast gewone EAN-13 gebruiken supermarkten ook EAN-8 voor kleine artikelen.
        # Een barcode met een verkeerd controlecijfer kan geen scanner produceren; die
        # laten we weg zodat de tabel alleen codes bevat die je echt kunt scannen.
        if not geldige_gtin(code):
            continue
        # Het huismerk van een keten hoort bij die keten, ook als de rij eerder onder een
        # andere winkel is opgeslagen.
        rij['w'] = winkel_van((rij.get('m'), rij.get('w')), rij['w'])
        for lengte in (7, 6):
            tellers[lengte][code[:lengte]][rij['w']] += 1
    prefixen = {}
    for lengte in (7, 6):
        for prefix, teller in tellers[lengte].items():
            winkel, aantal = teller.most_common(1)[0]
            if winkel and aantal >= 8 and aantal / sum(teller.values()) >= 0.7:
                prefixen.setdefault(prefix, winkel)
    schoon = {code: rij for code, rij in producten.items() if geldige_gtin(code)}
    (DOEL / 'nl-huismerken.json').write_text(json.dumps(schoon, ensure_ascii=False, separators=(',', ':')))
    (DOEL / 'winkelprefixen.json').write_text(json.dumps(dict(sorted(prefixen.items())), ensure_ascii=False, indent=0).replace('\n', ''))
    print(json.dumps({
        'huismerkproducten': len(schoon),
        'per_winkel': [w for w in per_winkel.most_common() if w[0]],
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
