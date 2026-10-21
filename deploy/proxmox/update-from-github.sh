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
FILES=(server.js wardrobe.js barcodes.js profiles.js package.json recipes-international.js recipes-open.js recipe-data/unitools-recipes.json "recipe-data/wikibooks-en-recipes.json" "recipe-data/wikibooks-es-recipes.json" "recipe-data/wikibooks-de-recipes.json" "recipe-data/wikibooks-nl-recipes.json" "recipe-data/wikibooks-fr-recipes.json" "recipe-data/wikibooks-it-recipes.json" "recipe-data/wikibooks-ca-recipes.json" "recipe-data/wikibooks-pt-recipes.json" "recipe-data/wikibooks-ja-recipes.json" "recipe-data/wikibooks-pl-recipes.json" "recipe-data/wikibooks-sv-recipes.json" "recipe-data/wikibooks-nb-recipes.json" "recipe-data/wikibooks-fi-recipes.json" recipe-data/translations-nl.json public/index.html "${ASSETS[@]}" deploy/proxmox/nginx-voorraadthuis.conf)
for f in "${FILES[@]}"; do mkdir -p "$TMP/$(dirname "$f")"; curl -fsSL --retry 3 --max-time 60 "$RAW/$f?cb=$(date +%s)" -o "$TMP/$f" || { echo "Download mislukt: $f" >&2; exit 1; }; done
grep -q 'VoorraadThuis' "$TMP/public/index.html" || { echo 'Gedownloade pagina niet herkend; niets gewijzigd.' >&2; exit 1; }
grep -q '"display"' "$TMP/public/manifest.webmanifest" || { echo 'Gedownload manifest niet herkend; niets gewijzigd.' >&2; exit 1; }
SITE=/var/www/voorraadthuis
STAGE=/var/www/voorraadthuis-staging
BACKUP=/var/www/voorraadthuis-backup
NGINX_CONF=/etc/nginx/sites-available/voorraadthuis
rollback(){ echo 'Bijwerken mislukt; eerdere versie wordt teruggezet.' >&2; pct exec "$CTID" -- bash -c "rm -rf '$SITE' && cp -a '$BACKUP' '$SITE' && chown -R voorraadthuis:voorraadthuis '$SITE'; [ -f '$NGINX_CONF.bak' ] && cp -a '$NGINX_CONF.bak' '$NGINX_CONF'"; pct exec "$CTID" -- systemctl restart voorraadthuis; exit 1; }
# Eerst alles klaarzetten en controleren; de draaiende app blijft ondertussen in de lucht.
pct exec "$CTID" -- rm -rf "$STAGE"
pct exec "$CTID" -- install -d -o voorraadthuis -g voorraadthuis "$STAGE/public" "$STAGE/recipe-data"
for f in server.js wardrobe.js barcodes.js profiles.js package.json recipes-international.js recipes-open.js public/index.html "${ASSETS[@]}"; do pct push "$CTID" "$TMP/$f" "$STAGE/$f" --perms 644; done
for f in unitools-recipes.json "wikibooks-en-recipes.json" "wikibooks-es-recipes.json" "wikibooks-de-recipes.json" "wikibooks-nl-recipes.json" "wikibooks-fr-recipes.json" "wikibooks-it-recipes.json" "wikibooks-ca-recipes.json" "wikibooks-pt-recipes.json" "wikibooks-ja-recipes.json" "wikibooks-pl-recipes.json" "wikibooks-sv-recipes.json" "wikibooks-nb-recipes.json" "wikibooks-fi-recipes.json" translations-nl.json; do pct push "$CTID" "$TMP/recipe-data/$f" "$STAGE/recipe-data/$f" --perms 644; done
pct exec "$CTID" -- node --check "$STAGE/server.js"
pct exec "$CTID" -- chown -R voorraadthuis:voorraadthuis "$STAGE"
# Nu pas wisselen, met een volledige kopie van de huidige versie als terugvaloptie.
pct exec "$CTID" -- systemctl stop voorraadthuis
pct exec "$CTID" -- bash -c "rm -rf '$BACKUP' && cp -a '$SITE' '$BACKUP' && cp -a '$STAGE/.' '$SITE/' && rm -rf '$STAGE' && chown -R voorraadthuis:voorraadthuis '$SITE'"
pct exec "$CTID" -- cp -a "$NGINX_CONF" "$NGINX_CONF.bak"
pct push "$CTID" "$TMP/deploy/proxmox/nginx-voorraadthuis.conf" "$NGINX_CONF" --perms 644
pct exec "$CTID" -- nginx -t || rollback
pct exec "$CTID" -- systemctl start voorraadthuis
pct exec "$CTID" -- systemctl reload nginx
IP=$(pct exec "$CTID" -- ip -4 -o addr show dev eth0 | awk '{print $4}' | cut -d/ -f1 | head -1)
if [ -n "$IP" ]; then
  pct exec "$CTID" -- /usr/local/sbin/voorraadthuis-cert-refresh
  pct exec "$CTID" -- systemctl reload nginx
  curl -kfsS --max-time 10 "https://$IP/healthz" | grep -q '^ok$' || { echo 'App-healthcheck mislukt.' >&2; rollback; }
  curl -kfsS --max-time 10 "https://$IP/" | grep -qi 'VoorraadThuis' || { echo 'App-pagina niet gevonden op / (staat index.html in /var/www/voorraadthuis/public?).' >&2; rollback; }
  curl -kfsS --max-time 10 "https://$IP/api/products" | grep -q '^\[' || { echo 'API-test mislukt.' >&2; rollback; }
  curl -kfsS --max-time 10 "https://$IP/favicon.svg" | grep -qi '<svg' || { echo 'App-pictogram niet bereikbaar.' >&2; rollback; }
  curl -kfsS --max-time 10 "https://$IP/manifest.webmanifest" | grep -q '"display"' || { echo 'Webapp-manifest niet bereikbaar.' >&2; rollback; }
  pct exec "$CTID" -- rm -rf "$BACKUP" "$NGINX_CONF.bak"
  echo "VoorraadThuis bijgewerkt; controle: https://$IP/ (terugvaloptie verwijderd na geslaagde controle)"
else
  echo 'Bestanden bijgewerkt. IP niet gevonden; controleer service met pct exec <CTID> -- systemctl status voorraadthuis.'
fi
