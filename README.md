# VoorraadThuis

![Hero: VoorraadThuis op de telefoon](docs/img/hero.png)

[![Node.js](https://img.shields.io/badge/Node.js-22.5%2B-5fa04e?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-node%3Atest-1f6848)](test/app.test.js)
[![Recepten](https://img.shields.io/badge/recepten-1.000-1f6848)](recipe-data/README.md)
[![Receptenbron](https://img.shields.io/badge/receptenbron-CC%20BY--SA%204.0-ef9421)](https://creativecommons.org/licenses/by-sa/4.0/)
[![PWA](https://img.shields.io/badge/PWA-installeerbaar-1f6848)](public/manifest.webmanifest)
[![Proxmox](https://img.shields.io/badge/Proxmox-LXC-e57000?logo=proxmox&logoColor=white)](deploy/proxmox/README.md)

Een lichte, Nederlandstalige voorraad-, recepten- en planningsapp voor thuis. Draait rechtstreeks als service in een Proxmox LXC; productdata staat in SQLite op persistente opslag. De webpagina is gebouwd voor de telefoon en werkt ook als installeerbare app.

## Op de telefoon

| Voorraad | Recepten | Boodschappen | Kalender |
| --- | --- | --- | --- |
| ![Voorraad op de telefoon](docs/img/mobiel-voorraad.jpg) | ![Recepten op de telefoon](docs/img/mobiel-recepten.jpg) | ![Boodschappenlijst op de telefoon](docs/img/mobiel-boodschappen.jpg) | ![Kalender op de telefoon](docs/img/mobiel-kalender.jpg) |

- Vier navigatieknoppen op één rij, ook op een scherm van 360 px breed.
- Invoervelden op 16 px, zodat iOS niet inzoomt bij het typen; knoppen en velden zijn minimaal 44 px hoog.
- Recepten worden in delen van 24 geladen met **Nog … recepten laden**, zodat de pagina ook met 1.000 recepten vlot blijft.
- Veilige marges voor toestellen met een inkeping (`viewport-fit=cover` en `env(safe-area-inset-bottom)`).

### Installeren als app (PWA)

Open de app op je telefoon en kies **Toevoegen aan startscherm** (iOS/Safari) of **App installeren** (Android/Chrome). De app opent dan zonder adresbalk en houdt de laatst geladen pagina bij tot de server bereikbaar is. Voor installatie en camera-scannen is een beveiligde verbinding (HTTPS) nodig; de Proxmox-installatie zet die zelf op.

<details>
<summary>Schermafbeeldingen op desktop</summary>

| Voorraad | Recepten | Boodschappen | Kalender |
| --- | --- | --- | --- |
| ![Voorraad op desktop](docs/img/desktop-voorraad.jpg) | ![Recepten op desktop](docs/img/desktop-recepten.jpg) | ![Boodschappenlijst op desktop](docs/img/desktop-boodschappen.jpg) | ![Kalender op desktop](docs/img/desktop-kalender.jpg) |

</details>

## Functies

- Twee lijsten: **In huis** en **Niet meer in huis**.
- Product handmatig invoeren met naam, aantal, eenheid en optionele barcode.
- Barcode scannen met de camera (browser `BarcodeDetector`, vereist camera-toestemming en een beveiligde context) of handmatig invoeren.
- Markeer een product als op: het verhuist naar de afzonderlijke boodschappenlijst-knop.
- Voeg handmatig boodschappen toe of zet ingrediënten van een recept met één druk op de lijst; gelijke ingrediënten worden samengevoegd.
- Receptenboek met exact **1.000 recepten**: 115 Nederlandstalige, zelfgeschreven thuisvarianten uit 55 landen, aangevuld met 500 recepten uit UniTools World Recipes en 385 recepten uit Wikibooks Cookbook. De collectie is per land gegroepeerd waar de bron dat aangeeft; overige Wikibooks-gerechten staan onder **Internationaal**. Je kunt filteren op land en zoeken op gerecht of ingrediënt; ingrediënten gaan rechtstreeks naar de boodschappenlijst.
- De 885 geïmporteerde recepten tonen per recept de bron en CC BY-SA 4.0-licentie. Het is een groeiende, niet-uitputtende selectie; de inhoud is niet afkomstig van Albert Heijn of Picnic. Zie [`recipe-data/README.md`](recipe-data/README.md) voor bronvermelding, licenties en de reproduceerbare import.
- De 115 eigen thuisvarianten zijn geen volledige inventaris van alle gerechten uit de genoemde landen; traditionele bereidingswijzen kunnen per regio en huishouden verschillen.
- Maandkalender om per dag een recept en landkeuken te plannen, plus meerdere benoemde diensten met start-/eindtijden in 24-uursnotatie. Sla diensten op als herbruikbare sjablonen en zet ze met één druk op een gekozen dag; de dagplanning en diensten blijven bewaard in SQLite.
- Herstel of verwijder boodschappen; stuur de lijst door via SMS.
- SMS opent de berichten-app met tekst ingevuld. Je controleert en verstuurt zelf; er is geen SMS-provider of betaalde API nodig.
- Data blijft bewaard in SQLite, ook na containerherstart.

> Barcodes worden opgeslagen, maar er is geen productcatalogus/lookup gekoppeld: scan een barcode en vul de productnaam zelf in. Camera-scannen werkt alleen in browsers die BarcodeDetector ondersteunen en doorgaans via HTTPS; handmatig scannen blijft beschikbaar.

## Proxmox LXC installeren (zoals BeatSync)

VoorraadThuis installeer je op dezelfde manier als BeatSync: voer op de Proxmox-host als root uit:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Theberas04/voorraadthuis/main/deploy/proxmox/install.sh)
```

Het script haalt de installerbestanden rechtstreeks van GitHub, maakt een Debian 12 LXC aan, zet nginx + HTTPS op en start de app als systemd-service. `FETCH_ONLY=1` haalt de bestanden op en controleert ze zonder een container te maken.

Standaard gebruikt de LXC `vmbr0` en DHCP. Vast IP kan bijvoorbeeld zo:
```bash
CTID=120 STATIC_IP=192.168.1.50/24 GATEWAY=192.168.1.1 \
  bash <(curl -fsSL https://raw.githubusercontent.com/Theberas04/voorraadthuis/main/deploy/proxmox/install.sh)
```
Na afloop opent de app op `https://<LXC-IP>/` (self-signed certificaat: accepteer de waarschuwing). Bijwerken zonder je gegevens te wissen:
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Theberas04/voorraadthuis/main/deploy/proxmox/update-from-github.sh) 120
```
Vervang `120` door je CTID. Database: `/var/lib/voorraadthuis/voorraad.db` in de LXC. De app heeft geen login en is bedoeld voor het vertrouwde LAN; stel hem niet rechtstreeks bloot aan internet.

Meer Proxmox-instellingen, beheercommando's en back-upinstructies staan in [`deploy/proxmox/README.md`](deploy/proxmox/README.md).

## Lokaal ontwikkelen/testen

Node.js 22.5+ is vereist (gebruikt ingebouwde `node:sqlite`, geen npm dependencies).

```sh
npm test
npm start
```

Open `http://localhost:3000`.

## Projectstructuur

| Pad | Inhoud |
| --- | --- |
| `server.js` | HTTP-server, SQLite-schema, API en de gecombineerde receptenlijst. |
| `public/index.html` | De hele webpagina: opmaak, mobiele indeling en app-logica. |
| `public/manifest.webmanifest`, `public/sw.js`, `public/favicon.svg`, `public/icon-*.png` | Pictogrammen en webapp-manifest voor installatie op de telefoon. |
| `recipes-international.js` | 110 eigen Nederlandstalige thuisvarianten. |
| `recipes-open.js` | Normalisatie van de 885 geïmporteerde recepten met bron en licentie. |
| `recipe-data/` | Brondata, gepinde revisies en bronvermelding van de datasets. |
| `docs/img/` | Beeldmateriaal voor deze README en de deelkaart. |
| `deploy/proxmox/` | Installer, updater en nginx-configuratie voor de LXC. |

## SMS

De SMS-knop gebruikt een `sms:`-link om de standaard berichten-app van je telefoon te openen. Afhankelijk van apparaat/browser verschilt ondersteuning en op sommige desktopcomputers werkt dit niet. Een externe SMS-gateway is niet geconfigureerd.