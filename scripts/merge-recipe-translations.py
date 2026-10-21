#!/usr/bin/env python3
"""Bundel de Nederlandse vertalingen van de geïmporteerde recepten.

De vertaling gebeurt per blok van 45 recepten (input-NN.json -> output-NN.json).
Dit script controleert elk blok streng en schrijft daarna één bestand dat de app
inleest: recipe-data/translations-nl.json. Vertalingen staan op een vaste
bronsleutel (bron + titel), niet op een volgnummer, zodat de selectie kan groeien
zonder dat bestaande vertalingen losraken.

Gebruik:
    python3 scripts/merge-recipe-translations.py [--dir PAD] [--report] [--out BESTAND]

Zonder --report wordt er alleen geschreven als alle 4.964 recepten vertaald zijn.
Met --report wordt de voortgang gemeld en verandert er niets.
"""

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
EXPECTED_RECORDS = 8985
CHUNK_SIZE = 45


def load(path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def check_chunk(input_path, output_path):
    """Controleer één vertaald blok en geef de records terug."""
    source = load(input_path)
    if not isinstance(source, list) or not source:
        raise SystemExit(f"{input_path.name}: geen lijst met recepten")
    if not output_path.exists():
        raise LookupError(f"{output_path.name} ontbreekt")
    translated = load(output_path)
    if not isinstance(translated, list):
        raise SystemExit(f"{output_path.name}: geen lijst met recepten")
    if len(translated) != len(source):
        raise SystemExit(f"{output_path.name}: {len(translated)} records, verwacht {len(source)}")
    for before, after in zip(source, translated):
        where = f"{output_path.name} ({before.get('key')})"
        if before.get("key") != after.get("key"):
            raise SystemExit(f"{where}: sleutel is veranderd naar {after.get('key')}")
        if not str(after.get("name") or "").strip():
            raise SystemExit(f"{where}: naam ontbreekt")
        if len(before.get("ingredients") or []) != len(after.get("ingredients") or []):
            raise SystemExit(f"{where}: aantal ingrediënten is veranderd")
        if len(before.get("steps") or []) != len(after.get("steps") or []):
            raise SystemExit(f"{where}: aantal bereidingsstappen is veranderd")
        for index, (source_ingredient, translated_ingredient) in enumerate(zip(before["ingredients"], after["ingredients"])):
            if not str(translated_ingredient.get("name") or "").strip():
                raise SystemExit(f"{where}: ingrediënt {index + 1} heeft geen naam")
            if (source_ingredient.get("display") is None) != (translated_ingredient.get("display") is None):
                raise SystemExit(f"{where}: ingrediënt {index + 1} heeft een display-veld gekregen of verloren")
        for index, step in enumerate(after["steps"]):
            if not str(step or "").strip():
                raise SystemExit(f"{where}: stap {index + 1} is leeg")
    return translated


def collect(chunk_dir):
    """Lees alle aanwezige blokken; geef de vertalingen en de ontbrekende blokken terug."""
    inputs = sorted(chunk_dir.glob("input-*.json"))
    if not inputs:
        raise SystemExit(f"geen input-*.json gevonden in {chunk_dir}")
    items, missing, seen_in_source = {}, [], 0
    partial = chunk_dir / "translations-partial.json"
    if partial.exists():
        deels = load(partial)
        items.update(deels.get("items", {}))
        print(f"al aanwezig: {len(items)} vertalingen uit {partial.name}")
    al_aanwezig = len(items)
    for input_path in inputs:
        index = input_path.stem.split("-")[-1]
        seen_in_source += len(load(input_path))
        try:
            translated = check_chunk(input_path, chunk_dir / f"output-{index}.json")
        except LookupError:
            missing.append(index)
            continue
        for record in translated:
            key = record["key"]
            if key in items:
                raise SystemExit(f"sleutel {key} komt twee keer voor")
            items[key] = {
                "name": record["name"],
                "description": record.get("description") or "",
                "ingredients": [{"name": ingredient.get("name"), "display": ingredient.get("display")} for ingredient in record["ingredients"]],
                "steps": list(record["steps"]),
            }
    return items, missing, seen_in_source, al_aanwezig


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dir", default=str(REPO.parent / ".hermes/cache/scratch/voorraadthuis-vertaling-2"),
                        help="map met de blokken input-NN.json en output-NN.json")
    parser.add_argument("--report", action="store_true", help="alleen voortgang melden")
    parser.add_argument("--out", default=str(REPO / "recipe-data/translations-nl.json"), help="uitvoerbestand")
    args = parser.parse_args()

    chunk_dir = Path(args.dir)
    if not chunk_dir.is_dir():
        raise SystemExit(f"map niet gevonden: {chunk_dir}")

    items, missing, verwacht, al_aanwezig = collect(chunk_dir)
    print(f"{len(items)} van {EXPECTED_RECORDS} recepten vertaald; ontbrekende blokken: {', '.join(missing) or 'niets'}")
    if al_aanwezig + verwacht != EXPECTED_RECORDS:
        raise SystemExit(f"{al_aanwezig} overgenomen + {verwacht} in blokken = {al_aanwezig + verwacht} recepten, verwacht {EXPECTED_RECORDS}")
    if args.report:
        return 0
    if len(items) != EXPECTED_RECORDS or missing:
        raise SystemExit(f"nog niet compleet: {len(items)} van {EXPECTED_RECORDS}; niets geschreven.")

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as handle:
        json.dump({
            "note": ("Nederlandse vertaling van de geïmporteerde recepten (UniTools World Recipes en het "
                     "Wikibooks-kookboek in het Engels, Spaans, Duits, Frans, Italiaans, Catalaans, Portugees, "
                     "Japans, Pools, Zweeds, Noors en Fins). Sleutels, hoeveelheden, eenheden, tijden, porties, "
                     "bron- en licentiegegevens blijven ongewijzigd; alleen de tekst is vertaald."),
            "translatedFrom": "en/es/de/fr/it/ca/pt/ja/pl/sv/nb/fi",
            "count": len(items),
            "items": items,
        }, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")
    langste = max((len(ingredient["name"]) for record in items.values() for ingredient in record["ingredients"]), default=0)
    print(json.dumps({"geschreven": str(out_path), "recepten": len(items), "langste_ingredientnaam": langste}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())