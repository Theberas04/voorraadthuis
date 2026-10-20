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

## Proxmox LXC installeren

De app draait als Node.js-service rechtstreeks in een **unprivileged Debian 12 LXC** (dus geen Docker-in-LXC nodig). De provisioningscript moet op de Proxmox-host als root draaien en maakt de container aan, installeert Node.js 22 en stelt een systemd-service in.

1. Zet een kopie van deze repository op de Proxmox-host in een map (bijvoorbeeld `/root/voorraadthuis`). Omdat deze GitHub-repository privé is, haal je die via een ingelogde GitHub-client op of upload je de bronbestanden zelf. De scripts kopiëren alleen `server.js`, `package.json` en `public/index.html` in de LXC.
2. Op de Proxmox-host:
   ```sh
   cd /root/voorraadthuis
   chmod +x scripts/create-lxc.sh
   scripts/create-lxc.sh /root/voorraadthuis 120
   ```
   Pas `120` aan als CTID al in gebruik is. Instelbare variabelen zijn `BRIDGE` (standaard `vmbr0`), `STORAGE` (standaard `local-lvm`), `TEMPLATE_STORAGE` (standaard `local`), `IP` (standaard DHCP), `GATEWAY`, `DNS`, `PORT`, `MEMORY`, `CORES` en `DISK`. Bijvoorbeeld `IP=192.168.1.50/24 GATEWAY=192.168.1.1 scripts/create-lxc.sh /root/voorraadthuis 120`.
3. Open de getoonde URL, standaard `http://<LXC-IP>:3000`.

Script vereist Proxmox VE-tools (`pct`, `pveam`) en netwerktoegang van de LXC naar Debian/NodeSource. De Debian 12 template wordt opgehaald indien nodig. De appdata staat persistent in `/var/lib/voorraadthuis/voorraad.db`; maak daarvan een back-up vanuit Proxmox. Beheer: `pct exec 120 -- systemctl status voorraadthuis`, `pct exec 120 -- systemctl restart voorraadthuis`.

### HTTPS voor camera-scannen
De browser vereist meestal HTTPS voor cameratoegang (localhost is uitzondering). Zet desgewenst een reverse proxy met TLS vóór poort 3000. Anders kun je de barcode handmatig invoeren. Stel de app niet onbeveiligd bloot aan internet: er is geen login/authenticatie ingebouwd en dit is bedoeld voor je vertrouwde LAN.

## Lokaal ontwikkelen/testen
Node.js 22.5+ is vereist (gebruikt ingebouwde `node:sqlite`, geen npm dependencies).
```sh
npm test
npm start
```
Open `http://localhost:3000`.

## SMS
De SMS-knop gebruikt een `sms:`-link om de standaard berichten-app van je telefoon te openen. Afhankelijk van apparaat/browser verschilt ondersteuning en op sommige desktopcomputers werkt dit niet. Een externe SMS-gateway is niet geconfigureerd.
