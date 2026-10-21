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
ASSETS=(public/favicon.svg public/manifest.webmanifest public/sw.js public/icon-192.png public/icon-512.png public/icon-512-maskable.png public/apple-touch-icon.png public/social-card.png)
FILES=(server.js wardrobe.js barcodes.js profiles.js package.json recipes-international.js recipes-open.js recipe-data/unitools-recipes.json "recipe-data/wikibooks-en-recipes.json" "recipe-data/wikibooks-es-recipes.json" "recipe-data/wikibooks-de-recipes.json" "recipe-data/wikibooks-nl-recipes.json" "recipe-data/wikibooks-fr-recipes.json" "recipe-data/wikibooks-it-recipes.json" "recipe-data/wikibooks-ca-recipes.json" "recipe-data/wikibooks-pt-recipes.json" "recipe-data/wikibooks-ja-recipes.json" "recipe-data/wikibooks-pl-recipes.json" "recipe-data/wikibooks-sv-recipes.json" "recipe-data/wikibooks-nb-recipes.json" "recipe-data/wikibooks-fi-recipes.json" recipe-data/translations-nl.json product-data/nl-huismerken.json product-data/winkelprefixen.json public/index.html "${ASSETS[@]}")
for f in "${FILES[@]}"; do mkdir -p "$TMP/$(dirname "$f")"; curl -fsSL --retry 3 --max-time 60 "$RAW/$f?cb=$(date +%s)" -o "$TMP/$f" || { echo "Download mislukt: $f" >&2; exit 1; }; done
grep -q 'VoorraadThuis' "$TMP/public/index.html" || { echo 'Gedownloade pagina niet herkend; niets gewijzigd.' >&2; exit 1; }
grep -q '"display"' "$TMP/public/manifest.webmanifest" || { echo 'Gedownload manifest niet herkend; niets gewijzigd.' >&2; exit 1; }
PROEF=$(mktemp); KOPPEN=$(mktemp); trap 'rm -rf "$TMP" "$PROEF" "$KOPPEN"' EXIT
# Antwoord eerst volledig wegschrijven en daarna zoeken: curl mag niet struikelen over
# een pijp die grep te vroeg sluit ('curl: (23) Failure writing output to destination').
proef(){ curl -fsS --max-time 10 "$1" -o "$PROEF" 2>/dev/null || return 1; grep -Eqi "$2" "$PROEF"; }
koppen(){ curl -fsS --max-time 5 -D "$KOPPEN" -o /dev/null "$1" 2>/dev/null || return 1; grep -Eqi "$2" "$KOPPEN"; }
# Voor https met het zelfondertekende certificaat van de app zelf (-k).
proefTls(){ curl -fsSk --max-time 10 "$1" -o "$PROEF" 2>/dev/null || return 1; grep -Eqi "$2" "$PROEF"; }
SITE=/var/www/voorraadthuis
STAGE=/var/www/voorraadthuis-staging
BACKUP=/var/www/voorraadthuis-backup
rollback(){ echo 'Bijwerken mislukt; eerdere versie wordt teruggezet.' >&2; pct exec "$CTID" -- bash -c "rm -rf '$SITE' && cp -a '$BACKUP' '$SITE' && chown -R voorraadthuis:voorraadthuis '$SITE'"; pct exec "$CTID" -- systemctl restart voorraadthuis; exit 1; }
# Eerst alles klaarzetten en controleren; de draaiende app blijft ondertussen in de lucht.
pct exec "$CTID" -- rm -rf "$STAGE"
pct exec "$CTID" -- install -d -o voorraadthuis -g voorraadthuis "$STAGE/public" "$STAGE/recipe-data" "$STAGE/product-data"
for f in server.js wardrobe.js barcodes.js profiles.js package.json recipes-international.js recipes-open.js public/index.html "${ASSETS[@]}"; do pct push "$CTID" "$TMP/$f" "$STAGE/$f" --perms 644; done
for f in unitools-recipes.json "wikibooks-en-recipes.json" "wikibooks-es-recipes.json" "wikibooks-de-recipes.json" "wikibooks-nl-recipes.json" "wikibooks-fr-recipes.json" "wikibooks-it-recipes.json" "wikibooks-ca-recipes.json" "wikibooks-pt-recipes.json" "wikibooks-ja-recipes.json" "wikibooks-pl-recipes.json" "wikibooks-sv-recipes.json" "wikibooks-nb-recipes.json" "wikibooks-fi-recipes.json" translations-nl.json; do pct push "$CTID" "$TMP/recipe-data/$f" "$STAGE/recipe-data/$f" --perms 644; done
# Huismerktabel van Nederlandse supermarkten (open data uit Open Food Facts).
for f in nl-huismerken.json winkelprefixen.json; do pct push "$CTID" "$TMP/product-data/$f" "$STAGE/product-data/$f" --perms 644; done
pct exec "$CTID" -- node --check "$STAGE/server.js"
pct exec "$CTID" -- chown -R voorraadthuis:voorraadthuis "$STAGE"
# Nu pas wisselen, met een volledige kopie van de huidige versie als terugvaloptie.
# Zelfondertekend certificaat, zodat de camera op een telefoon werkt (browsers geven de
# camera en de service worker alleen vrij op https). Bestaat het al, dan blijft het staan.
IP_CERT=$(pct exec "$CTID" -- ip -4 -o addr show dev eth0 | awk '{print $4}' | cut -d/ -f1 | head -1)
pct exec "$CTID" -- bash -c 'command -v openssl >/dev/null 2>&1 || { export DEBIAN_FRONTEND=noninteractive; apt-get install -y -qq openssl >/dev/null 2>&1; } || true; install -d -m 755 /etc/voorraadthuis/tls'
pct exec "$CTID" -- bash -c "if [ ! -s /etc/voorraadthuis/tls/cert.pem ]; then openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout /etc/voorraadthuis/tls/key.pem -out /etc/voorraadthuis/tls/cert.pem -subj '/CN=${IP_CERT}' -addext 'subjectAltName=IP:${IP_CERT}' >/dev/null 2>&1 || echo '[!] certificaat maken mislukte.'; fi"
pct exec "$CTID" -- bash -c 'chown -R voorraadthuis:voorraadthuis /etc/voorraadthuis/tls 2>/dev/null || true; chmod 644 /etc/voorraadthuis/tls/cert.pem 2>/dev/null || true; chmod 600 /etc/voorraadthuis/tls/key.pem 2>/dev/null || true'
pct exec "$CTID" -- systemctl stop voorraadthuis
pct exec "$CTID" -- bash -c "rm -rf '$BACKUP' && cp -a '$SITE' '$BACKUP' && cp -a '$STAGE/.' '$SITE/' && rm -rf '$STAGE' && chown -R voorraadthuis:voorraadthuis '$SITE'"
pct exec "$CTID" -- systemctl start voorraadthuis
IP=$(pct exec "$CTID" -- ip -4 -o addr show dev eth0 | awk '{print $4}' | cut -d/ -f1 | head -1)
if [ -n "$IP" ]; then
  ok=0
  for _ in $(seq 1 15); do
    if proef "http://$IP/healthz" '^ok$'; then ok=1; break; fi
    sleep 1
  done
  [ "$ok" = 1 ] || { echo 'App-healthcheck mislukt.' >&2; rollback; }
  # Antwoordt er iets anders dan de app op poort 80, dan is dit de verkeerde container
  # of staat er nog een webserver voor; eerst inrichten met provision-voorraadthuis.sh.
  koppen "http://$IP/healthz" '^x-voorraadthuis: app' || { echo 'Op poort 80 antwoordt niet de VoorraadThuis-app (achtergebleven webserver?). Draai eerst: provision-voorraadthuis.sh '"$CTID"'.' >&2; rollback; }
  proef "http://$IP/" 'VoorraadThuis' || { echo 'App-pagina niet gevonden op / (staat index.html in /var/www/voorraadthuis/public?).' >&2; rollback; }
  proef "http://$IP/api/products" '^\[' || { echo 'API-test mislukt.' >&2; rollback; }
  proef "http://$IP/api/barcode/8710400058519" 'found' || { echo 'Barcodeherkenning niet bereikbaar.' >&2; rollback; }
  proef "http://$IP/favicon.svg" '<svg' || { echo 'App-pictogram niet bereikbaar.' >&2; rollback; }
  proef "http://$IP/manifest.webmanifest" '"display"' || { echo 'Webapp-manifest niet bereikbaar.' >&2; rollback; }
  pct exec "$CTID" -- rm -rf "$BACKUP"
  if proefTls "https://$IP/healthz" '^ok$'; then
    echo "VoorraadThuis bijgewerkt; controle: http://$IP/ en https://$IP/ (terugvaloptie verwijderd na geslaagde controle)"
    echo "Voor de camera op je telefoon: https://$IP/ — accepteer eenmalig de waarschuwing, of installeer http://$IP/certificaat.crt."
  else
    echo "VoorraadThuis bijgewerkt; controle: http://$IP/ (https antwoordt nog niet; terugvaloptie verwijderd na geslaagde controle)"
  fi
else
  echo 'Bestanden bijgewerkt. IP niet gevonden; controleer service met pct exec <CTID> -- systemctl status voorraadthuis.'
fi
