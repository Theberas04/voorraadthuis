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
for f in "$APP_DIR/server.js" "$APP_DIR/wardrobe.js" "$APP_DIR/keuken.js" "$APP_DIR/weer.js" "$APP_DIR/barcodes.js" "$APP_DIR/profiles.js" "$APP_DIR/platen.js" "$APP_DIR/package.json" "$APP_DIR/recipes-international.js" "$APP_DIR/recipes-open.js" "$APP_DIR/recipe-data/unitools-recipes.json" "$APP_DIR/recipe-data/wikibooks-en-recipes.json" "$APP_DIR/recipe-data/wikibooks-es-recipes.json" "$APP_DIR/recipe-data/wikibooks-de-recipes.json" "$APP_DIR/recipe-data/wikibooks-nl-recipes.json" "$APP_DIR/recipe-data/wikibooks-fr-recipes.json" "$APP_DIR/recipe-data/wikibooks-it-recipes.json" "$APP_DIR/recipe-data/wikibooks-ca-recipes.json" "$APP_DIR/recipe-data/wikibooks-pt-recipes.json" "$APP_DIR/recipe-data/wikibooks-ja-recipes.json" "$APP_DIR/recipe-data/wikibooks-pl-recipes.json" "$APP_DIR/recipe-data/wikibooks-sv-recipes.json" "$APP_DIR/recipe-data/wikibooks-nb-recipes.json" "$APP_DIR/recipe-data/wikibooks-fi-recipes.json" "$APP_DIR/recipe-data/wikibooks-cocktails-recipes.json" "$APP_DIR/recipe-data/wikibooks-borrelhapjes-recipes.json" "$APP_DIR/recipe-data/translations-nl.json" "$APP_DIR/product-data/nl-huismerken.json" "$APP_DIR/product-data/winkelprefixen.json" "$APP_DIR/product-data/lp-barcodes.json" "$SCRIPT_DIR/fetch-discogs-catalog.sh" "$APP_DIR/public/index.html" "$APP_DIR/public/favicon.svg" "$APP_DIR/public/manifest.webmanifest" "$APP_DIR/public/sw.js" "$APP_DIR/public/icon-192.png" "$APP_DIR/public/icon-512.png" "$APP_DIR/public/icon-512-maskable.png" "$APP_DIR/public/apple-touch-icon.png" "$APP_DIR/public/social-card.png"; do [ -f "$f" ] || die "$f ontbreekt."; done
command -v pct >/dev/null || die "pct niet gevonden."
pct status "$CTID" >/dev/null 2>&1 || die "Container $CTID bestaat niet."
[ "$(pct status "$CTID")" = 'status: running' ] || die "Container $CTID draait niet."
IP=$(pct exec "$CTID" -- ip -4 -o addr show dev eth0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1 || true)
[ -n "$IP" ] || die "Container heeft geen IPv4-adres op eth0. Controleer DHCP/netwerk."
log "Container-IP: $IP; afhankelijkheden installeren…"
pct exec "$CTID" -- bash -lc 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq ca-certificates curl gnupg >/dev/null'
pct exec "$CTID" -- bash -lc 'install -d -m 0755 /etc/apt/keyrings && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && chmod a+r /etc/apt/keyrings/nodesource.gpg && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && apt-get update -qq && apt-get install -y -qq nodejs >/dev/null'
pct exec "$CTID" -- useradd --system --home /var/lib/voorraadthuis --shell /usr/sbin/nologin voorraadthuis 2>/dev/null || true
pct exec "$CTID" -- install -d -o voorraadthuis -g voorraadthuis "$SITE_DIR/public" "$SITE_DIR/recipe-data" "$SITE_DIR/product-data" /var/lib/voorraadthuis /var/lib/voorraadthuis/fotos
for f in server.js wardrobe.js keuken.js weer.js barcodes.js profiles.js platen.js eigen-recepten.js package.json recipes-international.js recipes-open.js public/index.html public/barcode-scan.js public/platen.js public/favicon.svg public/manifest.webmanifest public/sw.js public/icon-192.png public/icon-512.png public/icon-512-maskable.png public/apple-touch-icon.png public/social-card.png; do pct push "$CTID" "$APP_DIR/$f" "$SITE_DIR/$f" --perms 644; done
for f in unitools-recipes.json "wikibooks-en-recipes.json" "wikibooks-es-recipes.json" "wikibooks-de-recipes.json" "wikibooks-nl-recipes.json" "wikibooks-fr-recipes.json" "wikibooks-it-recipes.json" "wikibooks-ca-recipes.json" "wikibooks-pt-recipes.json" "wikibooks-ja-recipes.json" "wikibooks-pl-recipes.json" "wikibooks-sv-recipes.json" "wikibooks-nb-recipes.json" "wikibooks-fi-recipes.json" "wikibooks-cocktails-recipes.json" "wikibooks-borrelhapjes-recipes.json" translations-nl.json; do pct push "$CTID" "$APP_DIR/recipe-data/$f" "$SITE_DIR/recipe-data/$f" --perms 644; done
# Huismerktabel van Nederlandse supermarkten (open data uit Open Food Facts).
for f in nl-huismerken.json winkelprefixen.json lp-barcodes.json; do pct push "$CTID" "$APP_DIR/product-data/$f" "$SITE_DIR/product-data/$f" --perms 644; done
pct exec "$CTID" -- chown -R voorraadthuis:voorraadthuis "$SITE_DIR" /var/lib/voorraadthuis /var/lib/voorraadthuis/fotos
"$SCRIPT_DIR/fetch-discogs-catalog.sh" "$CTID"
# nginx en het oude certificaat zijn niet meer nodig: de app luistert zelf op poort 80.
pct exec "$CTID" -- bash -c 'systemctl disable --now nginx 2>/dev/null || true; systemctl disable --now voorraadthuis-cert.service 2>/dev/null || true; rm -f /etc/systemd/system/voorraadthuis-cert.service /usr/local/sbin/voorraadthuis-cert-refresh /etc/nginx/sites-enabled/voorraadthuis /etc/nginx/sites-available/voorraadthuis; rm -rf /etc/ssl/voorraadthuis; export DEBIAN_FRONTEND=noninteractive; apt-get purge -y -qq nginx nginx-common nginx-core 2>/dev/null || true; apt-get autoremove -y -qq >/dev/null 2>&1 || true; systemctl daemon-reload'
# Wat er daarna ook nog op poort 80 luistert (een achtergebleven webserver): stoppen,
# anders kan de app de pagina niet zelf bedienen en antwoordt iets anders op /healthz.
pct exec "$CTID" -- pkill -f nginx 2>/dev/null || true
pct exec "$CTID" -- bash -c 'command -v fuser >/dev/null 2>&1 && fuser -k -n tcp 80 443 >/dev/null 2>&1 || true'
# Zelfondertekend certificaat voor https. Browsers geven de camera (barcodes scannen op
# een telefoon) en de service worker alleen vrij op een beveiligde verbinding; daarom
# luistert de app naast poort 80 ook op 443. Op de telefoon eenmalig de waarschuwing
# accepteren, of het certificaat installeren via http://<ip>/certificaat.crt.
pct exec "$CTID" -- bash -c 'command -v openssl >/dev/null 2>&1 || { export DEBIAN_FRONTEND=noninteractive; apt-get install -y -qq openssl >/dev/null 2>&1; } || true; install -d -m 755 /etc/voorraadthuis/tls'
pct exec "$CTID" -- bash -c "if [ ! -s /etc/voorraadthuis/tls/cert.pem ]; then openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout /etc/voorraadthuis/tls/key.pem -out /etc/voorraadthuis/tls/cert.pem -subj '/CN=${IP}' -addext 'subjectAltName=IP:${IP}' >/dev/null 2>&1 || echo '[!] certificaat maken mislukte; camera scannen op de telefoon blijft dan beperkt tot https-omgevingen.'; fi"
pct exec "$CTID" -- bash -c 'chown -R voorraadthuis:voorraadthuis /etc/voorraadthuis/tls 2>/dev/null || true; chmod 644 /etc/voorraadthuis/tls/cert.pem 2>/dev/null || true; chmod 600 /etc/voorraadthuis/tls/key.pem 2>/dev/null || true'
pct exec "$CTID" -- bash -c 'ss -ltnH "sport = :80" 2>/dev/null | grep -q . && echo "[!] poort 80 is nog bezet" || true'
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
Environment=PLATEN_DISCOGS_DB=/var/lib/voorraadthuis/discogs-vinyl.sqlite
# https met het zelfondertekende certificaat (camera + webapp op de telefoon).
Environment=TLS_CERT=/etc/voorraadthuis/tls/cert.pem
Environment=TLS_KEY=/etc/voorraadthuis/tls/key.pem
Environment=TLS_PORT=443
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
# Controlehulpje: het antwoord eerst volledig wegschrijven en daarna zoeken. Zo kan
# curl niet struikelen over een pijp die grep te vroeg sluit (onder pipefail gaf dat
# 'curl: (23) Failure writing output to destination' en dus een valse mislukking).
PROEF=$(mktemp); KOPPEN=$(mktemp); trap 'rm -f "$PROEF" "$KOPPEN"' EXIT
proef(){ curl -fsS --max-time 10 "$1" -o "$PROEF" 2>/dev/null || return 1; grep -Eqi "$2" "$PROEF"; }
koppen(){ curl -fsS --max-time 5 -D "$KOPPEN" -o /dev/null "$1" 2>/dev/null || return 1; grep -Eqi "$2" "$KOPPEN"; }
# Voor https met het zelfondertekende certificaat van de app zelf (-k).
proefTls(){ curl -fsSk --max-time 10 "$1" -o "$PROEF" 2>/dev/null || return 1; grep -Eqi "$2" "$PROEF"; }
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
  printf 'poort 80 in de container:\n' >&2
  pct exec "$CTID" -- ss -ltnpH 'sport = :80' 2>/dev/null | sed 's/^/    /' >&2 || true
  printf 'dienst voorraadthuis: ' >&2
  pct exec "$CTID" -- systemctl is-active voorraadthuis 2>/dev/null >&2 || true
  pct exec "$CTID" -- journalctl -u voorraadthuis -n 8 --no-pager 2>/dev/null | sed 's/^/    /' >&2 || true
  journaal=$(pct exec "$CTID" -- journalctl -u voorraadthuis -n 50 --no-pager 2>/dev/null || true)
  if printf '%s' "$journaal" | grep -q 'EACCES'; then
    printf '    tip: de app mocht poort 80 niet openen (EACCES); controleer AmbientCapabilities=CAP_NET_BIND_SERVICE in /etc/systemd/system/voorraadthuis.service\n' >&2
  fi
}
# Antwoordt er iets anders dan de app op poort 80 (een achtergebleven webserver),
# dan meteen stoppen met een duidelijke melding in plaats van door te blijven proberen.
if curl -fsS --max-time 3 -o /dev/null "http://$IP/healthz" 2>/dev/null && ! koppen "http://$IP/healthz" '^x-voorraadthuis: app'; then
  diagnose
  die "Op poort 80 antwoordt iets anders dan de app; verwijder die webserver en probeer opnieuw."
fi
for _ in $(seq 1 20); do
  if koppen "http://$IP/healthz" '^x-voorraadthuis: app' && proef "http://$IP/healthz" '^ok$'; then
    poort80=$(pct exec "$CTID" -- bash -c 'ss -ltnpH "sport = :80" 2>/dev/null' || true)
    case "$poort80" in *node*) ;; *) diagnose; die "Poort 80 wordt niet door de app bediend; er luistert nog iets anders op poort 80.";; esac
    proef "http://$IP/" 'VoorraadThuis' || { diagnose; die "Healthcheck ok, maar app-pagina niet gevonden."; }
    proef "http://$IP/api/products" '^\[' || { diagnose; die "API-test mislukt."; }
    proef "http://$IP/api/kast/config" '"schoenen"' || { diagnose; die "Garderobe-API (Kledingkast) antwoordt niet."; }
    if proefTls "https://$IP/healthz" '^ok$'; then
      log "VoorraadThuis reageert op http://$IP/ en https://$IP/ (geen nginx; de app luistert zelf op poort 80 en 443)."
      log "Voor de camera op je telefoon: https://$IP/ — accepteer eenmalig de waarschuwing, of installeer http://$IP/certificaat.crt."
    else
      log "VoorraadThuis reageert op http://$IP/ (geen nginx; de app luistert zelf op poort 80). https antwoordt nog niet; controleer het certificaat."
    fi
    exit 0
  fi
  sleep 1
done
diagnose
die "Healthcheck faalde."
