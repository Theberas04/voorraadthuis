# Recipe data, attribution and licences

This directory contains only recipe text and structured source data; the app does not redistribute recipe photographs. Imported recipes remain in English. The application adapts source fields for display and shopping-list use; per-recipe source and licence links are rendered in the recipe card.

## UniTools World Recipes

- Source: [UniTools data page](https://theunitools.com/en/data) and [source repository](https://github.com/farcrak/unitools-recipes)
- Dataset version: 2.0.0; source metadata reports 501 recipes from 127 countries. Pinned source commit: [`2f554073f7e730b18d707fe1164d18308f6ec16c`](https://github.com/farcrak/unitools-recipes/commit/2f554073f7e730b18d707fe1164d18308f6ec16c).
- Licence: [Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/)
- Attribution: UniTools — theunitools.com.
- 500 recipes are shown in VoorraadThuis; the existing Dutch Shakshuka entry is retained instead of the duplicate UniTools entry.

## Wikibooks Cookbook

- Dataset: [Wikibooks Cookbook dataset card](https://huggingface.co/datasets/gossminn/wikibooks-cookbook), a 2024-07-31 scrape of recipe pages. Pinned dataset revision: [`49fb73ea07d2a1380c15197db5589934937457ed`](https://huggingface.co/datasets/gossminn/wikibooks-cookbook/tree/49fb73ea07d2a1380c15197db5589934937457ed).
- Upstream book: [Wikibooks Cookbook](https://en.wikibooks.org/wiki/Cookbook:Table_of_Contents); each imported entry retains its exact recipe-page URL for contributor attribution and history.
- Licence stated by the dataset: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); Wikibooks' [copyright policy](https://en.wikibooks.org/wiki/Wikibooks:Copyrights) explains attribution and share-alike requirements.
- 385 entries were selected from pages with at least three ingredient lines, three procedure steps, a published time and a published serving count. Existing and duplicate recipe titles were excluded. Country-specific source categories are used when they match a UniTools country-cuisine label; other entries are grouped as “Internationaal”.
- Every imported record links directly to its Wikibooks recipe page; adapted field mappings and selection are made available under the same CC BY-SA 4.0 terms. Ranged quantities remain verbatim in the shopping list rather than being averaged; unquantified amounts are labelled as not stated.

## Rebuilding the selected data

Run `python3 scripts/build-open-recipe-data.py` from the repository root. The script downloads the two source datasets, applies deterministic selection and duplicate checks against the current 115 curated recipes, and writes the two JSON files in this directory. It requires network access. Review the source pages and attribution before redistributing changes.

The 115 existing Dutch recipes are original practical home versions and are not derived from these external datasets. No Albert Heijn or Picnic recipe text is included.
