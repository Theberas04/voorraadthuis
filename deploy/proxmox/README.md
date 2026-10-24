# VoorraadThuis op Proxmox

VoorraadThuis is één app: voorraad, recepten, boodschappen, kalender én de garderobe (Kledingkast). Dit pakket installeert die app als een **unprivileged Debian LXC**, vergelijkbaar met BeatSync Studio. De app draait als systemd-service en **serveert HTTP op poort 80 en HTTPS op poort 443**; Docker en nginx zijn niet nodig. Standaard wordt DHCP gebruikt, met optioneel een vast IP.

## Installeren vanaf GitHub met één commando

Voer op de Proxmox-host als `root` uit:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Theberas04/voorraadthuis/main/deploy/proxmox/install.sh)
```

Alleen bestanden ophalen en controleren, zonder een container te maken:

```bash
FETCH_ONLY=1 bash <(curl -fsSL https://raw.githubusercontent.com/Theberas04/voorraadthuis/main/deploy/proxmox/install.sh)
```

Gebruik `bash <(curl ...)`, niet `curl ... | bash`. Het installatiescript haalt de bestanden van GitHub op, controleert ze en roept daarna de LXC-provisioning aan. Nieuwe containers worden op **Debian 13** gemaakt (`DEBIAN_MAJOR=12` voor een oude versie).

## Een bestaande container naar Debian 13 brengen

Draait je LXC nog op Debian 12, dan zet `upgrade-debian-13.sh` hem om naar Debian 13 (trixie); de app en de database blijven staan:

```bash
bash <(curl -fsSL -H 'Accept: application/vnd.github.raw' \
  https://api.github.com/repos/Theberas04/voorraadthuis/contents/deploy/proxmox/upgrade-debian-13.sh) 120
```

Eerst alleen kijken (er wordt niets geïnstalleerd of herstart):

```bash
DROOG=1 bash <(curl -fsSL -H 'Accept: application/vnd.github.raw' \
  https://api.github.com/repos/Theberas04/voorraadthuis/contents/deploy/proxmox/upgrade-debian-13.sh) 120
```

Het script maakt eerst een **momentopname** (`voor-debian13-<datum>`) en begint zonder die momentopname niet — dat is de enige echte terugweg. Daarna zet het een kopie van `voorraad.db` klaar in de container én op de host, werkt Debian 12 eerst helemaal bij, zet de pakketbronnen van `bookworm` naar `trixie` (bronnen zonder codenaam, zoals NodeSource, blijven staan), installeert Debian 13, start opnieuw op en controleert daarna de Node-versie (22.5+ voor `node:sqlite`, anders wordt Node 22 opnieuw gezet) en de app op poort 80 en 443. Lukt de app niet, dan komt de momentopname automatisch terug (uit te zetten met `GEEN_TERUG=1`). Noodluik zonder momentopname: `ZONDER_SNAPSHOT=1` — met waarschuwing.

Terugzetten kan altijd handmatig:

```bash
pct stop <CTID> && pct rollback <CTID> voor-debian13-<datum> && pct start <CTID>
```

## Netwerk en instellingen

Standaard gebruikt de container `vmbr0`, DHCP, 512 MB RAM, 1 core en een disk van 4 GB. Pas instellingen aan met environmentvariabelen:

```bash
CTID=120 BRIDGE=vmbr0 ROOTFS_STORAGE=local-lvm \
  bash <(curl -fsSL https://raw.githubusercontent.com/Theberas04/voorraadthuis/main/deploy/proxmox/install.sh)
```

Voor een vast IP:

```bash
CTID=120 STATIC_IP=192.168.1.50/24 GATEWAY=192.168.1.1 \
  bash <(curl -fsSL https://raw.githubusercontent.com/Theberas04/voorraadthuis/main/deploy/proxmox/install.sh)
```

`TEMPLATE_STORAGE` staat standaard op `local`; gebruik `ROOTFS_STORAGE=local` als je Proxmox geen `local-lvm` heeft. Overige variabelen: `CT_HOSTNAME`, `DNS_SERVER`, `CORES`, `MEMORY`, `SWAP`, `DISK`, `DEBIAN_MAJOR` (standaard 13), `TARGET_DIR`, `BRANCH`.

## Toegang

Na installatie toont het script de URL: `http://<LXC-IP>/`. De app luistert zelf op **HTTP/80 en HTTPS/443** (de app draait niet als root) en er is geen nginx of omgekeerde proxy nodig. De installatie maakt een zelfondertekend certificaat aan in `/etc/voorraadthuis/tls/`; open `https://<LXC-IP>/` voor camera- en PWA-toegang en accepteer de eenmalige certificaatwaarschuwing, of installeer het certificaat via `http://<LXC-IP>/certificaat.crt`. Zonder HTTPS blijft handmatige barcode-invoer beschikbaar.

## Bijwerken

Haal de nieuwste appbestanden op en update de bestaande container zonder de SQLite-database te wissen:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Theberas04/voorraadthuis/main/deploy/proxmox/update-from-github.sh) 120
```

Vervang `120` door het CTID van je container. De updater downloadt eerst de bestanden en controleert daarna `/healthz`, de pagina en de API's.

## Beheer en back-up

```bash
pct exec 120 -- systemctl status voorraadthuis
pct exec 120 -- journalctl -u voorraadthuis -f
pct exec 120 -- systemctl restart voorraadthuis
```

De voorraad staat in `/var/lib/voorraadthuis/voorraad.db` binnen de container. Neem een Proxmox-containerback-up of kopieer die database apart. De app heeft geen login en is bedoeld voor het vertrouwde thuisnetwerk; stel hem niet rechtstreeks bloot aan internet.

De garderobe zit in dezelfde database en gebruikt daarnaast de fotomap `/var/lib/voorraadthuis/fotos` (via `MEDIA_DIR`). Neem die map mee in je back-up, anders raak je de kledingfoto's kwijt. Kledingstukken zijn zelf in te vullen; AI-tagging van een foto is optioneel en werkt met een OpenAI-compatibele dienst:

```bash
pct exec 120 -- systemctl edit voorraadthuis   # voeg toe:
# [Service]
# Environment=AI_BASE_URL=http://192.168.1.10:11434/v1
# Environment=AI_VISION_MODEL=llava
# Environment=AI_API_KEY=...
pct exec 120 -- systemctl restart voorraadthuis
```

Zonder die instellingen blijft de knop om een foto te laten lezen verborgen en werkt de app volledig handmatig.
