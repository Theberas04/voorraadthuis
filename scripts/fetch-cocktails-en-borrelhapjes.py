#!/usr/bin/env python3
"""Haalt de cocktail- en borrelrecepten uit Wikibooks en bouwt de twee databestanden.

Dit script doet de hele keten in één keer:

1. Per bron de paginalijst ophalen (categorieën en prefixen op de Wikibooks-api).
2. De wikitekst van elke pagina ophalen en er ingrediënten en bereidingsstappen uithalen.
   Een pagina telt mee als recept met minstens drie ingrediënten en minstens één
   bereidingsstap.
3. Ontdubbelen en wegschrijven naar recipe-data/wikibooks-cocktails-recipes.json en
   recipe-data/wikibooks-borrelhapjes-recipes.json.

Bronnen (allemaal Wikibooks, CC BY-SA 4.0):

* de.wikibooks.org  Kategorie:Cocktails
* en.wikibooks.org  Bartending/
* fr.wikibooks.org  Livre de cuisine/Boissons/
* hu.wikibooks.org  Kategória:Koktélok en Kategória:Előételek
* en.wikibooks.org  Category:Appetizer recipes en Category:Snack recipes
* nl.wikibooks.org  Categorie:Snack en Categorie:Voorgerecht
* pl.wikibooks.org  Kategoria:Przystawki
* pt.wikibooks.org  Categoria:Entradas
* fr.wikibooks.org  Catégorie:Entrées
* it.wikibooks.org  Categoria:Antipasti

Ontdubbelen gebeurt op dezelfde manier als de app het doet: op de genormaliseerde
titel, tegen alle eerdere imports en tegen de eigen recepten. Een Duitse 'Caipirinha'
valt dus af tegen de Portugese die er al staat.

Gebruik:  python3 scripts/fetch-cocktails-en-borrelhapjes.py [--taal de,en,fr,hu]
"""
import argparse
import json
import re
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BRON = REPO / 'recipe-data'
LICENTIE = {'license': 'CC BY-SA 4.0', 'licenseUrl': 'https://creativecommons.org/licenses/by-sa/4.0/'}
KOPPEN = {'User-Agent': 'VoorraadThuis/1.0 (self-hosted huishoudapp; https://github.com/Theberas04/voorraadthuis)'}

# (soort, taal, wiki, categorie of prefix, is_prefix)
BRONNEN = [
    ('cocktail', 'de', 'de.wikibooks.org', 'Kategorie:Cocktails', False),
    ('cocktail', 'en', 'en.wikibooks.org', 'Bartending/', True),
    ('cocktail', 'fr', 'fr.wikibooks.org', 'Livre de cuisine/Boissons/', True),
    ('cocktail', 'hu', 'hu.wikibooks.org', 'Kategória:Koktélok', False),
    ('borrel', 'hu', 'hu.wikibooks.org', 'Kategória:Előételek', False),
    ('borrel', 'en', 'en.wikibooks.org', 'Category:Appetizer recipes', False),
    ('borrel', 'en', 'en.wikibooks.org', 'Category:Snack recipes', False),
    ('borrel', 'nl', 'nl.wikibooks.org', 'Categorie:Snack', False),
    ('borrel', 'nl', 'nl.wikibooks.org', 'Categorie:Voorgerecht', False),
    ('borrel', 'pl', 'pl.wikibooks.org', 'Kategoria:Przystawki', False),
    ('borrel', 'pt', 'pt.wikibooks.org', 'Categoria:Entradas', False),
    ('borrel', 'fr', 'fr.wikibooks.org', 'Catégorie:Entrées', False),
    ('borrel', 'it', 'it.wikibooks.org', 'Categoria:Antipasti', False),
]

INGREDIENT_KOP = re.compile(r'(zutaten|^ingredients$|hozzávalók|ingredientes|ingredienten|ingrediënten|składniki|ingrédients|ingredienti|ingredientes e preparo)', re.I)
BEREIDING_KOP = re.compile(r'(zubereitung|instructions|procedure|^preparation$|preparación|preparo|elaboração|elkészítés|bereiding|przygotowanie|préparation|preparazione|^method$|como fazer|bereidingswijze|aan de slag)', re.I)
RUIS = re.compile(r'(^\s*[\[{|]|thumb|__NOTOC__|__NOEDITSECTION__|Kategorie|Categor|\[\[Kateg|\[\[Categ|Navigationsleiste|Vorlage)', re.I)


def haal(url, pogingen=4):
    for nummer in range(pogingen):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=KOPPEN), timeout=60) as antwoord:
                return json.load(antwoord)
        except Exception:
            if nummer == pogingen - 1:
                raise
            time.sleep(5 * (nummer + 1))


def norm(value):
    tekst = unicodedata.normalize('NFKD', str(value or ''))
    tekst = ''.join(c for c in tekst if not unicodedata.combining(c)).lower()
    return re.sub(r'[^a-z0-9]', '', tekst) or str(value or '').strip().lower()


def paginalijst(wiki, bron, is_prefix):
    """Alle paginatitels van een categorie of prefix, via de MediaWiki-api."""
    velden = 'pageid|title|lastrevid|timestamp'
    titels = []
    if is_prefix:
        vervolg = None
        while True:
            deel = f'&apcontinue={urllib.parse.quote(vervolg)}' if vervolg else ''
            url = (f'https://{wiki}/w/api.php?action=query&list=allpages&apprefix='
                   f'{urllib.parse.quote(bron)}&aplimit=500&format=json&apnamespace=0{deel}')
            gegevens = haal(url)
            titels += [p['title'] for p in gegevens['query']['allpages']]
            vervolg = gegevens.get('continue', {}).get('apcontinue')
            if not vervolg:
                break
    else:
        vervolg = None
        while True:
            deel = f'&cmcontinue={urllib.parse.quote(vervolg)}' if vervolg else ''
            url = (f'https://{wiki}/w/api.php?action=query&list=categorymembers&cmtitle='
                   f'{urllib.parse.quote(bron)}&cmlimit=500&format=json&cmtype=page{deel}')
            gegevens = haal(url)
            titels += [p['title'] for p in gegevens['query']['categorymembers']]
            vervolg = gegevens.get('continue', {}).get('cmcontinue')
            if not vervolg:
                break
    return sorted(set(titels))


def wikitekst(wiki, titels):
    """Wikitekst plus revisie per titel, in blokken van vijftig."""
    uit = {}
    for begin in range(0, len(titels), 50):
        deel = titels[begin:begin + 50]
        url = (f'https://{wiki}/w/api.php?action=query&prop=revisions&rvprop=content|timestamp|ids'
               f'&titles={urllib.parse.quote("|".join(deel))}&format=json')
        for pagina in haal(url)['query']['pages'].values():
            if 'revisions' not in pagina:
                continue
            revisie = pagina['revisions'][0]
            uit[pagina['title']] = {'tekst': revisie.get('*', ''), 'revid': revisie.get('revid'),
                                    'gewijzigd': revisie.get('timestamp')}
        time.sleep(0.5)
    return uit


def schoon(regel):
    tekst = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r'\1', regel)
    tekst = re.sub(r"\[\[([^\]]*)\]\]", r'\1', tekst)
    tekst = re.sub(r"'''|''", '', tekst)
    tekst = re.sub(r'<[^>]+>', ' ', tekst)
    tekst = re.sub(r'&nbsp;', ' ', tekst)
    tekst = re.sub(r"\{\{[^}]*\}\}", '', tekst)
    return re.sub(r'\s+', ' ', tekst).strip(' |*#:;\t')


def splits_in_delen(tekst):
    ingredienten, stappen, lopende_tekst = [], [], []
    in_ing = in_ber = False
    for regel in tekst.split('\n'):
        kaal = regel.strip()
        kop = re.match(r'^={2,4}\s*(.+?)\s*={2,4}$', kaal)
        vet = re.match(r"^'''(?:\s*)(.{2,40}?)(?:\s*):?'''", kaal)
        titel = kop.group(1) if kop else (vet.group(1) if vet else None)
        if titel:
            if INGREDIENT_KOP.search(titel):
                in_ing, in_ber = True, False
                continue
            if BEREIDING_KOP.search(titel):
                in_ber, in_ing = True, False
                continue
            if in_ing or in_ber:
                in_ing = in_ber = False
        if in_ing and kaal.startswith('*') and len(kaal) > 3:
            waarde = schoon(kaal)
            if waarde and not RUIS.search(waarde):
                ingredienten.append(waarde)
        elif in_ing and kaal.startswith('#') and len(kaal) > 3:
            waarde = schoon(kaal)
            if waarde:
                stappen.append(waarde)
        elif in_ber:
            if re.match(r'^[#*]\s*\S', kaal):
                waarde = schoon(kaal)
                if waarde:
                    stappen.append(waarde)
            else:
                waarde = schoon(kaal)
                if len(waarde) > 40 and not RUIS.search(waarde):
                    lopende_tekst.append(waarde)
    if lopende_tekst and not stappen:
        # Duitse cocktailpagina's zetten de bereiding in gewone zinnen.
        stappen = [z.strip() for z in re.split(r'(?<=[.!?])\s+(?=[A-ZÀ-Ý])', ' '.join(lopende_tekst)) if len(z.strip()) > 15]
    return ingredienten, stappen


def bestaande_titels():
    """Alle titels die al in de app zitten, precies zoals de app ze vergelijkt."""
    alle = set()
    for pad in sorted(BRON.glob('*-recipes.json')):
        if pad.name in {'wikibooks-cocktails-recipes.json', 'wikibooks-borrelhapjes-recipes.json'}:
            continue
        gegevens = json.loads(pad.read_text())
        for rij in gegevens.get('recipes') or []:
            if not isinstance(rij, dict):
                continue
            rd = rij.get('recipe_data') if isinstance(rij.get('recipe_data'), dict) else {}
            for waarde in (rij.get('title'), rij.get('name'), rd.get('title')):
                if waarde:
                    alle.add(norm(str(waarde).split(':')[-1]))
            for waarde in (rij.get('url'), rd.get('url')):
                if waarde:
                    staart = str(waarde).split('/')[-1]
                    alle.add(norm(staart))
                    alle.add(norm(staart.split(':')[-1]))
    return alle


def main():
    ontvanger = argparse.ArgumentParser(description=__doc__)
    ontvanger.add_argument('--taal', help='alleen deze brontaal, bijvoorbeeld de,en')
    keuzes = ontvanger.parse_args()
    talen = set(keuzes.taal.split(',')) if keuzes.taal else None

    gebruikt = bestaande_titels()
    verzameling = {'cocktail': [], 'borrel': []}
    for soort, taal, wiki, bron, is_prefix in BRONNEN:
        if talen and taal not in talen:
            continue
        titels = paginalijst(wiki, bron, is_prefix)
        paginas = wikitekst(wiki, titels)
        nieuw = 0
        for titel, pagina in sorted(paginas.items()):
            ingredienten, stappen = splits_in_delen(pagina['tekst'])
            if len(ingredienten) < 3 or not stappen:
                continue
            sleutel = norm(titel.split('/')[-1])
            if sleutel in gebruikt:
                continue
            gebruikt.add(sleutel)
            verzameling[soort].append({
                'title': titel.split('/')[-1].strip(),
                'url': f"https://{wiki}/wiki/" + titel.replace(' ', '_'),
                'revid': str(pagina['revid']),
                'revisedAt': pagina['gewijzigd'],
                'language': taal,
                'countryCode': None,
                'time': None,
                'servings': None,
                'description': '',
                'ingredients': ingredienten,
                'steps': stappen,
            })
            nieuw += 1
        print(f'{soort:8} {taal:3} {bron:36} {len(titels):5} pagina\'s, {nieuw:4} nieuwe recepten')

    for soort, bestandsnaam, naam, dataset in [
        ('cocktail', 'wikibooks-cocktails-recipes.json', 'Wikibooks Cocktails',
         'https://de.wikibooks.org/wiki/Cocktails · https://en.wikibooks.org/wiki/Bartending'),
        ('borrel', 'wikibooks-borrelhapjes-recipes.json', 'Wikibooks Borrelhapjes',
         'https://nl.wikibooks.org/wiki/Kookboek · https://en.wikibooks.org/wiki/Cookbook'),
    ]:
        recepten = sorted(verzameling[soort], key=lambda r: norm(r['title']))
        document = {
            'source': {'name': naam, 'dataset': dataset, 'revision': 'per-pagina revisies',
                       'fetchedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                       'language': 'meerdere', **LICENTIE},
            'selection': {'count': len(recepten),
                          'criteria': 'Elke pagina uit deze bronnen met minstens drie ingrediënten en een echte '
                                      'bereiding; titels ontdubbeld tegen alle eerdere imports en tegen de eigen recepten.'},
            'soort': soort,
            'recipes': recepten,
        }
        (BRON / bestandsnaam).write_text(json.dumps(document, ensure_ascii=False, indent=1))
        print(f'{bestandsnaam:42} {len(recepten):4} recepten')


if __name__ == '__main__':
    main()
