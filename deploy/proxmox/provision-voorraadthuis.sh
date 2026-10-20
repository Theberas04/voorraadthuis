#!/usr/bin/env bash
# Richt een draaiende Debian LXC in als VoorraadThuis-webapp.
set -euo pipefail
CTID="${1:-${CTID:-}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SITE_DIR=/var/www/voorraadthuis
log(){ printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die(){ printf '\033[1;31m[fout]\033[0m %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "Draai als root op de Proxmox-host."
[ -n "$CTID" ] || die "Gebruik: $0 <container-id>"
for f in "$APP_DIR/server.js" "$APP_DIR/wardrobe.js" "$APP_DIR/barcodes.js" "$APP_DIR/profiles.js" "$APP_DIR/package.json" "$APP_DIR/recipes-international.js" "$APP_DIR/recipes-open.js" "$APP_DIR/recipe-data/unitools-recipes.json" "$APP_DIR/recipe-data/wikibooks-recipes.json" "$APP_DIR/recipe-data/translations-nl.json" "$APP_DIR/public/index.html" "$APP_DIR/public/favicon.svg" "$APP_DIR/public/manifest.webmanifest" "$APP_DIR/public/sw.js" "$APP_DIR/public/icon-192.png" "$APP_DIR/public/icon-512.png" "$APP_DIR/public/icon-512-maskable.png" "$APP_DIR/public/apple-touch-icon.png" "$APP_DIR/public/social-card.png" "$SCRIPT_DIR/nginx-voorraadthuis.conf"; do [ -f "$f" ] || die "$f ontbreekt."; done
command -v pct >/dev/null || die "pct niet gevonden."
pct status "$CTID" >/dev/null 2>&1 || die "Container $CTID bestaat niet."
[ "$(pct status "$CTID")" = 'status: running' ] || die "Container $CTID draait niet."
IP=$(pct exec "$CTID" -- ip -4 -o addr show dev eth0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1 || true)
[ -n "$IP" ] || die "Container heeft geen IPv4-adres op eth0. Controleer DHCP/netwerk."
log "Container-IP: $IP; afhankelijkheden installeren…"
pct exec "$CTID" -- bash -lc 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq ca-certificates curl gnupg nginx openssl >/dev/null'
pct exec "$CTID" -- bash -lc 'install -d -m 0755 /etc/apt/keyrings && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && chmod a+r /etc/apt/keyrings/nodesource.gpg && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && apt-get update -qq && apt-get install -y -qq nodejs >/dev/null'
pct exec "$CTID" -- useradd --system --home /var/lib/voorraadthuis --shell /usr/sbin/nologin voorraadthuis 2>/dev/null || true
pct exec "$CTID" -- install -d -o voorraadthuis -g voorraadthuis "$SITE_DIR/public" "$SITE_DIR/recipe-data" /var/lib/voorraadthuis /var/lib/voorraadthuis/fotos /etc/ssl/voorraadthuis
for f in server.js wardrobe.js barcodes.js profiles.js package.json recipes-international.js recipes-open.js public/index.html public/favicon.svg public/manifest.webmanifest public/sw.js public/icon-192.png public/icon-512.png public/icon-512-maskable.png public/apple-touch-icon.png public/social-card.png; do pct push "$CTID" "$APP_DIR/$f" "$SITE_DIR/$f" --perms 644; done
for f in unitools-recipes.json wikibooks-recipes.json translations-nl.json; do pct push "$CTID" "$APP_DIR/recipe-data/$f" "$SITE_DIR/recipe-data/$f" --perms 644; done
pct push "$CTID" "$SCRIPT_DIR/nginx-voorraadthuis.conf" /etc/nginx/sites-available/voorraadthuis --perms 644
pct exec "$CTID" -- bash -c "openssl req -x509 -nodes -newkey rsa:2048 -days 825 -keyout /etc/ssl/voorraadthuis/key.pem -out /etc/ssl/voorraadthuis/cert.pem -subj '/CN=$IP' -addext 'subjectAltName=IP:$IP' >/dev/null 2>&1 && chmod 600 /etc/ssl/voorraadthuis/key.pem"
pct exec "$CTID" -- bash -c 'cat > /usr/local/sbin/voorraadthuis-cert-refresh <<'"'"'SH'"'"'
#!/bin/sh
set -eu
set -- $(ip -4 -o addr show dev eth0 scope global)
IP=${4:-}
IP=${IP%%/*}
[ -n "$IP" ] || exit 0
CERT=/etc/ssl/voorraadthuis/cert.pem
if [ -f "$CERT" ] && openssl x509 -in "$CERT" -noout -ext subjectAltName 2>/dev/null | grep -Fq "IP Address:$IP"; then exit 0; fi
mkdir -p /etc/ssl/voorraadthuis
openssl req -x509 -nodes -newkey rsa:2048 -days 825 -keyout /etc/ssl/voorraadthuis/key.pem -out "$CERT" -subj "/CN=$IP" -addext "subjectAltName=IP:$IP" >/dev/null 2>&1
chmod 600 /etc/ssl/voorraadthuis/key.pem
systemctl reload nginx 2>/dev/null || true
SH'
pct exec "$CTID" -- chmod 755 /usr/local/sbin/voorraadthuis-cert-refresh
pct exec "$CTID" -- bash -c 'cat > /etc/systemd/system/voorraadthuis-cert.service <<'"'"'UNIT'"'"'
[Unit]
Description=VoorraadThuis-certificaat afstemmen op container-IP
After=network-online.target nginx.service
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/voorraadthuis-cert-refresh
[Install]
WantedBy=multi-user.target
UNIT'
pct exec "$CTID" -- bash -c 'cat > /etc/systemd/system/voorraadthuis.service <<'"'"'UNIT'"'"'
[Unit]
Description=VoorraadThuis voorraad-app
After=network.target
[Service]
Type=simple
User=voorraadthuis
Group=voorraadthuis
Environment=PORT=3000
Environment=HOST=127.0.0.1
Environment=DB_PATH=/var/lib/voorraadthuis/voorraad.db
Environment=MEDIA_DIR=/var/lib/voorraadthuis/fotos
# Optioneel: AI-tagging van kledingfotos via een OpenAI-compatibele dienst.
#Environment=AI_BASE_URL=http://192.168.1.10:11434/v1
#Environment=AI_VISION_MODEL=llava
#Environment=AI_API_KEY=...
WorkingDirectory=/var/www/voorraadthuis
ExecStart=/usr/bin/node /var/www/voorraadthuis/server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/voorraadthuis
[Install]
WantedBy=multi-user.target
UNIT'
pct exec "$CTID" -- chown -R voorraadthuis:voorraadthuis "$SITE_DIR" /var/lib/voorraadthuis /var/lib/voorraadthuis/fotos
pct exec "$CTID" -- rm -f /etc/nginx/sites-enabled/default
pct exec "$CTID" -- ln -sfn /etc/nginx/sites-available/voorraadthuis /etc/nginx/sites-enabled/voorraadthuis
pct exec "$CTID" -- nginx -t || die "nginx-configuratie ongeldig."
pct exec "$CTID" -- systemctl daemon-reload
pct exec "$CTID" -- systemctl enable --now voorraadthuis
pct exec "$CTID" -- systemctl enable --now nginx
pct exec "$CTID" -- systemctl enable voorraadthuis-cert.service
pct exec "$CTID" -- systemctl restart nginx
log "Wachten op app en nginx…"
# Bij een mislukte controle meteen laten zien wat er wél staat, zodat de oorzaak
# zichtbaar is in plaats van alleen "mislukt".
diagnose(){
  printf '\033[1;33m--- diagnose ---\033[0m\n' >&2
  printf 'pagina /: ' >&2
  curl -kfsS --max-time 5 -o /dev/null -w 'HTTP %{http_code}\n' "https://$IP/" 2>/dev/null || printf 'niet bereikbaar\n' >&2
  printf 'bestanden:\n' >&2
  pct exec "$CTID" -- ls -la "$SITE_DIR" "$SITE_DIR/public" 2>/dev/null | sed 's/^/    /' >&2 || true
  printf 'dienst voorraadthuis: ' >&2
  pct exec "$CTID" -- systemctl is-active voorraadthuis 2>/dev/null >&2 || true
  pct exec "$CTID" -- journalctl -u voorraadthuis -n 8 --no-pager 2>/dev/null | sed 's/^/    /' >&2 || true
}
for _ in $(seq 1 20); do
  if curl -kfsS --max-time 3 "https://$IP/healthz" 2>/dev/null | grep -q '^ok$'; then
    curl -kfsS --max-time 5 "https://$IP/" 2>/dev/null | grep -qi 'VoorraadThuis' || { diagnose; die "Healthcheck ok, maar app-pagina niet gevonden."; }
    curl -kfsS --max-time 5 "https://$IP/api/products" 2>/dev/null | grep -q '^\[' || { diagnose; die "API-test mislukt."; }
    curl -kfsS --max-time 5 "https://$IP/api/kast/config" 2>/dev/null | grep -q '"schoenen"' || { diagnose; die "Garderobe-API (Kledingkast) antwoordt niet."; }
    log "VoorraadThuis reageert op https://$IP/ (self-signed TLS); API is bereikbaar."
    exit 0
  fi
  sleep 1
done
pct exec "$CTID" -- systemctl status voorraadthuis --no-pager || true
pct exec "$CTID" -- systemctl status nginx --no-pager || true
die "Healthcheck faalde."
