# Huismerken van Nederlandse, Duitse en Belgische supermarkten

Deze map bevat twee tabellen waarmee VoorraadThuis huismerken herkent:

| Bestand | Inhoud |
| --- | --- |
| `nl-huismerken.json` | Per barcode: naam, merk, hoeveelheid, categorie en de winkel waar het huismerk bij hoort. |
| `winkelprefixen.json` | Welke barcode-reeksen (GS1-prefixen) bij welke supermarkt horen. |

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

## Opnieuw opbouwen

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
