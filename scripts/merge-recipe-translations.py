#!/usr/bin/env python3
"""Bundel de Nederlandse vertalingen van de geïmporteerde recepten.

De vertaling gebeurt per blok van 45 recepten (input-NN.json naar output-NN.json).
Dit script controleert elk blok streng en schrijft daarna één bestand dat de app
inleest: recipe-data/translations-nl.json.

Gebruik:
    python3 scripts/merge-recipe-translations.py [--dir PAD] [--report]

Zonder --report wordt er alleen geschreven als alle 885 recepten vertaald zijn.
Met --report wordt de voortgang gemeld en verandert er niets.
"""

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
EXPECTED_IDS = 885
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
        raise SystemExit(
            f"{output_path.name}: {len(translated)} records, verwacht {len(source)}"
        )
    for before, after in zip(source, translated):
        where = f"{output_path.name} (id {before.get('id')})"
        if before.get("id") != after.get("id"):
            raise SystemExit(f"{where}: id is veranderd naar {after.get('id')}")
        if not str(after.get("name") or "").strip():
            raise SystemExit(f"{where}: naam ontbreekt")
        if len(before.get("ingredients") or []) != len(after.get("ingredients") or []):
            raise SystemExit(f"{where}: aantal ingrediënten is veranderd")
        if len(before.get("steps") or []) != len(after.get("steps") or []):
            raise SystemExit(f"{where}: aantal bereidingsstappen is veranderd")
        for index, (source_ingredient, translated_ingredient) in enumerate(
            zip(before["ingredients"], after["ingredients"])
        ):
            if not str(translated_ingredient.get("name") or "").strip():
                raise SystemExit(f"{where}: ingrediënt {index + 1} heeft geen naam")
        for index, step in enumerate(after["steps"]):
            if not str(step or "").strip():
                raise SystemExit(f"{where}: stap {index + 1} is leeg")
    return translated


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dir",
        default=str(REPO.parent / ".hermes/cache/scratch/voorraadthuis-translation"),
        help="map met de blokken input-NN.json en output-NN.json",
    )
    parser.add_argument("--report", action="store_true", help="alleen voortgang melden")
    parser.add_argument(
        "--out",
        default=str(REPO / "recipe-data/translations-nl.json"),
        help="uitvoerbestand",
    )
    args = parser.parse_args()

    chunk_dir = Path(args.dir)
    if not chunk_dir.is_dir():
        raise SystemExit(f"map niet gevonden: {chunk_dir}")

    inputs = sorted(chunk_dir.glob("input-*.json"))
    if not inputs:
        raise SystemExit(f"geen input-*.json gevonden in {chunk_dir}")

    items = {}
    done_chunks = []
    missing_chunks = []
    total_source = 0

    for input_path in inputs:
        index = input_path.stem.split("-")[-1]
        output_path = chunk_dir / f"output-{index}.json"
        total_source += len(load(input_path))
        try:
            translated = check_chunk(input_path, output_path)
        except LookupError:
            missing_chunks.append(index)
            continue
        for record in translated:
            key = str(record.get("id"))
            if key in items:
                raise SystemExit(f"id {key} komt twee keer voor")
            items[key] = {
                "name": record["name"],
                "cuisine": record.get("cuisine"),
                "description": record.get("description"),
                "ingredients": [
                    {"name": ingredient.get("name"), "display": ingredient.get("display")}
                    for ingredient in record["ingredients"]
                ],
                "steps": list(record["steps"]),
            }
        done_chunks.append(index)

    if total_source != EXPECTED_IDS:
        raise SystemExit(f"{total_source} bronrecords gevonden, verwacht {EXPECTED_IDS}")

    print(
        f"{len(items)} van {EXPECTED_IDS} recepten vertaald "
        f"({len(done_chunks)} blokken klaar, ontbreekt: {', '.join(missing_chunks) or 'niets'})"
    )

    if len(items) != EXPECTED_IDS:
        if args.report:
            return 0
        raise SystemExit(
            f"nog niet alle recepten zijn vertaald: {len(items)} van {EXPECTED_IDS}"
        )

    ordered = {
        key: items[key]
        for key in sorted(items, key=lambda value: (len(value), value))
    }
    payload = {
        "note": (
            "Nederlandse vertaling van de geïmporteerde recepten (UniTools World Recipes "
            "en Wikibooks Cookbook). Id's, hoeveelheden, bron- en licentiegegevens blijven "
            "ongewijzigd; alleen de tekst is vertaald."
        ),
        "translatedFrom": "en",
        "count": len(ordered),
        "items": ordered,
    }
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")
    print(f"geschreven: {out_path} ({len(ordered)} recepten)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
