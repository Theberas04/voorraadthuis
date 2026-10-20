# VoorraadThuis

Een lichte, Nederlandstalige voorraad-app voor thuis. Draait zelfstandig op een Proxmox LXC/VM met Docker Compose; productdata staat in SQLite op een persistent volume.

## Functies
- Twee lijsten: **In huis** en **Niet meer in huis**.
- Product handmatig invoeren met naam, aantal, eenheid en optionele barcode.
- Barcode scannen met de camera (browser `BarcodeDetector`, vereist camera-toestemming en een beveiligde context) of handmatig invoeren.
- Markeer een product als op: het verhuist naar de boodschappenlijst.
- Herstel of verwijder boodschappen; stuur de lijst door via SMS.
- SMS opent de berichten-app met tekst ingevuld. Je controleert en verstuurt zelf; er is geen SMS-provider of betaalde API nodig.
- Data blijft bewaard in SQLite, ook na containerherstart.

> Barcodes worden opgeslagen, maar er is geen productcatalogus/lookup gekoppeld: scan een barcode en vul de productnaam zelf in. Camera-scannen werkt alleen in browsers die BarcodeDetector ondersteunen en doorgaans via HTTPS; handmatig scannen blijft beschikbaar.

## Snel starten (Proxmox)
Aanbevolen: Debian 12 LXC of VM met Docker Engine + Compose plugin. Maak de container privileged? **Nee**, een gewone unprivileged LXC volstaat wanneer nesting/keyctl voor Docker aan staan. Alternatief is Docker op een VM.

1. Clone de repository in de Debian guest:
   ```sh
   git clone https://github.com/Theberas04/voorraadthuis.git
   cd voorraadthuis
   ```
2. Start de app:
   ```sh
   docker compose up -d --build
   ```
3. Open `http://<IP-van-je-guest>:3000` op je thuisnetwerk.

Stel een ander poortnummer in met `APP_PORT=8080 docker compose up -d --build`. Gegevens staan in Docker volume `voorraadthuis_voorraad_data`; back-up bijvoorbeeld met `docker run --rm -v voorraadthuis_voorraad_data:/data -v "$PWD":/backup alpine tar czf /backup/voorraad-data.tar.gz -C /data .`.

### HTTPS voor camera-scannen
De browser vereist meestal HTTPS voor cameratoegang (localhost is uitzondering). Zet desgewenst een reverse proxy met TLS (bijv. Caddy/Nginx Proxy Manager) vóór poort 3000. Anders kun je de barcode handmatig invoeren. Stel de app niet onbeveiligd bloot aan internet: er is geen login/authenticatie ingebouwd en dit is bedoeld voor je vertrouwde LAN.

## Lokaal ontwikkelen/testen
Node.js 22.5+ is vereist (gebruikt ingebouwde `node:sqlite`, geen npm dependencies).
```sh
npm test
npm start
```
Open `http://localhost:3000`.

## SMS
De SMS-knop gebruikt een `sms:`-link om de standaard berichten-app van je telefoon te openen. Afhankelijk van apparaat/browser verschilt ondersteuning en op sommige desktopcomputers werkt dit niet. Een externe SMS-gateway is niet geconfigureerd.
