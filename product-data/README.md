# Huismerken van Nederlandse supermarkten

Deze map bevat twee tabellen waarmee VoorraadThuis huismerken herkent:

| Bestand | Inhoud |
| --- | --- |
| `nl-huismerken.json` | Per barcode: naam, merk, hoeveelheid, categorie en de winkel waar het huismerk bij hoort. |
| `winkelprefixen.json` | Welke barcode-reeksen (GS1-prefixen) bij welke supermarkt horen. |

Beide bestanden komen uit **Open Food Facts**, de open productendatabank, en zijn
beschikbaar onder de [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Naamsvermelding: *Open Food Facts-bijdragers*, https://world.openfoodfacts.org/.

## Waarom deze tabel

Huismerken van Nederlandse supermarkten staan lang niet allemaal in de databank, en de
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
gebleven was.

De winkeltabel wordt uit dezelfde gegevens afgeleid: een prefix komt er alleen in als er
minimaal acht producten mee gemoeid zijn en één winkel minstens 70 % daarvan bezit.
