# VoorraadThuis

Een lichte, Nederlandstalige voorraad-, recepten- en planningsapp voor thuis. Draait rechtstreeks als service in een Proxmox LXC; productdata staat in SQLite op persistente opslag.

## Functies
- Twee lijsten: **In huis** en **Niet meer in huis**.
- Product handmatig invoeren met naam, aantal, eenheid en optionele barcode.
- Barcode scannen met de camera (browser `BarcodeDetector`, vereist camera-toestemming en een beveiligde context) of handmatig invoeren.
- Markeer een product als op: het verhuist naar de afzonderlijke boodschappenlijst-knop.
- Voeg handmatig boodschappen toe of zet ingrediënten van een recept met één druk op de lijst; gelijke ingrediënten worden samengevoegd.
- Receptenboek met exact **1.000 recepten**: 115 Nederlandstalige, zelfgeschreven thuisvarianten uit 55 landen, aangevuld met 500 recepten uit UniTools World Recipes en 385 recepten uit Wikibooks Cookbook. De collectie is per land gegroepeerd waar de bron dat aangeeft; overige Wikibooks-gerechten staan onder **Internationaal**. Je kunt filteren op land en zoeken op gerecht of ingrediënt; ingrediënten gaan rechtstreeks naar de boodschappenlijst.
- De 885 geïmporteerde recepten zijn Engelstalig en tonen per recept de bron en CC BY-SA 4.0-licentie. Het is een groeiende, niet-uitputtende selectie; de inhoud is niet afkomstig van Albert Heijn of Picnic. Zie [`recipe-data/README.md`](recipe-data/README.md) voor bronvermelding, licenties en de reproduceerbare import.
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
CTID=120 STATIC_IP=192.168.1.50/24 GATEWAY=192.168.1.1 \\
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

## SMS
De SMS-knop gebruikt een `sms:`-link om de standaard berichten-app van je telefoon te openen. Afhankelijk van apparaat/browser verschilt ondersteuning en op sommige desktopcomputers werkt dit niet. Een externe SMS-gateway is niet geconfigureerd.
