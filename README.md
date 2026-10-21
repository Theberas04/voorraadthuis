# VoorraadThuis

![Hero: VoorraadThuis op de telefoon](docs/img/hero.png)

[![Node.js](https://img.shields.io/badge/Node.js-22.5%2B-5fa04e?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-node%3Atest-1f6848)](test/app.test.js)
[![Recepten](https://img.shields.io/badge/recepten-9.550-1f6848)](recipe-data/README.md)
[![Taal](https://img.shields.io/badge/taal-Nederlands-1f6848)](recipe-data/README.md)
[![Receptenbron](https://img.shields.io/badge/receptenbron-CC%20BY--SA%204.0-ef9421)](https://creativecommons.org/licenses/by-sa/4.0/)
[![Kledingkast](https://img.shields.io/badge/kledingkast-garderobe-2a6f7f)](wardrobe.js)
[![Barcodeherkenning](https://img.shields.io/badge/barcode-herkenning-2a6f7f)](barcodes.js)
[![PWA](https://img.shields.io/badge/PWA-installeerbaar-1f6848)](public/manifest.webmanifest)
[![Proxmox](https://img.shields.io/badge/Proxmox-LXC-e57000?logo=proxmox&logoColor=white)](deploy/proxmox/README.md)

Eén Nederlandstalige app voor thuis: voorraad, 9.550 recepten in het Nederlands, boodschappenlijst, maaltijd- en werkplanning én je garderobe met combineeradvies. Alles draait rechtstreeks als service in een Proxmox LXC, met de gegevens in SQLite op persistente opslag. De webpagina is gebouwd voor de telefoon en werkt ook als installeerbare app. Een gescande barcode wordt meteen herkend via Open Food Facts.

🎬 **[Rondleiding door de app (106 s, MP4, 1280×720, Nederlandse voice-over)](docs/img/voorraadthuis-rondleiding.mp4)** — voorraad, boodschappenlijst, receptenboek, kledingkasten, was, combineeradvies, kalender met werkrooster en de profielen met sms-kanaal in één doorloop, met uitleg per scherm.

## Op de telefoon

| Voorraad | Recepten | Kleding | Kalender |
| --- | --- | --- | --- |
| ![Voorraad op de telefoon](docs/img/mobiel-voorraad.jpg) | ![Recepten op de telefoon](docs/img/mobiel-recepten.jpg) | ![Kledingkast op de telefoon](docs/img/mobiel-kast.jpg) | ![Kalender op de telefoon](docs/img/mobiel-kalender.jpg) |

| Combineeradvies | Was | Analyse | Boodschappen |
| --- | --- | --- | --- |
| ![Combineeradvies op de telefoon](docs/img/mobiel-kast-vandaag.jpg) | ![Was op de telefoon](docs/img/mobiel-kast-was.jpg) | ![Analyse op de telefoon](docs/img/mobiel-kast-analyse.jpg) | ![Boodschappenlijst op de telefoon](docs/img/mobiel-boodschappen.jpg) |

- Vijf navigatieknoppen op één rij, ook op een scherm van 360 px breed (op smalle schermen heet de lijstknop **Lijst**).
- Invoervelden op 16 px, zodat iOS niet inzoomt bij het typen; knoppen en velden zijn minimaal 44 px hoog.
- Recepten komen in delen van 48 van de server, met **Nog … recepten laden**; zoeken en filteren gebeurt op de server en ingrediënten worden pas bij het openklappen opgehaald, zodat de pagina ook met 9.550 recepten vlot blijft.
- Veilige marges voor toestellen met een inkeping (`viewport-fit=cover` en `env(safe-area-inset-bottom)`).

### Installeren als app (PWA)

Open de app op je telefoon en kies **Toevoegen aan startscherm** (iOS/Safari) of **App installeren** (Android/Chrome). De app opent dan zonder adresbalk en houdt de laatst geladen pagina bij tot de server bereikbaar is. De app draait in je eigen netwerk op een gewoon `http`-adres. Een barcode intypen werkt daar meteen; de camera gebruiken (barcode scannen of een kledingfoto maken) blokkeren browsers op een onbeveiligde verbinding — daarvoor is `https` nodig, bijvoorbeeld via een omgekeerde proxy met een certificaat.

<details>
<summary>Schermafbeeldingen op desktop</summary>

| Voorraad | Recepten | Kleding | Combineeradvies |
| --- | --- | --- | --- |
| ![Voorraad op desktop](docs/img/desktop-voorraad.jpg) | ![Recepten op desktop](docs/img/desktop-recepten.jpg) | ![Kledingkast op desktop](docs/img/desktop-kast-kaarten.jpg) | ![Combineeradvies op desktop](docs/img/desktop-kast-vandaag.jpg) |

| Boodschappen | Kalender | Was | Analyse |
| --- | --- | --- | --- |
| ![Boodschappenlijst op desktop](docs/img/desktop-boodschappen.jpg) | ![Kalender op desktop](docs/img/desktop-kalender.jpg) | ![Was op desktop](docs/img/desktop-kast-was.jpg) | ![Analyse op desktop](docs/img/desktop-kast-analyse.jpg) |

</details>

## Wat de app doet

### Voorraad en boodschappen

| Barcode herkend | Op de telefoon |
| --- | --- |
| ![Barcodeherkenning op de telefoon](docs/img/mobiel-barcode.jpg) | ![Product toevoegen op mobiel](docs/img/mobiel-voorraad.jpg) |

- Twee lijsten: **In huis** en **Niet meer in huis**.
- Product handmatig invoeren met naam, aantal, eenheid en optionele barcode.
- Barcode scannen met de camera (browser `BarcodeDetector`, vereist camera-toestemming en een beveiligde context) of handmatig invoeren.
- **Barcodeherkenning**: zodra er een volledige code staat (gescand of getypt) zoekt de app het product op in [Open Food Facts](https://world.openfoodfacts.org/) (open data, ODbL 1.0) en vult naam, hoeveelheid en eenheid vast in — bijvoorbeeld `5449000000996` → *Coca-Cola Original · 330 ml*. Wat je zelf invult blijft leidend.
- De uitkomst wordt lokaal bewaard, dus een tweede scan van hetzelfde product werkt zonder internet; een zelf ingevoerd product wordt bij die code onthouden. Met **Opnieuw zoeken** ververs je de gegevens.
- Een code met een verkeerd controlecijfer wordt gemeld, maar je kunt hem alsnog opzoeken.
- Markeer een product als op: het verhuist naar de afzonderlijke boodschappenlijst-knop.
- Voeg handmatig boodschappen toe of zet ingrediënten van een recept met één druk op de lijst; gelijke ingrediënten worden samengevoegd.
- Herstel of verwijder boodschappen; stuur de lijst per sms naar het nummer van een profiel.

### Receptenboek

- **9.550 recepten**: 115 Nederlandstalige, zelfgeschreven thuisvarianten uit 55 landen, aangevuld met **9.435 recepten uit veertien open bronnen** — het Wikibooks-kookboek in het Engels (3.393), Spaans (664), Duits (407), Nederlands (450), Frans (986), Italiaans (583), Catalaans (673), Portugees (237), Japans (276), Pools (863), Zweeds (313), Noors (79) en Fins (11), plus 500 recepten uit UniTools World Recipes. De 450 Nederlandse kookboekrecepten zijn al Nederlands en hebben dus geen vertaling nodig. De collectie is per land gegroepeerd waar de bron dat aangeeft; overige gerechten staan onder **Internationaal**. Je kunt filteren op land en zoeken op gerecht of ingrediënt; ingrediënten gaan rechtstreeks naar de boodschappenlijst.
- Alle 8.985 buitenlandse geïmporteerde recepten zijn naar het Nederlands vertaald: naam, omschrijving, ingrediënten en bereidingsstappen. Hoeveelheden, eenheden, bereidingstijden en porties blijven exact zoals de bron ze geeft, en id, bron-URL en licentie blijven ongewijzigd — een recept in de app verwijst dus nog steeds naar zijn origineel. Zulke recepten dragen het label **Vertaald** en bij de bronvermelding staat uit welke taal ze komen (Engels, Spaans, Duits, Frans, Italiaans, Catalaans, Portugees, Japans, Pools, Zweeds, Noors of Fins). De 450 recepten uit het Nederlandse Wikibooks-kookboek zijn van zichzelf al Nederlands en houden dus geen vertaallabel. De app weigert te starten zolang één vertaling ontbreekt.
- **Snel, ook met 9.550 recepten**: de lijst komt in stukjes van 48 van de server (gecomprimeerd), zoeken en filteren gebeurt op de server, en ingrediënten en bereiding worden pas opgehaald als je een recept openklapt. Zonder die aanpak stuurde elke paginaweergave bijna 20 MB aan receptgegevens naar de browser.
- Alle 9.435 geïmporteerde recepten tonen per recept de bron en CC BY-SA 4.0-licentie. Het is een groeiende, niet-uitputtende selectie; de inhoud is niet afkomstig van Albert Heijn of Picnic. Zie [`recipe-data/README.md`](recipe-data/README.md) voor bronvermelding, licenties, de reproduceerbare import en de vertaalmethode.
- De 115 eigen thuisvarianten zijn geen volledige inventaris van alle gerechten uit de genoemde landen; traditionele bereidingswijzen kunnen per regio en huishouden verschillen.

| ![Receptenboek op desktop](docs/img/receptenboek-desktop.png) | ![Receptenboek op de telefoon](docs/img/receptenboek-mobiel.jpg) |
| --- | --- |
| Het receptenboek met 9.550 recepten, filters en bronvermelding per recept. | Dezelfde tab op de telefoon; recepten komen per land binnen. |

### Kalender en werkrooster

- Maandkalender om per dag een recept en landkeuken te plannen.
- Meerdere benoemde diensten per dag met start- en eindtijd in 24-uursnotatie; `1930` wordt `19:30`.
- Sla diensten op als herbruikbare sjablonen en zet ze met één druk op een gekozen dag. Dagplanning, diensten en sjablonen blijven bewaard in SQLite.

### Kleding (Kledingkast)

| Kast | Vandaag | Was | Analyse |
| --- | --- | --- | --- |
| ![Mijn kast](docs/img/mobiel-kast-kaarten.jpg) | ![Vandaag](docs/img/mobiel-kast-vandaag.jpg) | ![Was](docs/img/mobiel-kast-was.jpg) | ![Analyse](docs/img/mobiel-kast-analyse.jpg) |

| Meerdere kasten op desktop | Meerdere kasten op de telefoon |
| --- | --- |
| ![Kasten op desktop](docs/img/kledingkasten-desktop.png) | ![Kasten op de telefoon](docs/img/kledingkasten-mobiel.jpg) |

- **Meerdere kledingkasten**: naast elkaar bijvoorbeeld *Thuis* en *Mama*. Elk kledingstuk hoort bij één kast; met het kastfilter zie je alleen die kast, en op elke kaart staat bij welke kast het stuk hoort. In **Kasten beheren** maak je een kast, hernoem je hem of verwijder je hem — kleding verhuist dan in één stap naar een andere kast. Bestaande kasten uit een oudere versie komen automatisch in de eerste kast (*Thuis*) terecht.
- Kledingstukken met naam, categorie, kleur (met kleurcode), patroon, maat, merk, materiaal, seizoenen, gelegenheden, prijs, notities en een foto. Filter op categorie, status of kast en zoek op naam, merk, kleur of notitie.
- Status per stuk: **schoon**, **vies**, **in de was** of **reparatie**, met tellers in de navigatie.
- **Vandaag** geeft een combineeradvies voor de gekozen dag en gelegenheid, met de beweegredenen erbij. Met één knop registreer je het als gedragen (het stuk gaat dan op vies) of bewaar je het als setje.
- **Was**: vies kleding bij elkaar vinken, een was starten met programma en datum, en met **Was klaar** staat alles weer op schoon. Een was annuleren zet de kleding terug op vies.
- **Setjes**: vaste combinaties bewaren en in één tik opnieuw dragen; ze verschijnen ook in de draaghistorie.
- **Analyse**: aantal per categorie, kleurverdeling, meest en nooit gedragen, te wassen, prijs per keer dragen en de totale waarde van je kast. Daarnaast een maandkalender met wat je per dag droeg.
- Foto's maak je met de camera-knop in het formulier of kies je uit je album; ze worden opgeslagen in een aparte fotomap.

#### Hoe het combineeradvies werkt

Het advies komt uit eigen, uitlegbare regels — geen taalmodel en geen internetverbinding nodig:

1. Alleen kledingstukken met status **schoon** komen in aanmerking.
2. Per gelegenheid hoort een vaste opbouw: werk vraagt bijvoorbeeld om bovenkleding of een jurk met een broek of rok, schoenen en in het koude seizoen een jas.
3. Seizoenen en gelegenheden die je per stuk hebt aangegeven wegen mee; kleding die daar niet bij past valt af.
4. Kleurharmonie: rustige basiskleuren mogen overal bij, één accentkleur is prima, twee verwante tinten mogen, twee felle kleuren krijgen straf.
5. Wat je de laatste drie dagen droeg krijgt straf, zodat je niet steeds hetzelfde advies krijgt; zelden gedragen kleding krijgt een kleine voorkeur.

Elke uitkomst toont de gebruikte argumenten. Met **Nieuw advies** vraag je een volgende goede combinatie op.

#### AI-tagging (optioneel, standaard uit)

Met een OpenAI-compatibele dienst (OpenAI, Ollama, LocalAI) kan de app een kledingfoto zelf lezen en naam, categorie, kleur, patroon, materiaal en seizoen invullen. Zet daarvoor `AI_BASE_URL`, `AI_API_KEY` en `AI_VISION_MODEL`; zonder die instellingen blijft de knop om een foto te lezen verborgen en werkt de app volledig handmatig. Wat je zelf invult is altijd leidend.

*Barcodeherkenning*: `GET /api/barcode/<code>` (met `?force=1` om bestaande gegevens te verversen). Zonder internet (`BARCODE_OFFLINE=1`) gebruikt de app alleen wat al bekend is; met `BARCODE_API` wijs je een andere productendatabank aan.

> Productgegevens komen van [Open Food Facts](https://world.openfoodfacts.org/), beschikbaar onder de [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Camera-scannen werkt in browsers die `BarcodeDetector` ondersteunen (Chrome op Android, Edge) en doorgaans alleen via HTTPS; op iOS typ je de code — die wordt ook meteen herkend.

## Proxmox LXC installeren (zoals BeatSync)

VoorraadThuis installeer je op dezelfde manier als BeatSync: voer op de Proxmox-host als root uit:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Theberas04/voorraadthuis/main/deploy/proxmox/install.sh)
```

Het script haalt de installerbestanden rechtstreeks van GitHub, maakt een Debian 12 LXC aan en start de app als systemd-service. **De app serveert de pagina zelf op poort 80** — er zit geen nginx en geen certificaat tussen, zodat er ook niets meer mis kan gaan met een verkeerde webroot. `FETCH_ONLY=1` haalt de bestanden op en controleert ze zonder een container te maken.

Standaard gebruikt de LXC `vmbr0` en DHCP. Vast IP kan bijvoorbeeld zo:
```bash
CTID=120 STATIC_IP=192.168.1.50/24 GATEWAY=192.168.1.1 \
  bash <(curl -fsSL https://raw.githubusercontent.com/Theberas04/voorraadthuis/main/deploy/proxmox/install.sh)
```
Na afloop opent de app op `http://<LXC-IP>/`. Bijwerken zonder je gegevens te wissen:
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Theberas04/voorraadthuis/main/deploy/proxmox/update-from-github.sh) 120
```
Vervang `120` door je CTID. De app heeft geen login en is bedoeld voor het vertrouwde LAN; stel hem niet rechtstreeks bloot aan internet.

Meer Proxmox-instellingen, beheercommando's en back-upinstructies staan in [`deploy/proxmox/README.md`](deploy/proxmox/README.md).

## Waar je gegevens staan

| Pad in de LXC | Inhoud |
| --- | --- |
| `/var/lib/voorraadthuis/voorraad.db` | Voorraad, boodschappen, planning, werkdiensten, kleding, wasbeurten en draaghistorie (SQLite). |
| `/var/lib/voorraadthuis/fotos/` | De geüploade kledingfoto's, één bestand per kledingstuk. |

Neem beide mee in je back-up. Lokaal staan ze standaard in `data/`.

## Lokaal ontwikkelen/testen

Node.js 22.5+ is vereist (gebruikt de ingebouwde `node:sqlite`; er zijn geen npm-dependencies).

```sh
npm test     # 68 tests: voorraad, boodschappen, recepten, vertaling, planning, garderobe en kledingkasten
npm start    # http://localhost:3000
```

## Projectstructuur

| Pad | Inhoud |
| --- | --- |
| `server.js` | HTTP-server, SQLite-schema, API en de gecombineerde receptenlijst; verwijst de garderoberoutes door. |
| `wardrobe.js` | Het garderobe-onderdeel (Kledingkast): kledingkasten, kleding, was, setjes, draaghistorie en de adviesregels. |
| `public/index.html` | De hele webpagina: opmaak, mobiele indeling en app-logica van alle tabs. |
| `public/manifest.webmanifest`, `public/sw.js`, `public/favicon.svg`, `public/icon-*.png` | Pictogrammen en webapp-manifest voor installatie op de telefoon. |
| `recipes-international.js` | 110 eigen Nederlandstalige thuisvarianten. |
| `recipes-open.js` | Normalisatie én Nederlandse vertaling van de 9.435 geïmporteerde recepten, met bron en licentie. |
| `recipe-data/` | Brondata, gepinde revisies, bronvermelding en de Nederlandse vertaling (`translations-nl.json`). |
| `scripts/build-open-recipe-data.py` | Reproduceerbare import van de gelicentieerde datasets. |
| `scripts/merge-recipe-translations.py` | Controleert de vertaalblokken en bundelt ze tot `recipe-data/translations-nl.json`. |
| `test/app.test.js`, `test/wardrobe.test.js` | Tests voor de app en voor de garderobe. |
| `docs/img/` | Beeldmateriaal voor deze README en de deelkaart. |
| `deploy/proxmox/` | Installer en updater voor de LXC (de app luistert zelf op poort 80). |

## API in het kort

| Route | Doet |
| --- | --- |
| `GET/POST /api/products`, `PATCH/DELETE /api/products/<id>` | Voorraad lezen, toevoegen, op/herstel en verwijderen. |
| `GET /api/shopping`, `POST /api/shopping`, `POST /api/shopping/recipes/<id>` | Boodschappenlijst en ingrediënten van een recept toevoegen. |
| `GET /api/recipes?country=` | De receptencollectie, optioneel per land. |
| `GET/PUT/DELETE /api/planner/<datum>`, `GET /api/planner?month=` | Dagplanning met recept, landkeuken en diensten. |
| `GET/POST/DELETE /api/shift-templates` | Herbruikbare diensten. |
| `GET /api/kast/config` | Categorieën, statussen, seizoenen, gelegenheden en of AI-tagging aanstaat. |
| `GET/POST /api/kast/items`, `GET/PATCH/DELETE /api/kast/items/<id>` | Kledingstukken; `PATCH` met `action: analyze`, `wear` of een status. `GET ?wardrobe=<id>` of `?wardrobe=alle` filtert op kast. |
| `GET/POST /api/kast/wardrobes`, `PATCH/DELETE /api/kast/wardrobes/<id>` | Kledingkasten: aanmaken, hernoemen en verwijderen; `DELETE ?moveTo=<id>` verplaatst de kledingstukken eerst. |
| `POST /api/kast/photos`, `GET /media/<bestand>` | Kledingfoto uploaden (JPEG, PNG of WebP) en terugkrijgen. |
| `GET /api/kast/suggest?occasion=&date=&seed=` | Combineeradvies met beweegredenen. |
| `GET/POST /api/kast/wear`, `DELETE /api/kast/wear/<id>` | Dragen registreren, historie per maand en een registratie wissen. |
| `GET/POST /api/kast/washes`, `PATCH/DELETE /api/kast/washes/<id>` | Wasbeurten plannen, afronden of annuleren. |
| `GET/POST /api/kast/outfits`, `DELETE /api/kast/outfits/<id>` | Setjes bewaren en verwijderen. |
| `GET /api/kast/analytics` | Totalen, kleurverdeling, meest en nooit gedragen, prijs per dracht. |

## Herkomst en licentie

De app is geschreven voor Tom Werdens. De receptendata uit UniTools World Recipes en Wikibooks Cookbook vallen onder [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/); per recept staat de bron- en licentielink in de kaart (zie [`recipe-data/README.md`](recipe-data/README.md)).

Het garderobe-onderdeel begon als een zelfstandige app (Kledingkast, MIT) en is geïnspireerd op het idee achter [wardrowbee](https://github.com/Anyesh/wardrowbee) (MIT): een self-hosted garderobe-app met AI-tagging. De implementatie is eigen werk — Node.js + SQLite in plaats van FastAPI + PostgreSQL + Redis, één service, Nederlandse interface, en combineeradvies op eigen regels in plaats van een taalmodel. Er is geen code uit dat project overgenomen.

## Profielen en SMS

In de tab **Profielen** zet je de huisgenoten neer met hun gegevens: naam, telefoonnummer, e-mail, rol en een notitie. Telefoonnummers worden in internationale notatie opgeslagen, dus `06 12345678` en `+31 6 12345678` komen op hetzelfde nummer uit. Eén profiel kan de standaardontvanger zijn; dat nummer staat dan vooraan in de keuzelijst op de boodschappenlijst (andere profielen met een nummer blijven kiesbaar).

De knop **Verstuur via SMS** op de boodschappenlijst stuurt de hele lijst naar het nummer van het gekozen profiel. Er zijn vier kanalen:

- **Berichten-app op dit apparaat** (standaard) — de knop opent je berichten-app met het nummer en de lijst al ingevuld. Werkt direct, zonder instellingen; het versturen zelf doe je daar.
- **Eigen gateway of webhook** — de server stuurt `{to, from, body}` als JSON naar jouw URL, met een optioneel token als `Authorization: *** Werkt met onder andere Home Assistant, een eigen SMS-dienst of een provider met een HTTP-API.
- **CheapConnect** — de server verstuurt de sms zelf via de SMS-API van CheapConnect (Nederlandse aanbieder, ongeveer € 0,07 per sms). Zie hieronder.
- **Twilio** — vul je Account SID, Auth Token en Twilio-afzendernummer in; de app verstuurt de sms zelf.

Inloggegevens vul je zelf in de app in. Ze worden lokaal in de database bewaard, nooit aan de pagina teruggegeven (je ziet alleen of ze gevuld zijn en de laatste vier tekens) en nooit naar de logboeken geschreven. Met **Wachtwoorden wissen** haal je ze weer weg. Via **Stuur proefbericht** test je het kanaal; de laatste twintig berichten staan in het lokale logboek onderaan de tab.

### CheapConnect instellen

1. Maak in het klantenpaneel ([account.cheapconnect.net](https://account.cheapconnect.net/)) onder **API** een API-sleutel aan.
2. Kies bij **Sms-kanaal** voor *CheapConnect*, vul de sleutel in en vul een **afzender** in: je eigen nummer (bijvoorbeeld `06 12345678`) of maximaal 11 letters (bijvoorbeeld `VoorraadTh`).
3. Klik op **Kanaal opslaan** en daarna op **Stuur proefbericht**.

De app roept `https://account.cheapconnect.net/API/v1/sms/SendSMS` aan met `apikey`, `from`, `to` en `msg`; nummers gaan zonder plusteken (`31612345678`). Een weigering van CheapConnect (bijvoorbeeld `2021: No access to this client`) wordt als Nederlandse foutmelding getoond en in het logboek gezet, met de API-sleutel eruit gefilterd.

| ![CheapConnect als sms-kanaal op desktop](docs/img/sms-cheapconnect-desktop.png) | ![CheapConnect als sms-kanaal op de telefoon](docs/img/sms-cheapconnect-mobiel.jpg) |
| --- | --- |
| Het kanaal CheapConnect met API-sleutel (alleen de laatste vier tekens zichtbaar) en afzender. | Dezelfde instellingen op de telefoon. |

| ![Profielen op desktop](docs/img/profielen-desktop.png) | ![Profielen op de telefoon](docs/img/profielen-mobiel.jpg) |
| --- | --- |
| Profielen met telefoonnummer, standaardontvanger en het sms-kanaal. | Dezelfde tab op de telefoon; hier opent de knop je berichten-app. |

| ![Boodschappen met ontvangerkeuze op desktop](docs/img/boodschappen-sms-desktop.png) | ![Boodschappen met ontvangerkeuze op de telefoon](docs/img/boodschappen-sms-mobiel.jpg) |
| --- | --- |
| De boodschappenlijst met de ontvangerkeuze naast de sms-knop. | Op de telefoon opent de knop de berichten-app met nummer en lijst ingevuld. |


Zonder eigen kanaal werkt de knop dus altijd, maar op een desktopcomputer gebeurt er niets: daar is geen berichten-app om te openen. Wil je vanaf elke machine echt versturen, kies dan een gateway of Twilio.
