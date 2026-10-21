#!/usr/bin/env bash
# Richt een draaiende Debian LXC in als VoorraadThuis-webapp.
# De app serveert de pagina zelf op poort 80; er is geen nginx nodig.
set -euo pipefail
CTID="${1:-${CTID:-}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SITE_DIR=/var/www/voorraadthuis
log(){ printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die(){ printf '\033[1;31m[fout]\033[0m %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "Draai als root op de Proxmox-host."
[ -n "$CTID" ] || die "Gebruik: $0 <container-id>"
for f in "$APP_DIR/server.js" "$APP_DIR/wardrobe.js" "$APP_DIR/barcodes.js" "$APP_DIR/profiles.js" "$APP_DIR/package.json" "$APP_DIR/recipes-international.js" "$APP_DIR/recipes-open.js" "$APP_DIR/recipe-data/unitools-recipes.json" "$APP_DIR/recipe-data/wikibooks-en-recipes.json" "$APP_DIR/recipe-data/wikibooks-es-recipes.json" "$APP_DIR/recipe-data/wikibooks-de-recipes.json" "$APP_DIR/recipe-data/wikibooks-nl-recipes.json" "$APP_DIR/recipe-data/wikibooks-fr-recipes.json" "$APP_DIR/recipe-data/wikibooks-it-recipes.json" "$APP_DIR/recipe-data/wikibooks-ca-recipes.json" "$APP_DIR/recipe-data/wikibooks-pt-recipes.json" "$APP_DIR/recipe-data/wikibooks-ja-recipes.json" "$APP_DIR/recipe-data/wikibooks-pl-recipes.json" "$APP_DIR/recipe-data/wikibooks-sv-recipes.json" "$APP_DIR/recipe-data/wikibooks-nb-recipes.json" "$APP_DIR/recipe-data/wikibooks-fi-recipes.json" "$APP_DIR/recipe-data/translations-nl.json" "$APP_DIR/public/index.html" "$APP_DIR/public/favicon.svg" "$APP_DIR/public/manifest.webmanifest" "$APP_DIR/public/sw.js" "$APP_DIR/public/icon-192.png" "$APP_DIR/public/icon-512.png" "$APP_DIR/public/icon-512-maskable.png" "$APP_DIR/public/apple-touch-icon.png" "$APP_DIR/public/social-card.png"; do [ -f "$f" ] || die "$f ontbreekt."; done
command -v pct >/dev/null || die "pct niet gevonden."
pct status "$CTID" >/dev/null 2>&1 || die "Container $CTID bestaat niet."
[ "$(pct status "$CTID")" = 'status: running' ] || die "Container $CTID draait niet."
IP=$(pct exec "$CTID" -- ip -4 -o addr show dev eth0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1 || true)
[ -n "$IP" ] || die "Container heeft geen IPv4-adres op eth0. Controleer DHCP/netwerk."
log "Container-IP: $IP; afhankelijkheden installeren…"
pct exec "$CTID" -- bash -lc 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq ca-certificates curl gnupg >/dev/null'
pct exec "$CTID" -- bash -lc 'install -d -m 0755 /etc/apt/keyrings && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && chmod a+r /etc/apt/keyrings/nodesource.gpg && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && apt-get update -qq && apt-get install -y -qq nodejs >/dev/null'
pct exec "$CTID" -- useradd --system --home /var/lib/voorraadthuis --shell /usr/sbin/nologin voorraadthuis 2>/dev/null || true
pct exec "$CTID" -- install -d -o voorraadthuis -g voorraadthuis "$SITE_DIR/public" "$SITE_DIR/recipe-data" /var/lib/voorraadthuis /var/lib/voorraadthuis/fotos
for f in server.js wardrobe.js barcodes.js profiles.js package.json recipes-international.js recipes-open.js public/index.html public/favicon.svg public/manifest.webmanifest public/sw.js public/icon-192.png public/icon-512.png public/icon-512-maskable.png public/apple-touch-icon.png public/social-card.png; do pct push "$CTID" "$APP_DIR/$f" "$SITE_DIR/$f" --perms 644; done
for f in unitools-recipes.json "wikibooks-en-recipes.json" "wikibooks-es-recipes.json" "wikibooks-de-recipes.json" "wikibooks-nl-recipes.json" "wikibooks-fr-recipes.json" "wikibooks-it-recipes.json" "wikibooks-ca-recipes.json" "wikibooks-pt-recipes.json" "wikibooks-ja-recipes.json" "wikibooks-pl-recipes.json" "wikibooks-sv-recipes.json" "wikibooks-nb-recipes.json" "wikibooks-fi-recipes.json" translations-nl.json; do pct push "$CTID" "$APP_DIR/recipe-data/$f" "$SITE_DIR/recipe-data/$f" --perms 644; done
pct exec "$CTID" -- chown -R voorraadthuis:voorraadthuis "$SITE_DIR" /var/lib/voorraadthuis /var/lib/voorraadthuis/fotos
# nginx en het oude certificaat zijn niet meer nodig: de app luistert zelf op poort 80.
pct exec "$CTID" -- bash -c 'systemctl disable --now nginx 2>/dev/null || true; systemctl disable --now voorraadthuis-cert.service 2>/dev/null || true; rm -f /etc/systemd/system/voorraadthuis-cert.service /usr/local/sbin/voorraadthuis-cert-refresh /etc/nginx/sites-enabled/voorraadthuis /etc/nginx/sites-available/voorraadthuis; rm -rf /etc/ssl/voorraadthuis; export DEBIAN_FRONTEND=noninteractive; apt-get purge -y -qq nginx nginx-common nginx-core 2>/dev/null || true; apt-get autoremove -y -qq >/dev/null 2>&1 || true; systemctl daemon-reload'
pct exec "$CTID" -- bash -c 'cat > /etc/systemd/system/voorraadthuis.service <<'"'"'UNIT'"'"'
[Unit]
Description=VoorraadThuis voorraad-app
After=network.target
[Service]
Type=simple
User=voorraadthuis
Group=voorraadthuis
Environment=PORT=80
Environment=HOST=0.0.0.0
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
# Poort 80 is geprivilegieerd: alleen deze ene capability, de dienst blijft de
# onbevoorrechte gebruiker voorraadthuis en draait dus niet als root.
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
[Install]
WantedBy=multi-user.target
UNIT'
pct exec "$CTID" -- systemctl daemon-reload
pct exec "$CTID" -- systemctl enable --now voorraadthuis
log "Wachten op de app…"
# Bij een mislukte controle meteen laten zien wat er wél staat, zodat de oorzaak
# zichtbaar is in plaats van alleen "mislukt".
diagnose(){
  printf '\033[1;33m--- diagnose ---\033[0m\n' >&2
  printf 'pagina / vanaf de host: ' >&2
  curl -fsS --max-time 5 -o /dev/null -w 'HTTP %{http_code}\n' "http://$IP/" 2>/dev/null || printf 'niet bereikbaar\n' >&2
  printf 'in de container:\n' >&2
  pct exec "$CTID" -- curl -sS --max-time 5 -o /dev/null -w '    127.0.0.1 -> HTTP %{http_code}\n' http://127.0.0.1/ 2>/dev/null >&2 || printf '    de app antwoordt niet op 127.0.0.1\n' >&2
  printf 'bestanden:\n' >&2
  pct exec "$CTID" -- ls -la "$SITE_DIR" "$SITE_DIR/public" 2>/dev/null | sed 's/^/    /' >&2 || true
  printf 'dienst voorraadthuis: ' >&2
  pct exec "$CTID" -- systemctl is-active voorraadthuis 2>/dev/null >&2 || true
  pct exec "$CTID" -- journalctl -u voorraadthuis -n 8 --no-pager 2>/dev/null | sed 's/^/    /' >&2 || true
  if pct exec "$CTID" -- journalctl -u voorraadthuis -n 50 --no-pager 2>/dev/null | grep -q 'EACCES'; then
    printf '    tip: de app mocht poort 80 niet openen (EACCES); controleer AmbientCapabilities=CAP_NET_BIND_SERVICE in /etc/systemd/system/voorraadthuis.service\n' >&2
  fi
}
for _ in $(seq 1 20); do
  if curl -fsS --max-time 3 "http://$IP/healthz" 2>/dev/null | grep -q '^ok$'; then
    curl -fsS --max-time 5 "http://$IP/" 2>/dev/null | grep -qi 'VoorraadThuis' || { diagnose; die "Healthcheck ok, maar app-pagina niet gevonden."; }
    curl -fsS --max-time 5 "http://$IP/api/products" 2>/dev/null | grep -q '^\[' || { diagnose; die "API-test mislukt."; }
    curl -fsS --max-time 5 "http://$IP/api/kast/config" 2>/dev/null | grep -q '"schoenen"' || { diagnose; die "Garderobe-API (Kledingkast) antwoordt niet."; }
    log "VoorraadThuis reageert op http://$IP/ (geen nginx; de app luistert zelf op poort 80)."
    exit 0
  fi
  sleep 1
done
diagnose
die "Healthcheck faalde."
