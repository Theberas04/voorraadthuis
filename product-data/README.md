# Huismerken van Nederlandse, Duitse en Belgische supermarkten

Deze map bevat twee tabellen waarmee VoorraadThuis huismerken herkent:

| Bestand | Inhoud |
| --- | --- |
| `nl-huismerken.json` | Per barcode: naam, merk, hoeveelheid, categorie en de winkel waar het huismerk bij hoort. |
| `winkelprefixen.json` | Welke barcode-reeksen (GS1-prefixen) bij welke supermarkt horen. |
| `lp-barcodes.json` | 101.982 vinylbarcodes: 101.980 uitgaven uit MusicBrainz, één expliciete correctie en één handmatige aanvulling, met titel, artiest, jaar, label, formaat en release-ID waar beschikbaar. De app herkent ze lokaal en zonder internet. |

De tabel bevat **45.623 producten van veertig ketens** en **289 barcode-reeksen**. Naar land:
**Duitsland 20.521, Nederland 17.347, België 7.755**. De grootste ketens: Lidl 10.259,
REWE 5.286, Kaufland 3.901, Edeka 3.105, Delhaize 2.925, Aldi 2.820, Albert Heijn 2.469,
Penny 2.444, Boni 1.100, Carrefour 1.086, Netto 1.056, Jumbo 990, PLUS 977, Colruyt 938 en
Globus 897. Elke barcode in de tabel heeft een kloppend controlecijfer, zodat er niets
tussenstaat wat een scanner nooit kan lezen.
Het grootste deel van de Lidl- en Aldi-schappen staat in de databank onder de eigen
merknaam van het product (milbona, k-classic, vitasia enzovoort); die merken worden
meegezocht en daarna aan de juiste keten gekoppeld.

Beide bestanden komen uit **Open Food Facts**, de open productendatabank, en zijn
beschikbaar onder de [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Naamsvermelding: *Open Food Facts-bijdragers*, https://world.openfoodfacts.org/.

## Waarom deze tabel

Huismerken van supermarkten staan lang niet allemaal in de databank, en de
databank is bij drukte traag of weigert verzoeken (status 429). Alles wat wél bekend is,
staat daarom in deze tabel: een scan wordt dan meteen herkend, ook zonder internet.

Is een huismerk nog onbekend, dan wijst de app aan de barcode-reeks de winkel aan
(bijvoorbeeld *Albert Heijn*) en onthoudt hij de naam die je zelf invult.

## Discogs-vinylcatalogus

De release-asset `discogs-vinyl-20261001.sqlite.gz` bevat een lokale, alleen-lezen zoekcatalogus uit de maandelijkse Discogs-release-dump van 1 oktober 2026. Discogs stelt zijn maandelijkse XML-dumps van release-, artiest-, label- en mastergegevens beschikbaar onder CC0 No Rights Reserved.[1] De voorwaarden onderscheiden CC0-catalogusgegevens — waaronder release-titels, formaten en barcodes — van restricted user-, marketplace- en beeldgegevens.[2] De CC0-deed staat kopiëren, aanpassen en verspreiden toe; we behouden daarnaast expliciet de bronvermelding.[3]

- **1.023.483** unieke koppelingen tussen een geldige vinylbarcode en een release-ID, met **799.740** verschillende geldige vinylbarcodes. Daarvan zijn **708.077** barcodes nieuw ten opzichte van de lokale MusicBrainz-barcodelijst; **91.663** kwamen in beide voor.
- Alleen GTIN-8/12/13/14 met geldig controlecijfer zijn opgenomen; identifiers die uitsluitend uit herhaalde identieke cijfers bestaan zijn als placeholders geweerd (5 codes, 20 releasekoppelingen).
- Eén barcode kan bij meerdere persingen horen: de database bewaart regels per barcode én release-ID. Een barcode-opzoeking kiest deterministisch één match; tekstzoekresultaten kunnen meerdere uitgaven tonen.
- Alleen metadata wordt opgenomen (barcode, release-ID, titel, artiest, jaar, label, formaat, genre en stijl). Er worden geen Discogs-hoesafbeeldingen, gebruikersgegevens of marketplacegegevens in de catalogus gezet; zoekresultaten veranderen de persoonlijke verzameling niet.
- De app toont **Discogs** als bron en linkt per resultaat naar de bijbehorende releasepagina. De SQLite-database staat als release-asset buiten de Git-boom; het Proxmox-helper-script controleert de SHA-256 en database vóór installatie.

## Opnieuw opbouwen

De lp-barcodelijst is gebaseerd op [MusicBrainz](https://musicbrainz.org/) (CC0 1.0; releasegegevens) en wordt door `scripts/fetch-platen.py` opgebouwd. Naamsvermelding: *MusicBrainz contributors*, https://musicbrainz.org/. De barcode `8717662593284` is door MusicBrainz foutief gekoppeld aan White Zombie; de gecorrigeerde vermelding *BBC Sessions 1970* — Elton John (2024, The Vinyl Champ) is gecontroleerd aan de hand van [Coda Records](https://codarecords.co.uk/products/elton-john-bbc-sessions-1970-limited-edition-clear-vinyl) en [Discogs](https://www.discogs.com/release/28592884-Elton-John-BBC-Sessions-1970). Het oogstscript past de handmatige correctie en aanvulling bij elke nieuwe export opnieuw toe; geen van beide regels wordt als MusicBrainz-data of CC0 geattribueerd. De aanvulling `0602445070718`, *Skunk* — Doe Maar (2022, Music On Vinyl), is gecontroleerd aan de hand van [Sounds.nl](https://www.sounds.nl/detail/4237720/lp/doe_maar/skunk), [Cede](https://www.cede.com/en/music/doe-maar-skunk-2022-reissue-music-on-vinyl-lp-17693999?articleGroupId=29) en [Discogs](https://www.discogs.com/release/22712903-Doe-Maar-Skunk). De hoesafbeeldingen worden niet in deze tabel opgeslagen; de app haalt hoezen eenmalig bij Cover Art Archive op en bewaart ze lokaal.

```bash
python3 scripts/fetch-platen.py --doorschrijven --met-zeven
```

De oogst werkt met onderverdeling op jaar, status, type en barcode-eindcijfers om binnen MusicBrainz' limiet per zoekvraag te blijven; voortgang staat onder `product-data/.voortgang/`.

De huismerktabel bouw je zo opnieuw op:

```bash
python3 scripts/fetch-huismerken.py
```

Het script haalt per supermarktmerk alle producten op uit Open Food Facts (ongeveer tien
zoekvragen per minuut, dus het duurt een tijdje), schrijft de twee bestanden en bewaart
de voortgang in `product-data/.voortgang/`, zodat een onderbroken run verdergaat waar hij
gebleven was. Ketens kiezen hun land met `--land nl|de|be`; de zoek-API gaat niet dieper
dan pagina 10 (1.000 producten), dus grote ketens worden opgedeeld op voedingswaarde
(`nutrition_grades_tags` a–e en `unknown`). Zit een deel alsnog aan dat plafond, dan staat
dat in de uitvoer — er wordt niets stilzwijgend weggelaten.

De winkeltabel wordt uit dezelfde gegevens afgeleid: een prefix komt er alleen in als er
minimaal acht producten mee gemoeid zijn en één winkel minstens 70 % daarvan bezit.

## Bronnen

1. [Discogs Data](https://data.discogs.com/) — maandelijkse XML-dumps en de CC0-licentie.
2. [Discogs API Terms of Use](https://support.discogs.com/hc/en-us/articles/360009334593-API-Terms-of-Use) — onderscheid tussen CC0-catalogusdata en restricted user-, marketplace- en beeldgegevens.
3. [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) — de voorwaarden voor hergebruik.
