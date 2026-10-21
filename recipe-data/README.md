# Recipe data, attribution and licences

This directory contains only recipe text and structured source data; the app does not redistribute recipe photographs. Imported recipes are translated into Dutch for display (see *Dutch translation* below); the source text stays with the linked upstream page, and per-recipe source and licence links are rendered in the recipe card.

Counts: 115 original Dutch home recipes + 9,435 imported recipes = **9,550 recipes**, from fourteen openly licensed sources (450 of the imports are Dutch to begin with, so 8,985 need a Dutch translation).

## UniTools World Recipes — 500 recipes

- Source: [UniTools data page](https://theunitools.com/en/data) and [source repository](https://github.com/farcrak/unitools-recipes)
- Dataset version: 2.0.0; source metadata reports 501 recipes from 127 countries. Pinned source commit: [`2f554073f7e730b18d707fe1164d18308f6ec16c`](https://github.com/farcrak/unitools-recipes/commit/2f554073f7e730b18d707fe1164d18308f6ec16c).
- Licence: [Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/)
- Attribution: UniTools — theunitools.com.
- Source language: English (the dataset also carries Russian; the English text is imported).
- 500 recipes are shown in VoorraadThuis; the existing Dutch Shakshuka entry is retained instead of the duplicate UniTools entry.

## Wikibooks Cookbook (English) — 3,393 recipes

- Dataset: [Wikibooks Cookbook dataset card](https://huggingface.co/datasets/gossminn/wikibooks-cookbook), a 2024-07-31 scrape of recipe pages. Pinned dataset revision: [`49fb73ea07d2a1380c15197db5589934937457ed`](https://huggingface.co/datasets/gossminn/wikibooks-cookbook/tree/49fb73ea07d2a1380c15197db5589934937457ed).
- Upstream book: [Wikibooks Cookbook](https://en.wikibooks.org/wiki/Cookbook:Table_of_Contents); each imported entry retains its exact recipe-page URL for contributor attribution and history.
- Licence stated by the dataset: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); Wikibooks' [copyright policy](https://en.wikibooks.org/wiki/Wikibooks:Copyrights) explains attribution and share-alike requirements.
- Selection: every unique Cookbook page with at least three ingredient lines and three procedure steps (3,426 qualify; 3,393 remain after removing titles that duplicate the curated recipes or UniTools). Published times and serving counts are carried over when the page states them, otherwise the recipe shows “Tijd niet vermeld”.
- Country-specific source categories are used when they match a UniTools country-cuisine label; other entries are grouped as “Internationaal”.

## Wikibooks Kochbuch (Spanish) — 664 recipes

- Upstream book: [Artes culinarias/Recetas](https://es.wikibooks.org/wiki/Categoría:Recetas) on Spanish Wikibooks; 1,030 recipe pages were retrieved through the MediaWiki API.
- Licence: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); see [Wikibooks copyrights](https://es.wikibooks.org/wiki/Wikibooks:Derechos_de_autor).
- Selection: every unique page with at least three ingredient and three procedure lines in the `Artes culinarias/Datos de receta` template (664 recipes). Country names come from the Spanish cuisine categories when they can be mapped, otherwise the recipes are grouped as “Internationaal”.
- Provenance: the import records the page id and revision id of every page in `source-lock.json`; each recipe links back to its page.

## Wikibooks Kochbuch (German) — 407 recipes

- Upstream book: [Kochbuch](https://de.wikibooks.org/wiki/Kochbuch) on German Wikibooks; 924 pages with the `Kochbuch/` prefix were retrieved through the MediaWiki API.
- Licence: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); see [Wikibooks copyrights](https://de.wikibooks.org/wiki/Wikibooks:Urheberrechte).
- Selection: every unique page with a Zutaten (ingredients) section of at least three lines and a Zubereitung (preparation) part yielding at least two steps (407 recipes). German pages often write the preparation as running text; each sentence counts as a step, so two steps still describe a complete recipe.
- Provenance: page id and revision id per page are recorded in `source-lock.json`; each recipe links back to its page.

## Wikibooks Kookboek (Dutch) — 450 recipes

- Upstream book: [Kookboek](https://nl.wikibooks.org/wiki/Kookboek) on Dutch Wikibooks; 1,356 pages under the `Kookboek/` prefix were retrieved through the MediaWiki API.
- Licence: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); see [Wikibooks auteursrechten](https://nl.wikibooks.org/wiki/Wikibooks:Auteursrechten).
- Selection: every unique page with an `Ingrediënten` (or `Benodigdheden`) section of at least three list lines and a `Bereiding`/`Bereidingswijze` section of at least two steps (450 recipes after removing titles that duplicate the curated recipes). A level-2 heading also counts the lines of its subsections, because the Dutch book often splits ingredients over `Basisingrediënten`/`Optioneel` and the preparation over named steps.
- These recipes are **already Dutch**: they are imported without a translation and carry no “Vertaald” label. The infobox supplies servings and time; `{{Kb|…}}` and `{{Wp|…}}` templates are reduced to their visible text.
- Provenance: page id and revision id per page are recorded in `source-lock.json`; each recipe links back to its page.

## Wikibooks Livre de cuisine (French) — 986 recipes

- Upstream book: [Livre de cuisine](https://fr.wikibooks.org/wiki/Livre_de_cuisine) on French Wikibooks; 2,022 pages under the `Livre de cuisine/` prefix were retrieved through the MediaWiki API.
- Licence: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); see [Wikibooks droits d'auteur](https://fr.wikibooks.org/wiki/Wikibooks:Droit_d%27auteur).
- Selection: every unique page with an `Ingrédients` section of at least three list lines and a `Préparation` part producing at least two steps (986 recipes; French pages sometimes write the preparation as running prose, then each sentence counts as a step).
- Source language: French; translated into Dutch.

## Wikibooks Libro di cucina (Italian) — 583 recipes

- Upstream book: [Libro di cucina](https://it.wikibooks.org/wiki/Libro_di_cucina) on Italian Wikibooks; 868 pages under the `Libro di cucina/` prefix were retrieved through the MediaWiki API.
- Licence: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); see [Wikibooks diritto d'autore](https://it.wikibooks.org/wiki/Wikibooks:Diritto_d%27autore).
- Selection: every unique page with an `Ingredienti` section of at least three list lines and a `Preparazione`/`Procedimento` part producing at least two steps (583 recipes).
- Source language: Italian; translated into Dutch.

## Wikibooks Llibre de cuina (Catalan) — 673 recipes

- Upstream book: [Llibre de cuina](https://ca.wikibooks.org/wiki/Llibre_de_cuina) on Catalan Wikibooks; 916 pages under the `Llibre de cuina/` prefix were retrieved through the MediaWiki API.
- Licence: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); see [Wikibooks drets d'autor](https://ca.wikibooks.org/wiki/Wikibooks:Drets_d%27autor).
- Selection: every unique page with an `Ingredients` section of at least three list lines and a `Preparació`/`Elaboració` part producing at least two steps (673 recipes; many Catalan pages give the preparation as running prose, so each sentence counts as a step).
- Source language: Catalan; translated into Dutch.

## Wikibooks Livro de receitas (Portuguese) — 237 recipes

- Upstream book: [Livro de receitas](https://pt.wikibooks.org/wiki/Livro_de_receitas); 2,128 pages were retrieved through the MediaWiki API (this wiki has no dedicated recipe namespace, so only pages below the Cookbook prefix are listed).
- Licence: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); see [Wikibooks copyrights](https://pt.wikibooks.org/wiki/Wikibooks:Direitos_de_autor).
- Selection: every unique page with at least three ingredient lines and two preparation steps (237 recipes). Pages that merely collect other recipes ("Receita 1", "Receita 2", …) are skipped because they carry no preparation section of their own.

## Wikibooks 料理本 (Japanese) — 276 recipes

- Upstream book: [料理本](https://ja.wikibooks.org/wiki/料理本); 1,419 pages were retrieved through the MediaWiki API.
- Licence: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); see [Wikibooks copyrights](https://ja.wikibooks.org/wiki/Wikibooks:著作権).
- Selection: only pages with both a 材料 (ingredients) and a 作り方 (preparation) section count. The Japanese book is largely an ingredient encyclopaedia — まとめ, 特徴 and 栄養成分 pages describe a food rather than give a recipe — so 276 recipe pages remain out of 1,419.
- Amounts are parsed from the Japanese forms: 大さじ4 (tablespoons before the number), 4束 (unit after the number) and 適量/少々 (no number).

## Wikibooks Książka kucharska (Polish) — 863 recipes

- Upstream book: [Książka kucharska](https://pl.wikibooks.org/wiki/Książka_kucharska); 1,018 pages were retrieved through the MediaWiki API.
- Licence: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); see [Wikibooks copyrights](https://pl.wikibooks.org/wiki/Wikibooks:Prawa_autorskie).
- Selection: every unique page with at least three ingredient lines and two preparation steps (863 recipes). The Polish book is the second largest source in the app after the English one.

## Wikibooks Kokboken (Swedish) — 313 recipes

- Upstream book: [Kokboken](https://sv.wikibooks.org/wiki/Kokboken); 435 pages were retrieved through the MediaWiki API.
- Licence: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); see [Wikibooks copyrights](https://sv.wikibooks.org/wiki/Wikibooks:Upphovsrätt).
- Selection: every unique page with at least three ingredient lines and two preparation steps (313 recipes).

## Wikibooks Kokebok (Norwegian) — 79 recipes

- Upstream book: [Kokebok](https://nb.wikibooks.org/wiki/Kokebok); 133 pages were retrieved through the MediaWiki API. Most of the book is a list of ingredients and techniques rather than recipes, hence the smaller selection.
- Licence: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); see [Wikibooks copyrights](https://no.wikibooks.org/wiki/Wikibooks:Opphavsrett).
- Selection: every unique page with at least three ingredient lines and two preparation steps (79 recipes).

## Wikibooks Keittokirja (Finnish) — 11 recipes

- Upstream book: [Keittokirja](https://fi.wikibooks.org/wiki/Keittokirja); 74 pages were retrieved through the MediaWiki API. The Finnish book is still mostly a skeleton, so only 11 pages qualify as a recipe.
- Licence: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); see [Wikibooks copyrights](https://fi.wikibooks.org/wiki/Wikibooks:Tekijänoikeudet).
- Selection: every unique page with at least three ingredient lines and two preparation steps (11 recipes). The book is included for completeness; the count is stated honestly rather than padded.

## Ranged and unquantified amounts

Wikibooks ingredient lines that carry a ranged quantity (“2–4 cups rice”) keep that range verbatim as a single display line (unit `bronregel`); the quantity is never averaged into a midpoint. Amounts the source does not quantify are labelled as not stated.

## Dutch translation

All 7,206 imported recipes from English, Spanish, German, French, Italian and Catalan sources are available in Dutch: name, description, ingredient names and preparation steps. The 450 recipes of the Dutch Kookboek are Dutch already and are imported as they are. The translation lives in `translations-nl.json` and is applied at load time by `recipes-open.js`. It never replaces identifiers, quantities, units, cooking times, servings, source URLs or licence fields — every imported recipe still points at its original and stays attributed.

- Keys: translations are stored per **source key** (`unitools:…`, `wikibooks-en:…`, `wikibooks-es:…`, `wikibooks-de:…`), not per row number, so the selection can grow without orphaning earlier translations.
- Method: block-wise translation of 45 recipes per block (`input-NN.json` → `output-NN.json`), from English, Spanish or German into Dutch. Each block is validated for record count, key order, ingredient and step counts, empty fields and display-line parity before it is accepted.
- Verify without writing: `python3 scripts/merge-recipe-translations.py --report`. Without `--report` the script writes `translations-nl.json` and refuses to write anything unless all 7,206 recipes are present.
- The application refuses to start when even one imported recipe has no translation, so a partial merge can never be deployed silently.

## Rebuilding the selected data

```
python3 scripts/build-open-recipe-data.py            # downloads all sources, writes the JSON files here
python3 scripts/build-open-recipe-data.py --report   # counts only, writes nothing
```

The script needs network access. It pins the UniTools commit and the Cookbook dataset revision, retrieves the Spanish and German Cookbook pages through the MediaWiki API (recording their revision ids), applies deterministic selection and duplicate checks against the 115 curated recipes, and refuses to write unless the expected per-source counts are met. `ES_RAW_FILE`, `DE_RAW_FILE`, `NL_RAW_FILE`, `FR_RAW_FILE`, `IT_RAW_FILE` and `CA_RAW_FILE` point the fetches at a saved raw dump so the same input can be rebuilt without touching the wikis. Review the source pages and attribution before redistributing changes.

`node scripts/export-recipe-sources.js <file>` writes exactly the import records the app builds, so the translation pipeline works on the same text.

The 115 existing Dutch recipes are original practical home versions and are not derived from these external datasets. No Albert Heijn or Picnic recipe text is included.
