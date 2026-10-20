#!/usr/bin/env bash
# Werkt VoorraadThuis bij in een bestaande Proxmox LXC; SQLite-data blijft staan.
# bash <(curl -fsSL https://raw.githubusercontent.com/Theberas04/voorraadthuis/main/deploy/proxmox/update-from-github.sh) <CTID>
set -euo pipefail
CTID="${1:-${CTID:-}}"
REPO="${REPO:-Theberas04/voorraadthuis}"
BRANCH="${BRANCH:-main}"
RAW="https://raw.githubusercontent.com/${REPO}/${BRANCH}"
[ "$(id -u)" -eq 0 ] || { echo 'Draai als root op de Proxmox-host.' >&2; exit 1; }
command -v pct >/dev/null || { echo 'pct niet gevonden.' >&2; exit 1; }
[ -n "$CTID" ] || { echo "Gebruik: $0 <CTID>" >&2; exit 2; }
pct status "$CTID" >/dev/null 2>&1 || { echo "Container $CTID bestaat niet." >&2; exit 1; }
[ "$(pct status "$CTID")" = 'status: running' ] || { echo "Container $CTID draait niet." >&2; exit 1; }
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
FILES=(server.js package.json public/index.html deploy/proxmox/nginx-voorraadthuis.conf)
for f in "${FILES[@]}"; do mkdir -p "$TMP/$(dirname "$f")"; curl -fsSL --retry 3 --max-time 60 "$RAW/$f?cb=$(date +%s)" -o "$TMP/$f" || { echo "Download mislukt: $f" >&2; exit 1; }; done
grep -q 'VoorraadThuis' "$TMP/public/index.html" || { echo 'Gedownloade pagina niet herkend; niets gewijzigd.' >&2; exit 1; }
SITE=/var/www/voorraadthuis
pct exec "$CTID" -- systemctl stop voorraadthuis
for f in server.js package.json public/index.html; do pct push "$CTID" "$TMP/$f" "$SITE/$f" --perms 644; done
pct push "$CTID" "$TMP/deploy/proxmox/nginx-voorraadthuis.conf" /etc/nginx/sites-available/voorraadthuis --perms 644
pct exec "$CTID" -- chown -R voorraadthuis:voorraadthuis "$SITE"
pct exec "$CTID" -- nginx -t
pct exec "$CTID" -- systemctl start voorraadthuis
pct exec "$CTID" -- systemctl reload nginx
IP=$(pct exec "$CTID" -- ip -4 -o addr show dev eth0 | awk '{print $4}' | cut -d/ -f1 | head -1)
if [ -n "$IP" ]; then
  pct exec "$CTID" -- /usr/local/sbin/voorraadthuis-cert-refresh
  pct exec "$CTID" -- systemctl reload nginx
  curl -kfsS --max-time 10 "https://$IP/healthz" | grep -q '^ok$' || { echo 'App-healthcheck mislukt.' >&2; exit 1; }
  curl -kfsS --max-time 10 "https://$IP/api/products" | grep -q '^\[' || { echo 'API-test mislukt.' >&2; exit 1; }
  echo "VoorraadThuis bijgewerkt; controle: https://$IP/"
else
  echo 'Bestanden bijgewerkt. IP niet gevonden; controleer service met pct exec <CTID> -- systemctl status voorraadthuis.'
fi
