#!/usr/bin/env python3
"""Verzamelt open gelicentieerde recepten voor VoorraadThuis.

De brontekst blijft letterlijk in recipe-data/ staan; de app zet die bij het
laden om naar het eigen formaat en linkt elk recept terug naar de bron. Alles
wat hier binnenkomt is CC BY-SA 4.0 met naamsvermelding, en elke bron wordt op
een vaste revisie vastgezet zodat hetzelfde bestand opnieuw te maken is.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "recipe-data"
CC_BY_SA_URL = "https://creativecommons.org/licenses/by-sa/4.0/"

UNITOOLS_REVISION = "2f554073f7e730b18d707fe1164d18308f6ec16c"
UNITOOLS_URL = f"https://raw.githubusercontent.com/farcrak/unitools-recipes/{UNITOOLS_REVISION}/unitools-recipes-v1.json"
WIKIBOOKS_REVISION = "49fb73ea07d2a1380c15197db5589934937457ed"
WIKIBOOKS_URL = f"https://huggingface.co/datasets/gossminn/wikibooks-cookbook/resolve/{WIKIBOOKS_REVISION}/recipes_parsed.mini.json?download=true"
WIKIBOOKS_DATASET = "https://huggingface.co/datasets/gossminn/wikibooks-cookbook"
ES_HOST = "es.wikibooks.org"
ES_CATEGORY = "Recetas"
ES_API = f"https://{ES_HOST}/w/api.php"
DE_HOST = "de.wikibooks.org"
DE_PREFIX = "Kochbuch/"
DE_API = f"https://{DE_HOST}/w/api.php"
NL_HOST = "nl.wikibooks.org"
NL_PREFIX = "Kookboek/"
USER_AGENT = {"User-Agent": "VoorraadThuis-open-recipe-import/1.0 (https://github.com/Theberas04/voorraadthuis)"}

# Verwachte aantallen: de import stopt liever dan dat hij stil iets anders doet.
EXPECTED_CURATED = 115
EXPECTED_UNITOOLS = 500
EXPECTED_WIKIBOOKS_EN = 3393
EXPECTED_WIKIBOOKS_ES = 664
EXPECTED_WIKIBOOKS_DE = 407
EXPECTED_WIKIBOOKS_NL = 450


def fetch_json(url: str):
    request = urllib.request.Request(url, headers=USER_AGENT)
    with urllib.request.urlopen(request, timeout=300) as response:
        return json.loads(response.read().decode("utf-8"))


def api(params, post=False, host=ES_HOST):
    data = urllib.parse.urlencode(params).encode("utf-8")
    endpoint = f"https://{host}/w/api.php"
    if post:
        request = urllib.request.Request(endpoint, data=data, headers=USER_AGENT)
    else:
        request = urllib.request.Request(f"{endpoint}?{data.decode()}", headers=USER_AGENT)
    for poging in range(4):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception:
            if poging == 3:
                raise
            time.sleep(3 * (poging + 1))


def normalized(value: str) -> str:
    """Dedupesleutel: zelfde regel als normalizedName() in recipes-open.js.

    Let op: voor niet-Latijnse schriften (Japans, Chinees, Russisch, Arabisch)
    levert de ASCII-stap een lege sleutel op. Zonder terugval zouden al die
    recepten op één sleutel ontdubbeld worden en dus verdwijnen."""
    ascii_value = unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode("ascii")
    sleutel = re.sub(r"[^a-z0-9]", "", ascii_value.casefold())
    return sleutel or re.sub(r"\s+", " ", (value or "")).strip().casefold()


def current_recipe_names() -> list[str]:
    server = (ROOT / "server.js").read_text(encoding="utf-8")
    international = (ROOT / "recipes-international.js").read_text(encoding="utf-8")
    names = re.findall(r"\{id:\d+,name:'([^']+)'", server) + re.findall(r"\['[^']+','([^']+)'", international)
    if len(names) != EXPECTED_CURATED:
        raise RuntimeError(f"Expected the existing {EXPECTED_CURATED} recipes; found {len(names)}")
    return names


# ---------------------------------------------------------------- UniTools

def select_unitools(base_names):
    data = fetch_json(UNITOOLS_URL)
    seen = {normalized(name) for name in base_names}
    selected = []
    for recipe in data["recipes"]:
        key = normalized(recipe["name"]["en"])
        if key in seen:
            continue
        seen.add(key)
        selected.append(recipe)
    if len(selected) != EXPECTED_UNITOOLS:
        raise RuntimeError(f"Expected {EXPECTED_UNITOOLS} unique UniTools imports; got {len(selected)}")
    return data, selected


# ------------------------------------------------------- EN Wikibooks Cookbook

def select_wikibooks_en(base_names, reserved):
    rows = fetch_json(WIKIBOOKS_URL)
    seen = set(reserved)
    selected = []
    for row in rows:
        recipe = row.get("recipe_data") or {}
        title = (recipe.get("title") or "").strip()
        key = normalized(title)
        if not title or key in seen:
            continue
        lines = recipe.get("text_lines") or []
        ingredients = [line for line in lines
                       if (line.get("section") or "").casefold() == "ingredients"
                       and line.get("line_type") == "ul" and (line.get("text") or "").strip()]
        steps = [line for line in lines
                 if (line.get("section") or "").casefold() == "procedure"
                 and line.get("line_type") == "ol" and (line.get("text") or "").strip()]
        if len(ingredients) < 3 or len(steps) < 3:
            continue
        seen.add(key)
        selected.append(row)
    # Vaste volgorde, zodat dezelfde dump altijd dezelfde selectie en ids geeft.
    selected.sort(key=lambda row: hashlib.sha256(normalized((row['recipe_data'].get('title') or '')).encode()).hexdigest())
    if len(selected) != EXPECTED_WIKIBOOKS_EN and "--report" not in sys.argv:
        raise RuntimeError(f"Expected {EXPECTED_WIKIBOOKS_EN} qualifying English Cookbook recipes; got {len(selected)}")
    return {"source": {"name": "Wikibooks Cookbook", "dataset": WIKIBOOKS_DATASET, "revision": WIKIBOOKS_REVISION,
                       "license": "CC BY-SA 4.0", "licenseUrl": CC_BY_SA_URL, "scrapedAt": "2024-07-31",
                       "language": "en"},
             "selection": {"count": len(selected),
                           "criteria": "Every unique English Cookbook page with at least three ingredient lines and three procedure steps; titles deduplicated against the curated recipes and UniTools. Deterministic order by hashed title."},
             "recipes": selected}


# ------------------------------------------------------- ES Wikibooks Kochbuch

ES_COUNTRY_HINTS = {
    "espanola": "ES", "espanol": "ES", "española": "ES", "castellana": "ES", "castellano": "ES", "manchega": "ES",
    "andaluza": "ES", "catalana": "ES", "gallega": "ES", "vasca": "ES", "asturiana": "ES", "aragonesa": "ES",
    "valenciana": "ES", "murciana": "ES", "canaria": "ES", "balear": "ES", "extremeña": "ES", "navarra": "ES",
    "italiana": "IT", "francesa": "FR", "griega": "GR", "alemana": "DE", "portuguesa": "PT", "inglesa": "GB",
    "britanica": "GB", "irlandesa": "IE", "holandesa": "NL", "belga": "BE", "sueca": "SE", "noruega": "NO",
    "danesa": "DK", "polaca": "PL", "rusa": "RU", "ucraniana": "UA", "hungara": "HU", "austriaca": "AT",
    "suiza": "CH", "turca": "TR", "marroqui": "MA", "argelina": "DZ", "egipcia": "EG", "tunecina": "TN",
    "mexicana": "MX", "peruana": "PE", "argentina": "AR", "chilena": "CL", "colombiana": "CO", "venezolana": "VE",
    "brasilena": "BR", "cubana": "CU", "dominicana": "DO", "uruguaya": "UY", "ecuatoriana": "EC", "boliviana": "BO",
    "india": "IN", "china": "CN", "japonesa": "JP", "tailandesa": "TH", "vietnamita": "VN", "coreana": "KR",
    "arabe": "SA", "libanesa": "LB", "israeli": "IL", "estadounidense": "US", "norteamericana": "US", "canadiense": "CA",
}
ES_UNITS = {
    "g": ("g", 1), "gr": ("g", 1), "gramo": ("g", 1), "gramos": ("g", 1), "kg": ("kg", 1), "kilo": ("kg", 1), "kilos": ("kg", 1),
    "mg": ("mg", 1), "ml": ("ml", 1), "cc": ("ml", 1), "cl": ("cl", 1), "dl": ("dl", 1), "l": ("l", 1), "litro": ("l", 1),
    "litros": ("l", 1), "taza": ("taza", 1), "tazas": ("taza", 1), "cucharada": ("cucharada", 1), "cucharadas": ("cucharada", 1),
    "cucharadita": ("cucharadita", 1), "cucharaditas": ("cucharadita", 1), "pizca": ("pizca", 1), "pizcas": ("pizca", 1),
    "diente": ("diente", 1), "dientes": ("diente", 1), "taza_de": ("taza", 1), "vaso": ("vaso", 1), "vasos": ("vaso", 1),
    "docena": ("docena", 1), "docenas": ("docena", 1), "sobre": ("sobre", 1), "sobres": ("sobre", 1), "lata": ("lata", 1),
    "latas": ("lata", 1), "ramita": ("ramita", 1), "ramitas": ("ramita", 1), "loncha": ("loncha", 1), "lonchas": ("loncha", 1),
    "unidad": ("stuks", 1), "unidades": ("stuks", 1), "trozo": ("stuk", 1), "trozos": ("stuk", 1), "manojo": ("bos", 1),
}


def es_plain(value: str) -> str:
    """Haalt sjablonen en wikilinks uit een regel tekst."""
    value = re.sub(r"<ref[^>]*>.*?</ref>", " ", value, flags=re.S)
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"\{\{(?:ing|Ing)\|([^}|]+)(?:\|([^}|]+))?\}\}", lambda m: (m.group(2) or m.group(1)).strip(), value)
    value = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]|]+)\]\]", r"\1", value)
    value = value.replace("'''", "").replace("''", "")
    value = re.sub(r"^[\*\#:]+\s*", "", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip(" .;\u00a0")


def es_template_field(tekst: str, veld: str) -> str:
    """Leest één parameter uit het receptsjabloon, met geneste sjablonen intact."""
    start = tekst.find("{{Artes culinarias/Datos de receta")
    if start < 0:
        start = tekst.find("{{Artes culinarias/Receta")
    if start < 0:
        return ""
    diepte, einde = 0, len(tekst)
    for index in range(start, len(tekst) - 1):
        paar = tekst[index:index + 2]
        if paar == "{{":
            diepte += 1
        elif paar == "}}":
            diepte -= 1
            if diepte == 0:
                einde = index + 2
                break
    binnen = tekst[start + 2:einde - 2]
    delen, diepte, huidig, index = [], 0, "", 0
    while index < len(binnen):
        if binnen[index:index + 2] == "{{":
            diepte += 1
            huidig += "{{"
            index += 2
            continue
        if binnen[index:index + 2] == "}}":
            diepte -= 1
            huidig += "}}"
            index += 2
            continue
        if binnen[index] == "|" and diepte == 0:
            delen.append(huidig)
            huidig = ""
        else:
            huidig += binnen[index]
        index += 1
    delen.append(huidig)
    for deel in delen[1:]:
        if "=" not in deel:
            continue
        naam, _, waarde = deel.partition("=")
        if naam.strip().casefold() == veld.casefold():
            return waarde
    return ""


def es_minuten(waarde: str) -> int | None:
    if not waarde:
        return None
    tekst = waarde.casefold().replace("=", " ")
    totaal = 0.0
    patroon = re.compile(r"(\d+(?:[.,]\d+)?)(?:\s*(?:a|[-–])\s*(\d+(?:[.,]\d+)?))?\s*(horas?|h|minutos?|mins?|min)\b")
    for treffer in patroon.finditer(tekst):
        aantal = float(treffer.group(1).replace(",", "."))
        if treffer.group(2):
            aantal = (aantal + float(treffer.group(2).replace(",", "."))) / 2
        totaal += aantal * (60 if treffer.group(3).startswith("h") else 1)
    if totaal:
        return round(totaal)
    enkel = re.search(r"(\d+(?:[.,]\d+)?)\s*(?:horas?|h)\b", tekst)
    return round(float(enkel.group(1).replace(",", ".")) * 60) if enkel else None


def es_porties(waarde: str) -> int | None:
    treffer = re.search(r"(\d+)(?:\s*(?:a|[-–])\s*(\d+))?", str(waarde or ""))
    if not treffer:
        return None
    aantal = (int(treffer.group(1)) + int(treffer.group(2))) / 2 if treffer.group(2) else int(treffer.group(1))
    return max(1, round(aantal))


def es_land(tekst: str) -> str | None:
    for categorie in re.findall(r"\[\[Categor[íi]a:([^\]|]+)", tekst):
        sleutel = unicodedata.normalize("NFKD", categorie).encode("ascii", "ignore").decode().casefold()
        for hint, code in ES_COUNTRY_HINTS.items():
            if hint in sleutel:
                return code
    return None


def es_record(pagina: dict):
    tekst = pagina["text"]
    titel = pagina["title"].split("/")[-1].strip()
    ingrediënten, stappen = [], []
    veld_ing = es_template_field(tekst, "ingredientes")
    veld_proc = es_template_field(tekst, "procedimiento")
    if veld_ing and veld_proc:
        ingrediënten = [es_plain(regel) for regel in re.split(r"\n", veld_ing) if regel.strip().startswith("*")]
        stappen = [es_plain(regel) for regel in re.split(r"\n", veld_proc) if regel.strip().startswith("#")]
    else:  # oudere pagina's met koppen in plaats van het sjabloon
        sectie = ""
        for regel in tekst.split("\n"):
            kop = re.match(r"^==+\s*([^=]+?)\s*==+", regel)
            if kop:
                sectie = kop.group(1).casefold()
                continue
            if sectie.startswith("ingredientes") and regel.strip().startswith("*"):
                ingrediënten.append(es_plain(regel))
            if sectie.startswith(("preparación", "preparacion", "elaboración", "elaboracion", "procedimiento")) and regel.strip().startswith("#"):
                stappen.append(es_plain(regel))
    ingrediënten = [regel for regel in ingrediënten if len(regel) > 1]
    stappen = [regel for regel in stappen if len(regel) > 1]
    if len(ingrediënten) < 3 or len(stappen) < 3:
        return None
    omschrijving = ""
    for regel in tekst.split("\n"):
        schoon = es_plain(regel)
        if len(schoon) > 60 and not regel.strip().startswith(("|", "*", "#", "{{", "[[Categor")):
            omschrijving = schoon
            break
    return {
        "title": titel,
        "url": f"https://{ES_HOST}/wiki/{urllib.parse.quote(pagina['title'].replace(' ', '_'))}",
        "revid": pagina["revid"],
        "revisedAt": pagina["timestamp"],
        "language": "es",
        "countryCode": es_land(tekst),
        "time": es_minuten(es_template_field(tekst, "tiempo")),
        "servings": es_porties(es_template_field(tekst, "comensales")),
        "description": omschrijving,
        "ingredients": ingrediënten,
        "steps": stappen,
    }


def fetch_es_pages():
    raw = os.environ.get("ES_RAW_FILE")
    if raw and Path(raw).exists():
        return json.loads(Path(raw).read_text(encoding="utf-8"))["pages"]
    leden, vervolg = [], None
    while True:
        params = {"action": "query", "list": "categorymembers", "cmtitle": f"Category:{ES_CATEGORY}",
                  "cmlimit": "500", "cmnamespace": "0", "format": "json", "formatversion": "2"}
        if vervolg:
            params["cmcontinue"] = vervolg
        antwoord = api(params)
        leden += antwoord["query"]["categorymembers"]
        vervolg = antwoord.get("continue", {}).get("cmcontinue")
        if not vervolg:
            break
    titels = [lid["title"] for lid in leden if lid["title"].startswith("Artes culinarias/Recetas/")]
    pagina = {}
    for start in range(0, len(titels), 50):
        params = {"action": "query", "prop": "revisions", "rvprop": "content|ids|timestamp", "rvslots": "main",
                  "titles": "|".join(titels[start:start + 50]), "format": "json", "formatversion": "2"}
        antwoord = api(params, post=True)
        for pagina_json in antwoord.get("query", {}).get("pages", []):
            if "revisions" not in pagina_json:
                continue
            revisie = pagina_json["revisions"][0]
            pagina[pagina_json["title"]] = {"title": pagina_json["title"], "revid": revisie["revid"],
                                            "timestamp": revisie["timestamp"], "text": revisie["slots"]["main"]["content"]}
        time.sleep(0.3)
    return [pagina[titel] for titel in titels if titel in pagina]


def select_wikibooks_es(reserved):
    pagina = fetch_es_pages()
    seen = set(reserved)
    selected = []
    for rij in pagina:
        record = es_record(rij)
        if not record:
            continue
        key = normalized(record["title"])
        if key in seen:
            continue
        seen.add(key)
        selected.append(record)
    selected.sort(key=lambda record: hashlib.sha256(normalized(record["title"]).encode()).hexdigest())
    if len(selected) != EXPECTED_WIKIBOOKS_ES and "--report" not in sys.argv:
        raise RuntimeError(f"Expected {EXPECTED_WIKIBOOKS_ES} qualifying Spanish Cookbook recipes; got {len(selected)}")
    revisies = sorted(record["revid"] for record in selected)
    return {"source": {"name": "Wikibooks Kochbuch (Spaans)", "dataset": f"https://{ES_HOST}/wiki/Categoría:{ES_CATEGORY}",
                       "revision": f"per-pagina revisies {revisies[0]}–{revisies[-1]}",
                       "license": "CC BY-SA 4.0", "licenseUrl": CC_BY_SA_URL,
                       "fetchedAt": max(record["revisedAt"] for record in selected), "language": "es"},
             "selection": {"count": len(selected),
                           "criteria": "Every unique Spanish Cookbook page with at least three ingredient lines and three procedure steps, parsed from the Artes culinarias recipe template; titles deduplicated against the curated recipes, UniTools and the English Cookbook. Deterministic order by hashed title."},
             "recipes": selected}


# ------------------------------------------------------- DE Wikibooks Kochbuch

DE_COUNTRY_HINTS = {
    "deutsch": "DE", "bayerisch": "DE", "schwäbisch": "DE", "fränkisch": "DE", "rheinisch": "DE",
    "österreichisch": "AT", "schweizer": "CH", "italienisch": "IT", "französisch": "FR", "griechisch": "GR",
    "spanisch": "ES", "portugiesisch": "PT", "englisch": "GB", "britisch": "GB", "irisch": "IE",
    "niederländisch": "NL", "belgisch": "BE", "schwedisch": "SE", "norwegisch": "NO", "dänisch": "DK",
    "polnisch": "PL", "russisch": "RU", "ukrainisch": "UA", "ungarisch": "HU", "tschechisch": "CZ",
    "türkisch": "TR", "marokkanisch": "MA", "ägyptisch": "EG", "mexikanisch": "MX", "peruanisch": "PE",
    "argentinisch": "AR", "brasilianisch": "BR", "amerikanisch": "US", "kanadisch": "CA", "indisch": "IN",
    "chinesisch": "CN", "japanisch": "JP", "thailändisch": "TH", "vietnamesisch": "VN", "koreanisch": "KR",
    "arabisch": "SA", "libanesisch": "LB", "israelisch": "IL", "afrikanisch": "ZA", "indonesisch": "ID",
}
DE_ZUTATEN = ("zutaten", "produkte", "zutatenliste", "teig", "füllung", "was wird benötigt", "benötigt", "für den teig")
DE_ZUBEREITUNG = ("zubereitung", "zubereitungsanleitung", "anleitung", "zubereitungsschritte", "arbeitsschritte", "zubereiten", "herstellung")
# Regels die geen bereidingsstap zijn (bronvermelding, waarschuwingen, verwijzingen).
DE_META = ("dieses rezept", "achtung", "hinweis", "tipp", "quelle", "warnung", "siehe auch", "variante", "variation", "anmerkung", "bild:", "für ")


def de_plain(value: str) -> str:
    value = re.sub(r"<ref[^>]*>.*?</ref>", " ", value, flags=re.S)
    value = re.sub(r"<[^>]+>", " ", value)
    for _ in range(3):
        value = re.sub(r"\{\{[^{}]*\}\}", " ", value)
    value = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]|]+)\]\]", r"\1", value)
    value = value.replace("'''", "").replace("''", "")
    value = re.sub(r"^[\*\#:]+\s*", "", value)
    value = re.sub(r"<!--.*?-->", " ", value, flags=re.S)
    value = re.sub(r"\s+", " ", value)
    return value.strip(" .;\u00a0-–")


def sjabloon_params(tekst: str, kandidaten) -> dict:
    """Leest de parameters van het eerste sjabloon dat bij een van de namen hoort."""
    for naam in kandidaten:
        start = tekst.find("{{" + naam)
        if start < 0:
            continue
        diepte, einde = 0, len(tekst)
        index = start
        while index < len(tekst) - 1:
            paar = tekst[index:index + 2]
            if paar == "{{":
                diepte += 1
                index += 2
                continue
            if paar == "}}":
                diepte -= 1
                index += 2
                if diepte == 0:
                    einde = index
                    break
                continue
            index += 1
        binnen = tekst[start + 2:einde - 2]
        waarden, diepte, huidig, index = {}, 0, "", 0
        delen = []
        while index < len(binnen):
            if binnen[index:index + 2] == "{{":
                diepte += 1
                huidig += "{{"
                index += 2
                continue
            if binnen[index:index + 2] == "}}":
                diepte -= 1
                huidig += "}}"
                index += 2
                continue
            if binnen[index] == "|" and diepte == 0:
                delen.append(huidig)
                huidig = ""
            else:
                huidig += binnen[index]
            index += 1
        delen.append(huidig)
        for deel in delen[1:]:
            naam_van_veld, _, waarde = deel.partition("=")
            waarden[naam_van_veld.strip().casefold()] = waarde.strip()
        return waarden
    return {}


def duur_minuten(waarde: str, eenheden) -> int | None:
    if not waarde:
        return None
    tekst = waarde.casefold().replace("=", " ")
    totaal = 0.0
    patroon = re.compile(r"(\d+(?:[.,]\d+)?)(?:\s*(?:bis|a|[-–])\s*(\d+(?:[.,]\d+)?))?\s*(" + "|".join(eenheden) + r")\b")
    for treffer in patroon.finditer(tekst):
        aantal = float(treffer.group(1).replace(",", "."))
        if treffer.group(2):
            aantal = (aantal + float(treffer.group(2).replace(",", "."))) / 2
        eenheid = treffer.group(3)
        totaal += aantal * (60 if eenheid.startswith(("h", "std", "stunde")) else 1)
    return round(totaal) if totaal else None


def de_land(tekst: str) -> str | None:
    for categorie in re.findall(r"\[\[Kategorie:([^\]|]+)", tekst) + re.findall(r"\|\s*Kategorie\s*=\s*([^\n|]+)", tekst):
        sleutel = unicodedata.normalize("NFKD", categorie).encode("ascii", "ignore").decode().casefold()
        for hint, code in DE_COUNTRY_HINTS.items():
            hint_ascii = unicodedata.normalize("NFKD", hint).encode("ascii", "ignore").decode().casefold()
            if hint_ascii and hint_ascii in sleutel:
                return code
    return None


def de_zinnen(tekst: str) -> list[str]:
    """Sommige Duitse recepten zetten de bereiding in doorlopende tekst; elk zin is een stap."""
    return [zin.strip() for zin in re.split(r"(?<=[.!?])\s+", tekst) if len(zin.strip()) > 25]


def de_record(pagina: dict):
    tekst = pagina["text"]
    titel = pagina["title"][len(DE_PREFIX):].strip()
    params = sjabloon_params(tekst, ["Kochbuch/_Vorlage/_RezeptBox", "Kochbuch/_Vorlage/RezeptBox"])
    ingrediënten, stappen = [], []
    koppen = [naam.strip().casefold() for _, naam in re.findall(r"^(=+)\s*([^=]+?)\s*\1\s*$", tekst, re.M)]
    heeft_zubereiding = any(any(naam.startswith(w) for w in DE_ZUBEREITUNG) for naam in koppen)
    sectie = ""
    for regel in tekst.split("\n"):
        kop = re.match(r"^(=+)\s*([^=]+?)\s*\1\s*$", regel)
        if kop:
            sectie = kop.group(2).strip().casefold()
            continue
        kaal = regel.strip()
        if not kaal or kaal.startswith(("|", "{", "[", "!", "__")):
            continue
        schoon = de_plain(regel)
        if len(schoon) < 15 or schoon.casefold().startswith(DE_META):
            continue
        if kaal.startswith("*"):
            if any(sectie.startswith(w) for w in DE_ZUTATEN):
                ingrediënten.append(schoon)
            continue
        if kaal.startswith("#"):
            if any(sectie.startswith(w) for w in DE_ZUBEREITUNG) or heeft_zubereiding:
                stappen.extend(de_zinnen(schoon) or [schoon])
            continue
        # Losse tekst: een bereidingsstap als hij onder de bereiding staat, of als het
        # recept helemaal geen bereidingskop heeft en de ingrediënten al geweest zijn.
        if (any(sectie.startswith(w) for w in DE_ZUBEREITUNG)
                or (heeft_zubereiding and not any(sectie.startswith(w) for w in DE_ZUTATEN))
                or (not heeft_zubereiding and ingrediënten)):
            stappen.extend(de_zinnen(schoon) or [schoon])
    ingrediënten = [regel for regel in ingrediënten if len(regel) > 1]
    stappen = [regel for regel in stappen if len(regel) > 1]
    # Duitse recepten beschrijven de bereiding vaak in doorlopende tekst; elke zin telt als
    # stap, dus twee stappen is daar een volledig uitgewerkt recept.
    if len(ingrediënten) < 3 or len(stappen) < 2:
        return None
    omschrijving = ""
    for regel in tekst.split("\n"):
        schoon = de_plain(regel)
        if len(schoon) > 60 and not regel.strip().startswith(("|", "*", "#", "{{", "[[Kategorie", "=")):
            omschrijving = schoon
            break
    return {
        "title": titel,
        "url": f"https://{DE_HOST}/wiki/{urllib.parse.quote(pagina['title'].replace(' ', '_'))}",
        "revid": pagina["revid"],
        "revisedAt": pagina["timestamp"],
        "language": "de",
        "countryCode": de_land(tekst),
        "time": duur_minuten(params.get("zubereitungszeit", ""), ("stunden", "std", "stunde", "h", "minuten", "min")),
        "servings": es_porties(params.get("portionen", "")),
        "description": omschrijving,
        "ingredients": ingrediënten,
        "steps": stappen,
    }


def fetch_de_pages():
    raw = os.environ.get("DE_RAW_FILE")
    if raw and Path(raw).exists():
        return json.loads(Path(raw).read_text(encoding="utf-8"))["pages"]
    titels, vervolg = [], None
    while True:
        params = {"action": "query", "list": "allpages", "apprefix": DE_PREFIX, "aplimit": "500",
                  "apnamespace": "0", "format": "json", "formatversion": "2"}
        if vervolg:
            params["apcontinue"] = vervolg
        antwoord = api(params, host=DE_HOST)
        titels += [pagina["title"] for pagina in antwoord["query"]["allpages"]]
        vervolg = antwoord.get("continue", {}).get("apcontinue")
        if not vervolg:
            break
        time.sleep(0.5)
    pagina = {}
    for start in range(0, len(titels), 50):
        params = {"action": "query", "prop": "revisions", "rvprop": "content|ids|timestamp", "rvslots": "main",
                  "titles": "|".join(titels[start:start + 50]), "format": "json", "formatversion": "2"}
        antwoord = api(params, post=True, host=DE_HOST)
        for pagina_json in antwoord.get("query", {}).get("pages", []):
            if "revisions" not in pagina_json:
                continue
            revisie = pagina_json["revisions"][0]
            pagina[pagina_json["title"]] = {"title": pagina_json["title"], "revid": revisie["revid"],
                                            "timestamp": revisie["timestamp"], "text": revisie["slots"]["main"]["content"]}
        time.sleep(0.3)
    return [pagina[titel] for titel in titels if titel in pagina]


def select_wikibooks_de(reserved):
    pagina = fetch_de_pages()
    seen = set(reserved)
    selected = []
    for rij in pagina:
        record = de_record(rij)
        if not record:
            continue
        key = normalized(record["title"])
        if key in seen:
            continue
        seen.add(key)
        selected.append(record)
    selected.sort(key=lambda record: hashlib.sha256(normalized(record["title"]).encode()).hexdigest())
    if len(selected) != EXPECTED_WIKIBOOKS_DE and "--report" not in sys.argv:
        raise RuntimeError(f"Expected {EXPECTED_WIKIBOOKS_DE} qualifying German Cookbook recipes; got {len(selected)}")
    revisies = sorted(record["revid"] for record in selected)
    return {"source": {"name": "Wikibooks Kochbuch (Duits)", "dataset": f"https://{DE_HOST}/wiki/Kochbuch",
                       "revision": f"per-pagina revisies {revisies[0]}–{revisies[-1]}",
                       "license": "CC BY-SA 4.0", "licenseUrl": CC_BY_SA_URL,
                       "fetchedAt": max(record["revisedAt"] for record in selected), "language": "de"},
             "selection": {"count": len(selected),
                           "criteria": "Every unique German Cookbook page with a Zutaten section of at least three lines and a Zubereitung section of at least three steps; titles deduplicated against the curated recipes, UniTools, the English and the Spanish Cookbook. Deterministic order by hashed title."},
             "recipes": selected}


# ------------------------------------------------------- NL Wikibooks Kookboek

NL_ZUTATEN = ("ingredi", "benodigd")
NL_BEREIDING = ("bereiding", "bereiden", "werkwijze")
NL_COUNTRY_HINTS = {
    "nederland": "NL", "hollands": "NL", "italiaan": "IT", "frans": "FR", "duits": "DE",
    "spaans": "ES", "grieks": "GR", "turks": "TR", "indiaas": "IN", "indonesisch": "ID",
    "chinees": "CN", "japans": "JP", "thais": "TH", "mexicaan": "MX", "marokkaan": "MA",
    "belgisch": "BE", "pools": "PL", "hongaars": "HU", "russisch": "RU", "zweeds": "SE",
    "deens": "DK", "noors": "NO", "fins": "FI", "iers": "IE", "portugees": "PT",
    "amerikaan": "US", "vietnamees": "VN", "korea": "KR", "libanees": "LB",
}


def nl_sjablonen(tekst: str) -> str:
    """{{Kb|p=aardappel|aardappels}} wordt 'aardappels', {{Wp|...}} wordt de zichtbare tekst."""
    vorige = None
    while vorige != tekst:
        vorige = tekst

        def vervang(treffer):
            delen = [deel.strip() for deel in treffer.group(1).split("|")]
            if delen and "=" in delen[0]:
                delen = delen[1:]
            return delen[-1] if delen else ""

        tekst = re.sub(r"\{\{([^{}]*)\}\}", vervang, tekst)
    return tekst


def nl_plain(waarde: str) -> str:
    tekst = nl_sjablonen(waarde or "")
    tekst = re.sub(r"<!--.*?-->", " ", tekst, flags=re.S)
    tekst = re.sub(r"<ref[^>]*>.*?</ref>", " ", tekst, flags=re.S)
    tekst = re.sub(r"\[\[(?:Bestand|Afbeelding|File|Image):[^\]]*\]\]", " ", tekst)
    tekst = re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", r"\2", tekst)
    tekst = re.sub(r"\[\[([^\]]+)\]\]", r"\1", tekst)
    tekst = re.sub(r"\[https?://\S+\s+([^\]]+)\]", r"\1", tekst)
    tekst = re.sub(r"\[https?://\S+\]", " ", tekst)
    tekst = tekst.replace("'''", "").replace("''", "")
    tekst = re.sub(r"<[^>]+>", " ", tekst)
    tekst = tekst.replace("&nbsp;", " ")
    tekst = re.sub(r"\s+", " ", tekst)
    return tekst.strip(" ,;:.")


def nl_secties(tekst: str) -> dict:
    """Regels per kop; een kop van niveau 2 bevat ook de inhoud van zijn subsecties."""
    uit, niveau2, huidig = {}, None, None
    for regel in tekst.split("\n"):
        kop = re.match(r"^\s*(={2,6})\s*(.+?)\s*\1\s*$", regel)
        if kop:
            diepte = len(kop.group(1))
            naam = nl_plain(kop.group(2)).casefold()
            if diepte == 2:
                niveau2, huidig = naam, None
                uit.setdefault(niveau2, [])
            else:
                huidig = naam
                uit.setdefault(huidig, [])
            continue
        if regel.strip():
            if niveau2:
                uit[niveau2].append(regel.strip())
            if huidig and huidig != niveau2:
                uit[huidig].append(regel.strip())
    return uit


def nl_minuten(waarde: str) -> int | None:
    if not waarde:
        return None
    tekst = nl_plain(waarde).casefold()
    totaal = 0.0
    for aantal, eenheid in re.findall(r"(\d+(?:[.,]\d+)?)\s*(uur|uren|kwartier|minuten|minuut|min|seconden)\b", tekst):
        getal = float(aantal.replace(",", "."))
        if eenheid in ("uur", "uren"):
            getal *= 60
        elif eenheid == "kwartier":
            getal *= 15
        elif eenheid == "seconden":
            getal /= 60
        totaal += getal
    if not totaal:
        # "20 voorbereiden, 50 wachten, 15 bereiden" — losse getallen bij een werkwoord
        for aantal in re.findall(r"(\d+(?:[.,]\d+)?)\s*(?:voorbereiden|wachten|bereiden|koken|bakken|rusten|koelen|opwarmen)", tekst):
            totaal += float(aantal.replace(",", "."))
    return round(totaal) if totaal else None


def nl_land(tekst: str) -> str | None:
    kandidaten = re.findall(r"\[\[Categorie:([^\]|]+)", tekst) + re.findall(r"\|\s*Categorie\s*=\s*([^\n|]+)", tekst)
    for categorie in kandidaten:
        sleutel = unicodedata.normalize("NFKD", categorie).encode("ascii", "ignore").decode().casefold()
        for hint, code in NL_COUNTRY_HINTS.items():
            if hint in sleutel:
                return code
    return None


def nl_record(pagina: dict):
    tekst = pagina["text"]
    titel = pagina["title"][len(NL_PREFIX):].strip()
    params = sjabloon_params(tekst, ["Infobox recept", "Infobox"])
    delen = nl_secties(tekst)
    ingredienten, gezien = [], set()
    for kop, regels in delen.items():
        if kop.startswith(NL_ZUTATEN):
            for regel in regels:
                if not regel.startswith("*"):
                    continue
                schoon = nl_plain(regel.lstrip("*#").strip())
                if len(schoon) > 1 and schoon.casefold() not in gezien:
                    gezien.add(schoon.casefold())
                    ingredienten.append(schoon)
    stappen, geziene_stappen = [], set()
    for kop, regels in delen.items():
        if kop.startswith(NL_BEREIDING):
            for regel in regels:
                if not regel.startswith(("#", "*")):
                    continue
                schoon = nl_plain(regel.lstrip("*#").strip())
                if len(schoon) > 3 and schoon.casefold() not in geziene_stappen:
                    geziene_stappen.add(schoon.casefold())
                    stappen.append(schoon)
    if len(ingredienten) < 3 or len(stappen) < 2:
        return None
    omschrijving = ""
    for regel in tekst.split("\n"):
        schoon = nl_plain(regel)
        if len(schoon) > 60 and not regel.strip().startswith(("|", "*", "#", "{{", "[[", "=")):
            omschrijving = schoon
            break
    naam = nl_plain(params.get("naam", "")) or titel
    if naam.casefold().startswith("kookboek/"):
        naam = naam.split("/", 1)[1]
    record = {
        "title": titel,
        "url": f"https://{NL_HOST}/wiki/{urllib.parse.quote(pagina['title'].replace(' ', '_'))}",
        "revid": pagina["revid"],
        "revisedAt": pagina["timestamp"],
        "language": "nl",
        "countryCode": nl_land(tekst),
        "time": nl_minuten(params.get("tijd", "")),
        "servings": es_porties(params.get("porties", "")),
        "description": omschrijving,
        "ingredients": ingredienten,
        "steps": stappen,
    }
    if naam and naam != titel:
        record["name"] = naam
    return record


def fetch_nl_pages():
    raw = os.environ.get("NL_RAW_FILE")
    if raw and Path(raw).exists():
        return json.loads(Path(raw).read_text(encoding="utf-8"))["pages"]
    titels, vervolg = [], None
    while True:
        params = {"action": "query", "list": "allpages", "apprefix": NL_PREFIX, "aplimit": "500",
                  "apnamespace": "0", "format": "json", "formatversion": "2"}
        if vervolg:
            params["apcontinue"] = vervolg
        antwoord = api(params, host=NL_HOST)
        titels += [pagina["title"] for pagina in antwoord["query"]["allpages"]]
        vervolg = antwoord.get("continue", {}).get("apcontinue")
        if not vervolg:
            break
        time.sleep(0.5)
    pagina = {}
    for start in range(0, len(titels), 40):
        params = {"action": "query", "prop": "revisions", "rvprop": "content|ids|timestamp", "rvslots": "main",
                  "titles": "|".join(titels[start:start + 40]), "format": "json", "formatversion": "2"}
        antwoord = api(params, post=True, host=NL_HOST)
        for pagina_json in antwoord.get("query", {}).get("pages", []):
            if "revisions" not in pagina_json:
                continue
            revisie = pagina_json["revisions"][0]
            pagina[pagina_json["title"]] = {"title": pagina_json["title"], "revid": revisie["revid"],
                                           "timestamp": revisie["timestamp"], "text": revisie["slots"]["main"]["content"]}
        time.sleep(0.3)
    return [pagina[titel] for titel in titels if titel in pagina]


def select_wikibooks_nl(reserved):
    pagina = fetch_nl_pages()
    seen = set(reserved)
    selected = []
    for rij in pagina:
        record = nl_record(rij)
        if not record:
            continue
        # De app ontdubbelt op de weergegeven naam; doe dat hier hetzelfde, anders
        # kan de selectie en de app uit elkaar lopen.
        key = normalized(record.get("name") or record["title"])
        if key in seen:
            continue
        seen.add(key)
        selected.append(record)
    selected.sort(key=lambda record: hashlib.sha256(normalized(record["title"]).encode()).hexdigest())
    if len(selected) != EXPECTED_WIKIBOOKS_NL and "--report" not in sys.argv:
        raise RuntimeError(f"Expected {EXPECTED_WIKIBOOKS_NL} qualifying Dutch Cookbook recipes; got {len(selected)}")
    revisies = sorted(record["revid"] for record in selected)
    return {"source": {"name": "Wikibooks Kookboek (Nederlands)", "dataset": f"https://{NL_HOST}/wiki/Kookboek",
                       "revision": f"per-pagina revisies {revisies[0]}\u2013{revisies[-1]}",
                       "license": "CC BY-SA 4.0", "licenseUrl": CC_BY_SA_URL,
                       "fetchedAt": max(record["revisedAt"] for record in selected), "language": "nl"},
             "selection": {"count": len(selected),
                           "criteria": "Every unique Dutch Kookboek page with at least three ingredient lines and two preparation steps (subsections count with their parent section); titles deduplicated against the curated recipes and the other imports. Deterministic order by hashed title."},
             "recipes": selected}


# ------------------------------------------------- generieke Wikibooks-talen

# Talen met dezelfde opbouw: een kop met ingrediënten (bullets) en een kop met
# bereiding (genummerd of bullets). Elke pagina wordt op een vaste revisie
# vastgezet, net als de Engelse, Spaanse, Duitse en Nederlandse import.
GENERIEKE_BRONNEN = {
    "fr": {"host": "fr.wikibooks.org", "prefix": "Livre de cuisine/",
           "zutaten": ("ingrédient", "ingredient"), "stappen": ("préparation", "preparation"),
           "expected": 986, "land": {
               "français": "FR", "italien": "IT", "espagnol": "ES", "allemand": "DE", "grec": "GR",
               "portugais": "PT", "belge": "BE", "marocain": "MA", "tunisien": "TN", "algérien": "DZ",
               "indien": "IN", "chinois": "CN", "japonais": "JP", "thaï": "TH", "mexicain": "MX",
               "américain": "US", "anglais": "GB", "russe": "RU", "turc": "TR", "libanais": "LB",
               "vietnamien": "VN", "algérienne": "DZ", "tahitien": "PF", "réunionnais": "RE",
               "antillais": "GP", "africain": "SN", "oriental": "LB", "suisse": "CH", "autrichien": "AT"}},
    "it": {"host": "it.wikibooks.org", "prefix": "Libro di cucina/",
           "zutaten": ("ingredienti", "ingrediente"), "stappen": ("preparazione", "procedimento", "cottura"),
           "expected": 583, "land": {
               "italiana": "IT", "francese": "FR", "spagnola": "ES", "tedesca": "DE", "greca": "GR",
               "portoghese": "PT", "marocchina": "MA", "indiana": "IN", "cinese": "CN", "giapponese": "JP",
               "thailandese": "TH", "messicana": "MX", "americana": "US", "inglese": "GB", "russa": "RU",
               "turca": "TR", "libanese": "LB", "vietnamita": "VN", "svizzera": "CH", "austriaca": "AT"}},
    "ca": {"host": "ca.wikibooks.org", "prefix": "Llibre de cuina/",
           "zutaten": ("ingredients", "ingredient"), "stappen": ("preparació", "preparacio", "elaboració", "elaboracio"),
           "expected": 673, "land": {
               "catalana": "ES", "francesa": "FR", "italiana": "IT", "espanyola": "ES", "alemanya": "DE",
               "grega": "GR", "portuguesa": "PT", "marroquina": "MA", "índia": "IN", "xinesa": "CN",
               "japonesa": "JP", "tailandesa": "TH", "mexicana": "MX", "americana": "US", "anglesa": "GB",
               "russa": "RU", "turca": "TR", "libanesa": "LB", "vietnamita": "VN"}},
}


# Extra Wikibooks-kookboeken in andere talen. Zelfde opbouw als de Franse,
# Italiaanse en Catalaanse import: ingrediënten als bullets onder een kop,
# bereiding als genummerde lijst of doorlopende tekst. Per taal worden de
# bronpagina's op hun vaste revisie vastgezet.
EXTRA_BRONNEN = {
    "pt": {"host": "pt.wikibooks.org", "prefix": "Livro de receitas/", "expected": 237,
           "zutaten": ("ingrediente",), "stappen": ("preparo", "preparação", "modo de preparo"), "land": {"portuguesa": "PT", "brasileira": "BR", "italiana": "IT", "francesa": "FR"}},
    "ja": {"host": "ja.wikibooks.org", "prefix": "料理本/", "expected": 276,
           "zutaten": ("材料", "ざいりょう"), "stappen": ("作り方", "つくりかた", "調理法", "作りかた"), "land": {"日本": "JP", "中華": "CN", "イタリア": "IT", "フランス": "FR", "韓国": "KR", "タイ": "TH", "インド": "IN"}},
    "ru": {"host": "ru.wikibooks.org", "prefix": "Кулинарная книга/", "expected": 0,
           "zutaten": ("ингредиент", "состав", "продукты"), "stappen": ("приготовление", "способ приготовления", "рецепт"), "land": {"русск": "RU", "украин": "UA", "итальян": "IT", "француз": "FR", "немец": "DE", "грузин": "GE", "узбек": "UZ"}},
    "pl": {"host": "pl.wikibooks.org", "prefix": "Książka kucharska/", "expected": 863,
           "zutaten": ("składniki", "skladniki"), "stappen": ("przygotowanie", "wykonanie", "sposób przygotowania"), "land": {"polsk": "PL", "włoska": "IT", "francuska": "FR", "niemiecka": "DE", "chińska": "CN"}},
    "sv": {"host": "sv.wikibooks.org", "prefix": "Kokboken/", "expected": 313,
           "zutaten": ("ingredienser", "ingrediens"), "stappen": ("tillagning", "gör så här", "beredning", "tillvägagångssätt"), "land": {"svensk": "SE", "italiensk": "IT", "fransk": "FR", "tysk": "DE", "thailändsk": "TH", "indisk": "IN"}},
    "nb": {"host": "nb.wikibooks.org", "prefix": "Kokebok/", "expected": 79,
           "zutaten": ("ingredienser",), "stappen": ("fremgangsmåte", "tilberedning"), "land": {"norsk": "NO", "italiensk": "IT"}},
    "da": {"host": "da.wikibooks.org", "prefix": "Wikimedia Kogebogen/", "expected": 0,
           "zutaten": ("ingredienser",), "stappen": ("fremgangsmåde", "tilberedning"), "land": {"dansk": "DK", "italiensk": "IT"}},
    "fi": {"host": "fi.wikibooks.org", "prefix": "Keittokirja/", "expected": 11,
           "zutaten": ("ainekset", "ainesosat"), "stappen": ("valmistus", "valmistusohje"), "land": {"suomalai": "FI", "italialai": "IT"}},
    "zh": {"host": "zh.wikibooks.org", "prefix": "食谱/", "expected": 0,
           "zutaten": ("材料", "原料", "配料", "食材"), "stappen": ("做法", "制作", "步驟", "步骤", "作法"), "land": {"中國": "CN", "中国": "CN", "日本": "JP", "義大利": "IT", "意大利": "IT", "法國": "FR", "法国": "FR", "韓國": "KR", "韩国": "KR", "泰國": "TH", "泰国": "TH", "印度": "IN"}},
    "hu": {"host": "hu.wikibooks.org", "prefix": "Szakácskönyv/", "expected": 0,
           "zutaten": ("hozzávalók",), "stappen": ("elkészítés", "elkészítése", "előkészítés"), "land": {"magyar": "HU", "olasz": "IT"}},
    "sh": {"host": "sr.wikibooks.org", "prefix": "Кувар/", "expected": 0,
           "zutaten": ("састојци", "sastojci"), "stappen": ("припрема", "priprema", "поступак"), "land": {"српск": "RS", "италијан": "IT"}},
    "he": {"host": "he.wikibooks.org", "prefix": "ספר מתכונים/", "expected": 0,
           "zutaten": ("מצרכים", "רכיבים"), "stappen": ("הכנה", "אופן ההכנה", "אופן הכנה", "הוראות"), "land": {"ישראל": "IL", "איטלקי": "IT"}},
    "ko": {"host": "ko.wikibooks.org", "prefix": "위키책:요리/", "expected": 0,
           "zutaten": ("재료", "준비물"), "stappen": ("조리법", "만드는 법", "조리", "만들기"), "land": {"한국": "KR", "중국": "CN", "일본": "JP", "이탈리아": "IT", "태국": "TH"}},
    "vi": {"host": "vi.wikibooks.org", "prefix": "Chủ đề:Ẩm thực/", "expected": 0,
           "zutaten": ("nguyên liệu",), "stappen": ("cách làm", "thực hiện", "chế biến", "cách nấu"), "land": {"việt": "VN", "trung": "CN", "thái": "TH", "ý": "IT", "pháp": "FR"}},
    "th": {"host": "th.wikibooks.org", "prefix": "ตำราอาหาร/", "expected": 0,
           "zutaten": ("วัตถุดิบ", "ส่วนผสม"), "stappen": ("วิธีทำ", "วิธีปรุง", "ขั้นตอน"), "land": {"ไทย": "TH", "จีน": "CN", "ญี่ปุ่น": "JP"}},
    "ro": {"host": "ro.wikibooks.org", "prefix": "Carte de bucate/", "expected": 0,
           "zutaten": ("ingrediente",), "stappen": ("mod de preparare", "preparare", "prepararea"), "land": {"române": "RO", "italian": "IT"}},
    "bn": {"host": "bn.wikibooks.org", "prefix": "রন্ধনপ্রণালী/", "expected": 0,
           "zutaten": ("উপকরণ", "উপাদান"), "stappen": ("প্রণালী", "প্রস্তুত প্রণালী", "তৈরি", "পদ্ধতি"), "land": {"বাংলা": "BD", "ভারত": "IN"}},
    "id": {"host": "id.wikibooks.org", "prefix": "Resep/", "expected": 0,
           "zutaten": ("bahan",), "stappen": ("cara membuat", "cara memasak", "langkah", "cara pengolahan"), "land": {"indonesia": "ID", "italia": "IT"}},
    "tr": {"host": "tr.wikibooks.org", "prefix": "Yemek/", "expected": 0,
           "zutaten": ("malzemeler", "malzeme"), "stappen": ("yapılışı", "hazırlanışı", "yapımı"), "land": {"türk": "TR", "italyan": "IT"}},
    "el": {"host": "el.wikibooks.org", "prefix": "Βιβλίο μαγειρικής/", "expected": 0,
           "zutaten": ("υλικά",), "stappen": ("εκτέλεση", "παρασκευή", "οδηγίες"), "land": {"ελληνικ": "GR", "ιταλικ": "IT"}},
    "fa": {"host": "fa.wikibooks.org", "prefix": "کتاب آشپزی/", "expected": 0,
           "zutaten": ("مواد لازم", "مواد اولیه", "مواد"), "stappen": ("طرز تهیه", "دستور پخت", "روش تهیه"), "land": {"ایران": "IR", "ایتالیا": "IT"}},
    "cs": {"host": "cs.wikibooks.org", "prefix": "Wikikuchařka/", "expected": 0,
           "zutaten": ("suroviny", "ingredience"), "stappen": ("postup", "příprava"), "land": {"česk": "CZ", "italsk": "IT"}},
    "sk": {"host": "sk.wikibooks.org", "prefix": "Wikikuchárka/", "expected": 0,
           "zutaten": ("suroviny",), "stappen": ("postup", "príprava"), "land": {"slovensk": "SK", "taliansk": "IT"}},
    "hr": {"host": "hr.wikibooks.org", "prefix": "WikiKuharica/", "expected": 0,
           "zutaten": ("sastojci",), "stappen": ("postupak", "priprema"), "land": {"hrvatsk": "HR", "talijansk": "IT"}},
    "sr": {"host": "sr.wikibooks.org", "prefix": "Кувар/Рецепти/", "expected": 0,
           "zutaten": ("састојци", "sastojci"), "stappen": ("припрема", "priprema", "поступак"), "land": {"српск": "RS"}},
    "uk": {"host": "uk.wikibooks.org", "prefix": "Кулінарна книга/", "expected": 0,
           "zutaten": ("інгредієнт", "склад"), "stappen": ("приготування", "спосіб приготування"), "land": {"україн": "UA", "італ": "IT"}},
    "bg": {"host": "bg.wikibooks.org", "prefix": "Готварска книга/", "expected": 0,
           "zutaten": ("съставки", "продукти", "необходими продукти"), "stappen": ("приготвяне", "начин на приготвяне"), "land": {"българ": "BG", "италиан": "IT"}},
    "mk": {"host": "mk.wikibooks.org", "prefix": "Готвач/", "expected": 0,
           "zutaten": ("состојки",), "stappen": ("припрема", "постапка"), "land": {"македон": "MK", "италијан": "IT"}},
    "sq": {"host": "sq.wikibooks.org", "prefix": "Wiki kuzhina/", "expected": 0,
           "zutaten": ("përbërësit", "përbërës"), "stappen": ("përgatitja", "përgatitje"), "land": {"shqiptar": "AL", "italian": "IT"}},
    "lt": {"host": "lt.wikibooks.org", "prefix": "Receptai/", "expected": 0,
           "zutaten": ("sudedamosios", "ingredientai"), "stappen": ("gaminimas", "paruošimas"), "land": {"lietuv": "LT", "ital": "IT"}},
    "is": {"host": "is.wikibooks.org", "prefix": "Matreiðslubók/", "expected": 0,
           "zutaten": ("hráefni",), "stappen": ("aðferð", "framkvæmd", "undirbúningur"), "land": {"íslensk": "IS", "ítölsk": "IT"}},
    "ms": {"host": "ms.wikibooks.org", "prefix": "Resipi/", "expected": 0,
           "zutaten": ("bahan",), "stappen": ("cara membuat", "langkah", "cara memasak"), "land": {"malaysia": "MY", "itali": "IT"}},
    "tl": {"host": "tl.wikibooks.org", "prefix": "Pagluluto/", "expected": 0,
           "zutaten": ("sangkap", "mga sangkap"), "stappen": ("pamamaraan", "paraan", "hakbang"), "land": {"pilipinas": "PH"}},
    "hi": {"host": "hi.wikibooks.org", "prefix": "रसोई/", "expected": 0,
           "zutaten": ("सामग्री", "आवश्यक सामग्री"), "stappen": ("विधि", "बनाने की विधि", "विधी"), "land": {"भारत": "IN"}},
    "ml": {"host": "ml.wikibooks.org", "prefix": "പാചകപുസ്തകം/", "expected": 0,
           "zutaten": ("ചേരുവകൾ",), "stappen": ("തയ്യാറാക്കുന്ന വിധം", "പാചകം", "വിധം"), "land": {"ഇന്ത്യ": "IN"}},
    "ta": {"host": "ta.wikibooks.org", "prefix": "சமையல் நூல்/", "expected": 0,
           "zutaten": ("தேவையானவை", "பொருட்கள்"), "stappen": ("செய்முறை", "செய்யும் முறை"), "land": {"இந்தியா": "IN"}},
    "eo": {"host": "eo.wikibooks.org", "prefix": "Kuirlibro/", "expected": 0,
           "zutaten": ("ingrediencoj", "ingredienco"), "stappen": ("preparado", "preparo", "kuirmaniero"), "land": {"ital": "IT", "franc": "FR"}},
    "eu": {"host": "eu.wikibooks.org", "prefix": "Sukaldaritza liburua/", "expected": 0,
           "zutaten": ("osagaiak", "osagai"), "stappen": ("prestaketa", "errezeta", "egiteko"), "land": {"euskal": "ES", "italiar": "IT"}},
    "az": {"host": "az.wikibooks.org", "prefix": "Kulinariya kitabı/", "expected": 0,
           "zutaten": ("tərkibi", "ərzaqlar", "tərkib"), "stappen": ("hazırlanması", "hazırlanma qaydası"), "land": {"azərbaycan": "AZ", "italyan": "IT"}},
    "ar": {"host": "ar.wikibooks.org", "prefix": "كتاب الطبخ/", "expected": 0,
           "zutaten": ("مقادير", "المقادير", "مكونات"), "stappen": ("طريقة التحضير", "التحضير", "طريقة العمل"), "land": {"مصر": "EG", "مغرب": "MA", "لبنان": "LB", "تونس": "TN"}},
}



# Weergavenaam per kookboek in de app (bronvermelding per recept).
NAAM_PER_TAAL = {
    "fr": "Wikibooks Livre de cuisine (Frans)", "it": "Wikibooks Libro di cucina (Italiaans)",
    "ca": "Wikibooks Llibre de cuina (Catalaans)", "pt": "Wikibooks Livro de receitas (Portugees)",
    "ja": "Wikibooks 料理本 (Japans)", "ru": "Wikibooks Кулинарная книга (Russisch)",
    "pl": "Wikibooks Książka kucharska (Pools)", "sv": "Wikibooks Kokboken (Zweeds)",
    "nb": "Wikibooks Kokebok (Noors)", "da": "Wikibooks Kogebogen (Deens)", "fi": "Wikibooks Keittokirja (Fins)",
    "zh": "Wikibooks 食谱 (Chinees)", "hu": "Wikibooks Szakácskönyv (Hongaars)", "sh": "Wikibooks Кувар (Servisch)",
    "sr": "Wikibooks Кувар (Servisch)", "he": "Wikibooks ספר מתכונים (Hebreeuws)", "ko": "Wikibooks 요리 (Koreaans)",
    "vi": "Wikibooks Ẩm thực (Vietnamees)", "th": "Wikibooks ตำราอาหาร (Thais)", "ro": "Wikibooks Carte de bucate (Roemeens)",
    "bn": "Wikibooks রন্ধনপ্রণালী (Bengaals)", "id": "Wikibooks Resep (Indonesisch)", "tr": "Wikibooks Yemek (Turks)",
    "el": "Wikibooks Βιβλίο μαγειρικής (Grieks)", "fa": "Wikibooks کتاب آشپزی (Perzisch)",
    "cs": "Wikibooks Wikikuchařka (Tsjechisch)", "sk": "Wikibooks Wikikuchárka (Slowaaks)",
    "hr": "Wikibooks WikiKuharica (Kroatisch)", "uk": "Wikibooks Кулінарна книга (Oekraïens)",
    "bg": "Wikibooks Готварска книга (Bulgaars)", "mk": "Wikibooks Готвач (Macedonisch)",
    "sq": "Wikibooks Wiki kuzhina (Albanees)", "lt": "Wikibooks Receptai (Litouws)",
    "is": "Wikibooks Matreiðslubók (IJslands)", "ms": "Wikibooks Resipi (Maleisisch)",
    "tl": "Wikibooks Pagluluto (Tagalog)", "hi": "Wikibooks रसोई (Hindi)", "ml": "Wikibooks പാചകപുസ്തകം (Malayalam)",
    "ta": "Wikibooks சமையல் நூல் (Tamil)", "eo": "Wikibooks Kuirlibro (Esperanto)",
    "eu": "Wikibooks Sukaldaritza liburua (Baskisch)", "az": "Wikibooks Kulinariya kitabı (Azerbeidzjaans)",
    "ar": "Wikibooks كتاب الطبخ (Arabisch)",
}


def generiek_plain(waarde: str) -> str:
    """Wiki-opmaak en sjablonen ({{\\i|pesto}}, [[link|tekst]]) naar platte tekst."""
    tekst = waarde or ""
    vorige = None
    while vorige != tekst:
        vorige = tekst

        def vervang(treffer):
            delen = [deel.strip() for deel in treffer.group(1).split("|")]
            if delen and "=" in delen[0]:
                delen = delen[1:]
            return delen[-1] if delen else ""

        tekst = re.sub(r"\{\{([^{}]*)\}\}", vervang, tekst)
    tekst = re.sub(r"<!--.*?-->", " ", tekst, flags=re.S)
    tekst = re.sub(r"<ref[^>]*>.*?</ref>", " ", tekst, flags=re.S)
    tekst = re.sub(r"\[\[(?:File|Image|Bestand|Afbeelding|Fitxer|Immagine):[^\]]*\]\]", " ", tekst, flags=re.I)
    tekst = re.sub(r"\[\[([^\]|]+)\|([^\]]+)\]\]", r"\2", tekst)
    tekst = re.sub(r"\[\[([^\]]+)\]\]", r"\1", tekst)
    tekst = re.sub(r"\[https?://\S+\s+([^\]]+)\]", r"\1", tekst)
    tekst = re.sub(r"\[https?://\S+\]", " ", tekst)
    tekst = tekst.replace("'''", "").replace("''", "")
    tekst = re.sub(r"<[^>]+>", " ", tekst)
    tekst = tekst.replace("&nbsp;", " ").replace("&middot;", "·")
    tekst = re.sub(r"\s+", " ", tekst)
    return tekst.strip(" ,;:.")


def generieke_secties(tekst: str) -> dict:
    uit, niveau2, huidig = {}, None, None
    for regel in tekst.split("\n"):
        kop = re.match(r"^\s*(={2,6})\s*(.+?)\s*\1\s*$", regel)
        if kop:
            diepte = len(kop.group(1))
            naam = generiek_plain(kop.group(2)).casefold()
            if diepte == 2:
                niveau2, huidig = naam, None
                uit.setdefault(niveau2, [])
            else:
                huidig = naam
                uit.setdefault(huidig, [])
            continue
        if regel.strip():
            if niveau2:
                uit[niveau2].append(regel.strip())
            if huidig and huidig != niveau2:
                uit[huidig].append(regel.strip())
    return uit


def generieke_zinnen(tekst: str) -> list[str]:
    return [zin.strip() for zin in re.split(r"(?<=[.!?])\s+", tekst) if len(zin.strip()) > 20]


def generiek_record(pagina: dict, taal: str, config: dict):
    tekst = pagina["text"]
    if re.match(r"^\s*#\s*REDIRECT", tekst, re.I):
        return None
    titel = pagina["title"].rsplit("/", 1)[-1].strip()
    if not titel:
        return None
    delen = generieke_secties(tekst)
    ingredienten, gezien = [], set()
    for kop, regels in delen.items():
        if kop.startswith(config["zutaten"]):
            for regel in regels:
                if not regel.startswith(("*", "#")):
                    continue
                schoon = generiek_plain(regel.lstrip("*#").strip())
                if len(schoon) > 1 and schoon.casefold() not in gezien:
                    gezien.add(schoon.casefold())
                    ingredienten.append(schoon)
    stappen, geziene_stappen = [], set()
    for kop, regels in delen.items():
        if not kop.startswith(config["stappen"]):
            continue
        for regel in regels:
            kaal = regel.strip()
            if kaal.startswith(("|", "{{", "}}", "__")):
                continue
            schoon = generiek_plain(kaal.lstrip("*#").strip())
            if len(schoon) <= 3:
                continue
            # Sommige pagina's zetten de bereiding in doorlopende tekst; elke zin
            # telt dan als stap, zoals bij de Duitse import.
            kandidaten = [schoon] if kaal.startswith(("#", "*")) else generieke_zinnen(schoon)
            for zin in kandidaten:
                if len(zin) > 20 and zin.casefold() not in geziene_stappen:
                    geziene_stappen.add(zin.casefold())
                    stappen.append(zin)
    if len(ingredienten) < 3 or len(stappen) < 2:
        return None
    omschrijving = ""
    for regel in tekst.split("\n"):
        schoon = generiek_plain(regel)
        if len(schoon) > 60 and not regel.strip().startswith(("|", "*", "#", "{{", "[[", "=")):
            omschrijving = schoon
            break
    return {
        "title": titel,
        "url": f"https://{config['host']}/wiki/{urllib.parse.quote(pagina['title'].replace(' ', '_'))}",
        "revid": pagina["revid"],
        "revisedAt": pagina["timestamp"],
        "language": taal,
        "countryCode": generiek_land(tekst, config),
        "time": None,
        "servings": None,
        "description": omschrijving,
        "ingredients": ingredienten,
        "steps": stappen,
    }


def generiek_land(tekst: str, config: dict) -> str | None:
    kandidaten = re.findall(r"\[\[(?:Categoria|Catégorie|Categorie):([^\]|]+)", tekst)
    for categorie in kandidaten:
        sleutel = unicodedata.normalize("NFKD", categorie).encode("ascii", "ignore").decode().casefold()
        for hint, code in config["land"].items():
            hint_ascii = unicodedata.normalize("NFKD", hint).encode("ascii", "ignore").decode().casefold()
            if hint_ascii and hint_ascii in sleutel:
                return code
    return None


class GeenRuweData(Exception):
    """De ruwe kookboekpagina's van deze taal zijn niet aanwezig."""


def fetch_generieke_pages(taal: str, config: dict):
    raw = os.environ.get(f"{taal.upper()}_RAW_FILE")
    if raw and Path(raw).exists():
        return json.loads(Path(raw).read_text(encoding="utf-8"))["pages"]
    if "--alleen-beschikbaar" in sys.argv:
        raise GeenRuweData(taal)
    titels, vervolg = [], None
    while True:
        params = {"action": "query", "list": "allpages", "apprefix": config["prefix"], "aplimit": "500",
                  "apnamespace": "0", "format": "json", "formatversion": "2"}
        if vervolg:
            params["apcontinue"] = vervolg
        antwoord = api(params, host=config["host"])
        titels += [pagina["title"] for pagina in antwoord["query"]["allpages"]]
        vervolg = antwoord.get("continue", {}).get("apcontinue")
        if not vervolg:
            break
        time.sleep(0.5)
    pagina = {}
    for start in range(0, len(titels), 40):
        params = {"action": "query", "prop": "revisions", "rvprop": "content|ids|timestamp", "rvslots": "main",
                  "titles": "|".join(titels[start:start + 40]), "format": "json", "formatversion": "2"}
        antwoord = api(params, post=True, host=config["host"])
        for pagina_json in antwoord.get("query", {}).get("pages", []):
            if "revisions" not in pagina_json:
                continue
            revisie = pagina_json["revisions"][0]
            pagina[pagina_json["title"]] = {"title": pagina_json["title"], "revid": revisie["revid"],
                                           "timestamp": revisie["timestamp"], "text": revisie["slots"]["main"]["content"]}
        time.sleep(0.3)
    return [pagina[titel] for titel in titels if titel in pagina]


def select_generiek(taal: str, config: dict, reserved, naam: str):
    try:
        pagina = fetch_generieke_pages(taal, config)
    except GeenRuweData:
        if "--stil" not in sys.argv:
            print(f"  {taal}: overgeslagen (geen ruwe data aanwezig)", flush=True)
        return {"taal": taal, "source": {"name": naam, "dataset": f"https://{config['host']}/wiki/{config['prefix'].rstrip('/')}",
                                         "revision": "niet opgehaald", "license": "CC BY-SA 4.0",
                                         "licenseUrl": CC_BY_SA_URL, "fetchedAt": None, "language": taal},
                "selection": {"count": 0, "criteria": "niet opgehaald"}, "recipes": []}
    seen = set(reserved)
    selected = []
    for rij in pagina:
        record = generiek_record(rij, taal, config)
        if not record:
            continue
        key = normalized(record.get("name") or record["title"])
        if key in seen:
            continue
        seen.add(key)
        selected.append(record)
    selected.sort(key=lambda record: hashlib.sha256(normalized(record["title"]).encode()).hexdigest())
    if config["expected"] and len(selected) != config["expected"] and "--report" not in sys.argv:
        raise RuntimeError(f"Expected {config['expected']} qualifying {taal} Cookbook recipes; got {len(selected)}")
    if not selected:
        if "--stil" not in sys.argv:
            print(f"  {taal}: geen recepten die aan de eisen voldoen", flush=True)
        return {"taal": taal, "source": {"name": naam, "dataset": f"https://{config['host']}/wiki/{config['prefix'].rstrip('/')}",
                                         "revision": "geen bruikbare pagina's", "license": "CC BY-SA 4.0",
                                         "licenseUrl": CC_BY_SA_URL, "fetchedAt": None, "language": taal},
                "selection": {"count": 0, "criteria": "geen pagina's met drie ingrediënten en twee stappen"}, "recipes": []}
    revisies = sorted(record["revid"] for record in selected)
    return {"taal": taal, "source": {"name": naam, "dataset": f"https://{config['host']}/wiki/{config['prefix'].rstrip('/')}",
                                     "revision": f"per-pagina revisies {revisies[0]}\u2013{revisies[-1]}",
                                     "license": "CC BY-SA 4.0", "licenseUrl": CC_BY_SA_URL,
                                     "fetchedAt": max(record["revisedAt"] for record in selected), "language": taal},
            "selection": {"count": len(selected),
                          "criteria": "Every unique page with at least three ingredient lines and two preparation steps; titles deduplicated against all earlier imports. Deterministic order by hashed title."},
            "recipes": selected}


def main() -> None:
    base_names = current_recipe_names()
    unitools, distinct_unitools = select_unitools(base_names)
    reserved = {normalized(name) for name in base_names} | {normalized(recipe["name"]["en"]) for recipe in distinct_unitools}
    wikibooks_en = select_wikibooks_en(base_names, reserved)
    reserved |= {normalized(row["recipe_data"]["title"]) for row in wikibooks_en["recipes"]}
    wikibooks_es = select_wikibooks_es(reserved)
    reserved |= {normalized(record["title"]) for record in wikibooks_es["recipes"]}
    wikibooks_de = select_wikibooks_de(reserved)
    reserved |= {normalized(record["title"]) for record in wikibooks_de["recipes"]}
    wikibooks_nl = select_wikibooks_nl(reserved)
    reserved |= {normalized(record.get("name") or record["title"]) for record in wikibooks_nl["recipes"]}
    alle_generiek = dict(GENERIEKE_BRONNEN)
    alle_generiek.update(EXTRA_BRONNEN)
    generieke_blokken = {}
    for taal, config in alle_generiek.items():
        blok = select_generiek(taal, config, reserved, NAAM_PER_TAAL.get(taal, f"Wikibooks {taal}"))
        if not blok["selection"]["count"]:
            continue
        generieke_blokken[taal] = blok
        reserved |= {normalized(record["title"]) for record in blok["recipes"]}

    generiek_aantal = sum(blok["selection"]["count"] for blok in generieke_blokken.values())
    total = (EXPECTED_CURATED + len(distinct_unitools) + wikibooks_en["selection"]["count"]
             + wikibooks_es["selection"]["count"] + wikibooks_de["selection"]["count"]
             + wikibooks_nl["selection"]["count"] + generiek_aantal)
    samenvatting = {
        "curated": EXPECTED_CURATED,
        "unitools": len(distinct_unitools),
        "wikibooks_en": wikibooks_en["selection"]["count"],
        "wikibooks_es": wikibooks_es["selection"]["count"],
        "wikibooks_de": wikibooks_de["selection"]["count"],
        "wikibooks_nl": wikibooks_nl["selection"]["count"],
        **{f"wikibooks_{taal}": blok["selection"]["count"] for taal, blok in generieke_blokken.items()},
        "total": total,
        "german_with_country": sum(1 for record in wikibooks_de["recipes"] if record["countryCode"]),
        "german_with_time": sum(1 for record in wikibooks_de["recipes"] if record["time"]),
        "spanish_with_country": sum(1 for record in wikibooks_es["recipes"] if record["countryCode"]),
        "spanish_with_time": sum(1 for record in wikibooks_es["recipes"] if record["time"]),
        "dutch_with_country": sum(1 for record in wikibooks_nl["recipes"] if record["countryCode"]),
        "dutch_with_time": sum(1 for record in wikibooks_nl["recipes"] if record["time"]),
        **{f"{taal}_with_country": sum(1 for record in blok["recipes"] if record["countryCode"]) for taal, blok in generieke_blokken.items()},
    }
    if "--report" in sys.argv:
        print(json.dumps(samenvatting, ensure_ascii=False, indent=2))
        return
    if total < 5000:
        raise RuntimeError(f"Expected at least 5000 recipes in total; got {total}")

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "unitools-recipes.json").write_text(json.dumps(unitools, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (OUT / "wikibooks-en-recipes.json").write_text(json.dumps(wikibooks_en, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (OUT / "wikibooks-es-recipes.json").write_text(json.dumps(wikibooks_es, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (OUT / "wikibooks-de-recipes.json").write_text(json.dumps(wikibooks_de, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (OUT / "wikibooks-nl-recipes.json").write_text(json.dumps(wikibooks_nl, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for taal, blok in generieke_blokken.items():
        (OUT / f"wikibooks-{taal}-recipes.json").write_text(json.dumps(blok, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (OUT / "source-lock.json").write_text(json.dumps({
        "unitools": {"revision": UNITOOLS_REVISION, "url": UNITOOLS_URL, "license": "CC BY-SA 4.0"},
        "wikibooks_en": {"revision": WIKIBOOKS_REVISION, "url": WIKIBOOKS_URL.split("?", 1)[0], "license": "CC BY-SA 4.0"},
        "wikibooks_es": {"host": ES_HOST, "category": ES_CATEGORY, "license": "CC BY-SA 4.0",
                         "revision": wikibooks_es["source"]["revision"], "fetchedAt": wikibooks_es["source"]["fetchedAt"]},
        "wikibooks_de": {"host": DE_HOST, "prefix": DE_PREFIX, "license": "CC BY-SA 4.0",
                         "revision": wikibooks_de["source"]["revision"], "fetchedAt": wikibooks_de["source"]["fetchedAt"]},
        "wikibooks_nl": {"host": NL_HOST, "prefix": NL_PREFIX, "license": "CC BY-SA 4.0",
                         "revision": wikibooks_nl["source"]["revision"], "fetchedAt": wikibooks_nl["source"]["fetchedAt"]},
        **{f"wikibooks_{taal}": {"host": blok["source"]["dataset"], "prefix": alle_generiek[taal]["prefix"],
                                 "license": "CC BY-SA 4.0", "revision": blok["source"]["revision"],
                                 "fetchedAt": blok["source"]["fetchedAt"]}
           for taal, blok in generieke_blokken.items()},
    }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    samenvatting["output_files"] = [str(OUT / naam) for naam in
                                    ("unitools-recipes.json", "wikibooks-en-recipes.json", "wikibooks-es-recipes.json", "wikibooks-de-recipes.json", "wikibooks-nl-recipes.json", "source-lock.json")]
    print(json.dumps(samenvatting, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()