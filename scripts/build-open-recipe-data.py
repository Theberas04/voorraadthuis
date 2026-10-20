#!/usr/bin/env python3
"""Fetch and select openly licensed recipe data for VoorraadThuis.

The source recipe text stays verbatim in recipe-data/; the app adapts its
structure at runtime and links each imported recipe back to its source.
"""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "recipe-data"
TARGET_TOTAL = 1000
UNITOOLS_REVISION = "2f554073f7e730b18d707fe1164d18308f6ec16c"
WIKIBOOKS_REVISION = "49fb73ea07d2a1380c15197db5589934937457ed"
UNITOOLS_URL = f"https://raw.githubusercontent.com/farcrak/unitools-recipes/{UNITOOLS_REVISION}/unitools-recipes-v1.json"
WIKIBOOKS_URL = f"https://huggingface.co/datasets/gossminn/wikibooks-cookbook/resolve/{WIKIBOOKS_REVISION}/recipes_parsed.mini.json?download=true"
WIKIBOOKS_DATASET = "https://huggingface.co/datasets/gossminn/wikibooks-cookbook"
CC_BY_SA_URL = "https://creativecommons.org/licenses/by-sa/4.0/"


def fetch_json(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": "VoorraadThuis-open-recipe-import/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def normalized(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]", "", ascii_value.casefold())


def duration_minutes(value) -> int:
    if not isinstance(value, str):
        return 0
    total = 0.0
    pattern = re.compile(r"(?P<start>\d+(?:\.\d+)?)(?:\s*[-–]\s*(?P<end>\d+(?:\.\d+)?))?\s*(?P<unit>hours?|hrs?|h|minutes?|mins?|min)\b", re.I)
    for match in pattern.finditer(value):
        amount = float(match.group("start"))
        if match.group("end"):
            amount = (amount + float(match.group("end"))) / 2
        total += amount * (60 if match.group("unit").casefold().startswith(("h", "hr")) else 1)
    return round(total)


def servings_count(value) -> int:
    if isinstance(value, (int, float)):
        return round(value) if value > 0 else 0
    if not isinstance(value, str):
        return 0
    match = re.search(r"(?P<start>\d+)(?:\s*[-–]\s*(?P<end>\d+))?", value)
    if not match:
        return 0
    first = int(match.group("start"))
    amount = (first + int(match.group("end"))) / 2 if match.group("end") else first
    return max(1, round(amount))


def current_recipe_names() -> list[str]:
    server = (ROOT / "server.js").read_text(encoding="utf-8")
    international = (ROOT / "recipes-international.js").read_text(encoding="utf-8")
    builtins = re.findall(r"\{id:\d+,name:'([^']+)'", server)
    translated = re.findall(r"\['[^']+','([^']+)'", international)
    names = builtins + translated
    if len(names) != 115:
        raise RuntimeError(f"Expected the existing 115 recipes; found {len(names)}")
    return names


def main() -> None:
    unitools = fetch_json(UNITOOLS_URL)
    wikibooks = fetch_json(WIKIBOOKS_URL)
    base_names = current_recipe_names()
    unitools_names = [recipe["name"]["en"] for recipe in unitools["recipes"]]
    reserved = {normalized(name) for name in base_names + unitools_names}
    distinct_unitools = []
    seen_unitools = {normalized(name) for name in base_names}
    for recipe in unitools["recipes"]:
        key = normalized(recipe["name"]["en"])
        if key not in seen_unitools:
            distinct_unitools.append(recipe)
            seen_unitools.add(key)
    wanted_wikibooks = TARGET_TOTAL - len(base_names) - len(distinct_unitools)
    cuisine_codes = {
        country["cuisine"]["en"].removesuffix(" cuisine").casefold(): country["code"]
        for country in unitools["countries"]
    }
    candidates = []
    seen = set(reserved)
    for row in wikibooks:
        recipe = row.get("recipe_data") or {}
        title = recipe.get("title") or ""
        key = normalized(title)
        info = recipe.get("infobox") or {}
        lines = recipe.get("text_lines") or []
        ingredients = [line.get("text", "").strip() for line in lines
                      if (line.get("section") or "").casefold() == "ingredients"
                      and line.get("line_type") == "ul" and line.get("text", "").strip()]
        steps = [line.get("text", "").strip() for line in lines
                 if (line.get("section") or "").casefold() == "procedure"
                 and line.get("line_type") == "ol" and line.get("text", "").strip()]
        time = duration_minutes(info.get("time"))
        servings = servings_count(info.get("servings"))
        if not title or key in seen or len(ingredients) < 3 or len(steps) < 3 or not time or not servings:
            continue
        seen.add(key)
        category = (info.get("category") or "").rsplit(":", 1)[-1]
        category = category.replace("_recipes", "").replace("_", " ").strip().casefold()
        country_code = cuisine_codes.get(category, "")
        candidates.append((0 if country_code else 1, hashlib.sha256(key.encode("utf-8")).hexdigest(), row))
    candidates.sort(key=lambda item: (item[0], item[1]))
    if len(candidates) < wanted_wikibooks:
        raise RuntimeError(f"Only {len(candidates)} qualifying unique Wikibooks recipes; need {wanted_wikibooks}")
    selected = [item[2] for item in candidates[:wanted_wikibooks]]
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "unitools-recipes.json").write_text(json.dumps(unitools, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    wiki_envelope = {
        "source": {
            "name": "Wikibooks Cookbook",
            "dataset": WIKIBOOKS_DATASET,
            "revision": WIKIBOOKS_REVISION,
            "license": "CC BY-SA 4.0",
            "licenseUrl": CC_BY_SA_URL,
            "scrapedAt": "2024-07-31",
        },
        "selection": {
            "count": len(selected),
            "criteria": "At least three ingredient lines, three procedure steps, parseable published time and servings; titles deduplicated against existing and UniTools recipes. Country-category recipes are prioritized, remaining recipes are grouped as International.",
            "adaptation": "Selected recipe records retained from the source dump; runtime field mapping and a deterministic selection order are used by VoorraadThuis.",
        },
        "recipes": selected,
    }
    (OUT / "wikibooks-recipes.json").write_text(json.dumps(wiki_envelope, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    source_lock = {
        "unitools": {"revision": UNITOOLS_REVISION, "url": UNITOOLS_URL, "license": "CC BY-SA 4.0"},
        "wikibooks": {"revision": WIKIBOOKS_REVISION, "url": WIKIBOOKS_URL.split("?", 1)[0], "license": "CC BY-SA 4.0"},
    }
    (OUT / "source-lock.json").write_text(json.dumps(source_lock, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "existing": len(base_names),
        "unitools_imported": len(distinct_unitools),
        "wikibooks_imported": len(selected),
        "total": len(base_names) + len(distinct_unitools) + len(selected),
        "wikibooks_qualifying_unique": len(candidates),
        "output_files": [str(OUT / "unitools-recipes.json"), str(OUT / "wikibooks-recipes.json"), str(OUT / "source-lock.json")],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
