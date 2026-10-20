# VoorraadThuis op Proxmox

VoorraadThuis is één app: voorraad, recepten, boodschappen, kalender én de garderobe (Kledingkast). Dit pakket installeert die app als een **unprivileged Debian LXC**, vergelijkbaar met BeatSync Studio. De app draait als systemd-service achter nginx; Docker is niet nodig. Standaard wordt DHCP gebruikt, met optioneel een vast IP. HTTPS wordt ingericht met een self-signed certificaat.

## Installeren vanaf GitHub met één commando

Voer op de Proxmox-host als `root` uit:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Theberas04/voorraadthuis/main/deploy/proxmox/install.sh)
```

Alleen bestanden ophalen en controleren, zonder een container te maken:

```bash
FETCH_ONLY=1 bash <(curl -fsSL https://raw.githubusercontent.com/Theberas04/voorraadthuis/main/deploy/proxmox/install.sh)
```

Gebruik `bash <(curl ...)`, niet `curl ... | bash`. Het installatiescript haalt de bestanden van GitHub op, controleert ze en roept daarna de LXC-provisioning aan.

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

`TEMPLATE_STORAGE` staat standaard op `local`; gebruik `ROOTFS_STORAGE=local` als je Proxmox geen `local-lvm` heeft. Overige variabelen: `CT_HOSTNAME`, `DNS_SERVER`, `CORES`, `MEMORY`, `SWAP`, `DISK`, `DEBIAN_MAJOR` (standaard 12), `TARGET_DIR`, `BRANCH`.

## Toegang en HTTPS

Na installatie toont het script de URL: `https://<LXC-IP>/`. HTTPS gebruikt een self-signed certificaat, dus accepteer de browserwaarschuwing eenmalig. Dit is nodig voor camera-scannen; sommige browsers vragen daarna alsnog om cameratoestemming. HTTP blijft ook beschikbaar op poort 80.

## Bijwerken

Haal de nieuwste appbestanden op en update de bestaande container zonder de SQLite-database te wissen:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Theberas04/voorraadthuis/main/deploy/proxmox/update-from-github.sh) 120
```

Vervang `120` door het CTID van je container. De updater downloadt eerst de bestanden en controleert daarna de app-healthcheck.

## Beheer en back-up

```bash
pct exec 120 -- systemctl status voorraadthuis
pct exec 120 -- journalctl -u voorraadthuis -f
pct exec 120 -- systemctl restart voorraadthuis
pct exec 120 -- systemctl status nginx
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
