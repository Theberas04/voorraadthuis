#!/usr/bin/env bash
# Maakt een unprivileged Debian LXC aan en richt VoorraadThuis daarin in.
# Standaard Debian 13; met DEBIAN_MAJOR=12 maak je nog een oude versie.
set -euo pipefail
CTID="${CTID:-}"
CT_HOSTNAME="${CT_HOSTNAME:-voorraadthuis}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
ROOTFS_STORAGE="${ROOTFS_STORAGE:-local-lvm}"
BRIDGE="${BRIDGE:-vmbr0}"
STATIC_IP="${STATIC_IP:-}"
GATEWAY="${GATEWAY:-}"
DNS_SERVER="${DNS_SERVER:-1.1.1.1}"
CORES="${CORES:-1}"
MEMORY="${MEMORY:-512}"
SWAP="${SWAP:-256}"
DISK="${DISK:-4}"
DEBIAN_MAJOR="${DEBIAN_MAJOR:-13}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
log(){ printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn(){ printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die(){ printf '\033[1;31m[fout]\033[0m %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "Draai dit als root op de Proxmox-host."
command -v pct >/dev/null || die "pct niet gevonden: dit is geen Proxmox VE-host."
command -v pveam >/dev/null || die "pveam niet gevonden."
for f in "$APP_DIR/server.js" "$APP_DIR/wardrobe.js" "$APP_DIR/package.json" "$APP_DIR/recipes-international.js" "$APP_DIR/recipes-open.js" "$APP_DIR/barcodes.js" "$APP_DIR/profiles.js" "$APP_DIR/recipe-data/unitools-recipes.json" "$APP_DIR/recipe-data/wikibooks-en-recipes.json" "$APP_DIR/recipe-data/wikibooks-es-recipes.json" "$APP_DIR/recipe-data/wikibooks-de-recipes.json" "$APP_DIR/recipe-data/wikibooks-nl-recipes.json" "$APP_DIR/recipe-data/wikibooks-fr-recipes.json" "$APP_DIR/recipe-data/wikibooks-it-recipes.json" "$APP_DIR/recipe-data/wikibooks-ca-recipes.json" "$APP_DIR/recipe-data/wikibooks-pt-recipes.json" "$APP_DIR/recipe-data/wikibooks-ja-recipes.json" "$APP_DIR/recipe-data/wikibooks-pl-recipes.json" "$APP_DIR/recipe-data/wikibooks-sv-recipes.json" "$APP_DIR/recipe-data/wikibooks-nb-recipes.json" "$APP_DIR/recipe-data/wikibooks-fi-recipes.json" "$APP_DIR/recipe-data/wikibooks-cocktails-recipes.json" "$APP_DIR/recipe-data/wikibooks-borrelhapjes-recipes.json" "$APP_DIR/recipe-data/translations-nl.json" "$APP_DIR/product-data/nl-huismerken.json" "$APP_DIR/product-data/winkelprefixen.json" "$APP_DIR/public/index.html" "$APP_DIR/public/barcode-scan.js" "$SCRIPT_DIR/provision-voorraadthuis.sh" "$SCRIPT_DIR/fetch-discogs-catalog.sh"; do [ -f "$f" ] || die "$f ontbreekt."; done
ip link show "$BRIDGE" >/dev/null 2>&1 || die "Bridge '$BRIDGE' bestaat niet."
if [ -n "$STATIC_IP" ]; then [ -n "$GATEWAY" ] || die "Geef GATEWAY op bij STATIC_IP."; NET0="name=eth0,bridge=$BRIDGE,ip=$STATIC_IP,gw=$GATEWAY,type=veth"; else NET0="name=eth0,bridge=$BRIDGE,ip=dhcp,type=veth"; fi
if [ -z "$CTID" ]; then CTID="$(pvesh get /cluster/nextid 2>/dev/null || true)"; fi
[ -n "$CTID" ] || die "Kon geen vrij CTID bepalen; geef CTID=... mee."
pct status "$CTID" >/dev/null 2>&1 && die "Container $CTID bestaat al."
log "Debian $DEBIAN_MAJOR-template zoeken…"
pveam update >/dev/null 2>&1 || warn "pveam update mislukte; lokale template-lijst wordt gebruikt."
TEMPLATE=$(pveam available --section system 2>/dev/null | awk '{print $NF}' | grep -E "^debian-${DEBIAN_MAJOR}-standard_.*\.tar" | sort -V | tail -1)
[ -n "$TEMPLATE" ] || die "Geen Debian $DEBIAN_MAJOR-template gevonden. Controleer pveam available --section system."
if ! pvesm list "$TEMPLATE_STORAGE" --content vztmpl 2>/dev/null | grep -q "$TEMPLATE"; then pveam download "$TEMPLATE_STORAGE" "$TEMPLATE" || die "Template downloaden mislukt."; fi
ARGS=("$CTID" "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE}" --hostname "$CT_HOSTNAME" --cores "$CORES" --memory "$MEMORY" --swap "$SWAP" --rootfs "${ROOTFS_STORAGE}:${DISK}" --net0 "$NET0" --nameserver "$DNS_SERVER" --unprivileged 1 --onboot 1 --ostype debian --description "VoorraadThuis — thuisvoorraad en boodschappen")
log "Container $CTID aanmaken (Debian $DEBIAN_MAJOR; ${STATIC_IP:-DHCP})…"
pct create "${ARGS[@]}"
pct start "$CTID" || die "Container startte niet; inspecteer pct config $CTID en journalctl."
ready=0
for _ in $(seq 1 60); do pct exec "$CTID" -- true >/dev/null 2>&1 && { ready=1; break; }; sleep 2; done
[ "$ready" = 1 ] || die "Container werd niet bereikbaar via pct exec."
"$SCRIPT_DIR/provision-voorraadthuis.sh" "$CTID" || die "Inrichten mislukte. Herstel met: $SCRIPT_DIR/provision-voorraadthuis.sh $CTID"
IP=$(pct exec "$CTID" -- ip -4 -o addr show dev eth0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1 || true)
[ -n "$IP" ] || IP="${STATIC_IP%%/*}"
cat <<EOF

VoorraadThuis is geïnstalleerd in LXC $CTID.
URL: http://${IP}/  (de app serveert de pagina zelf op poort 80; geen nginx, geen certificaat)
Beheer: pct exec $CTID -- systemctl status voorraadthuis
Database: pct exec $CTID -- ls -l /var/lib/voorraadthuis/voorraad.db
Bijwerken: bash <(curl -fsSL https://raw.githubusercontent.com/Theberas04/voorraadthuis/main/deploy/proxmox/update-from-github.sh) $CTID
EOF
