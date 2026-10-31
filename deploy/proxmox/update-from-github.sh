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
# Deze container is nooit met de nieuwe opzet ingericht (nginx er nog voor, of de dienst
# luistert nog op een andere poort). Bijwerken zou dan eindigen in 'gezondheidscontrole
# mislukt'; in plaats daarvan zeggen we meteen wat er moet gebeuren, zonder iets te wijzigen.
if pct exec "$CTID" -- bash -c 'command -v nginx >/dev/null 2>&1' 2>/dev/null; then
  echo 'In deze container staat nog nginx: hij is ingericht met de oude opzet (nginx voor de app).' >&2
  echo 'De app hoort de pagina zelf op poort 80 te serveren; daarom moet deze container eerst' >&2
  echo 'opnieuw ingericht worden (dat mag gewoon over de bestaande gegevens heen):' >&2
  echo "  cd /root && rm -rf voorraadthuis-main && curl -fsSL https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH | tar xz && bash /root/voorraadthuis-main/deploy/proxmox/provision-voorraadthuis.sh $CTID" >&2
  echo 'Er is niets gewijzigd.' >&2
  exit 1
fi
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
ASSETS=(public/barcode-scan.js public/platen.js public/favicon.svg public/manifest.webmanifest public/sw.js public/icon-192.png public/icon-512.png public/icon-512-maskable.png public/apple-touch-icon.png public/social-card.png)
FILES=(server.js wardrobe.js keuken.js weer.js barcodes.js profiles.js platen.js eigen-recepten.js agenda.js package.json "deploy/proxmox/fetch-discogs-catalog.sh" recipes-international.js recipes-open.js recipe-data/unitools-recipes.json "recipe-data/wikibooks-en-recipes.json" "recipe-data/wikibooks-es-recipes.json" "recipe-data/wikibooks-de-recipes.json" "recipe-data/wikibooks-nl-recipes.json" "recipe-data/wikibooks-fr-recipes.json" "recipe-data/wikibooks-it-recipes.json" "recipe-data/wikibooks-ca-recipes.json" "recipe-data/wikibooks-pt-recipes.json" "recipe-data/wikibooks-ja-recipes.json" "recipe-data/wikibooks-pl-recipes.json" "recipe-data/wikibooks-sv-recipes.json" "recipe-data/wikibooks-nb-recipes.json" "recipe-data/wikibooks-fi-recipes.json" "recipe-data/wikibooks-cocktails-recipes.json" "recipe-data/wikibooks-borrelhapjes-recipes.json" "recipe-data/translations-nl.json" product-data/nl-huismerken.json product-data/winkelprefixen.json product-data/lp-barcodes.json public/index.html "${ASSETS[@]}")
for f in "${FILES[@]}"; do
  case "$f" in *" "*) echo "Interne fout: bestandsnaam met een spatie ($f). Meld dit; er is niets gewijzigd." >&2; exit 1;; esac
done
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
bash "$TMP/deploy/proxmox/fetch-discogs-catalog.sh" "$CTID"
pct exec "$CTID" -- bash -c 'grep -q "^Environment=PLATEN_DISCOGS_DB=" /etc/systemd/system/voorraadthuis.service || sed -i "/^Environment=MEDIA_DIR=/a Environment=PLATEN_DISCOGS_DB=/var/lib/voorraadthuis/discogs-vinyl.sqlite" /etc/systemd/system/voorraadthuis.service; grep -q "^Environment=PLATEN_DISCOGS_DB=/var/lib/voorraadthuis/discogs-vinyl.sqlite$" /etc/systemd/system/voorraadthuis.service'
pct exec "$CTID" -- systemctl daemon-reload
# Lukt de controle niet, dan zeggen we precies wat we zien in plaats van alleen 'mislukt':
# waar de dienst op staat, wat er op poort 80 luistert, wat het journaal zegt en hoeveel
# geheugen de container heeft. Dat scheelt een tweede ronde.
diagnose(){
  printf '\033[1;33m--- diagnose ---\033[0m\n' >&2
  printf 'dienst voorraadthuis: ' >&2
  pct exec "$CTID" -- systemctl is-active voorraadthuis 2>/dev/null >&2 || printf 'onbekend\n' >&2
  printf 'poort in de dienst: ' >&2
  pct exec "$CTID" -- grep -h '^Environment=PORT' /etc/systemd/system/voorraadthuis.service 2>/dev/null | tr -d '\n' >&2 || true
  printf '\nwat luistert er:\n' >&2
  pct exec "$CTID" -- ss -ltnpH 'sport = :80 or sport = :443' 2>/dev/null | sed 's/^/    /' >&2 || true
  printf 'nginx aanwezig: ' >&2
  pct exec "$CTID" -- bash -c 'command -v nginx >/dev/null 2>&1 && echo ja || echo nee' 2>/dev/null >&2 || true
  printf 'geheugen:\n' >&2
  pct exec "$CTID" -- free -m 2>/dev/null | sed 's/^/    /' >&2 || true
  printf 'journaal van de app (laatste twintig regels):\n' >&2
  pct exec "$CTID" -- journalctl -u voorraadthuis -n 20 --no-pager 2>/dev/null | sed 's/^/    /' >&2 || true
  printf 'bestanden:\n' >&2
  pct exec "$CTID" -- ls -la "$SITE" "$SITE/public" 2>/dev/null | sed 's/^/    /' >&2 || true
  if pct exec "$CTID" -- journalctl -u voorraadthuis -n 80 --no-pager 2>/dev/null | grep -q 'Killed process\|Out of memory\|EACCES'; then
    printf 'let op: in het journaal staat een afgebroken proces, een geheugentekort of een rechtenprobleem.\n' >&2
  fi
}
rollback(){ echo 'Bijwerken mislukt; eerdere versie wordt teruggezet.' >&2; pct exec "$CTID" -- bash -c "rm -rf '$SITE' && cp -a '$BACKUP' '$SITE' && chown -R voorraadthuis:voorraadthuis '$SITE'"; pct exec "$CTID" -- systemctl restart voorraadthuis; exit 1; }
# Eerst alles klaarzetten en controleren; de draaiende app blijft ondertussen in de lucht.
pct exec "$CTID" -- rm -rf "$STAGE"
pct exec "$CTID" -- install -d -o voorraadthuis -g voorraadthuis "$STAGE/public" "$STAGE/recipe-data" "${STAGE}/product-data"
for f in server.js wardrobe.js keuken.js weer.js barcodes.js profiles.js platen.js eigen-recepten.js agenda.js package.json recipes-international.js recipes-open.js public/index.html "${ASSETS[@]}"; do pct push "$CTID" "$TMP/$f" "$STAGE/$f" --perms 644; done
for f in unitools-recipes.json "wikibooks-en-recipes.json" "wikibooks-es-recipes.json" "wikibooks-de-recipes.json" "wikibooks-nl-recipes.json" "wikibooks-fr-recipes.json" "wikibooks-it-recipes.json" "wikibooks-ca-recipes.json" "wikibooks-pt-recipes.json" "wikibooks-ja-recipes.json" "wikibooks-pl-recipes.json" "wikibooks-sv-recipes.json" "wikibooks-nb-recipes.json" "wikibooks-fi-recipes.json" "wikibooks-cocktails-recipes.json" "wikibooks-borrelhapjes-recipes.json" translations-nl.json; do pct push "$CTID" "$TMP/recipe-data/$f" "$STAGE/recipe-data/$f" --perms 644; done
# Huismerktabel van Nederlandse supermarkten (open data uit Open Food Facts).
for f in nl-huismerken.json winkelprefixen.json lp-barcodes.json; do pct push "$CTID" "$TMP/product-data/$f" "$STAGE/product-data/$f" --perms 644; done
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
  # Ruim de tijd nemen: op een kleine container duurt het laden van het receptenboek even,
  # en een te vroege conclusie kostte eerder een goede bijwerking.
  ok=0
  for _ in $(seq 1 60); do
    if proef "http://$IP/healthz" '^ok$'; then ok=1; break; fi
    sleep 2
  done
  [ "$ok" = 1 ] || { echo 'App-healthcheck mislukt: de app antwoordt niet binnen twee minuten op poort 80.' >&2; diagnose; rollback; }
  # Antwoordt er iets anders dan de app op poort 80, dan is dit de verkeerde container
  # of staat er nog een webserver voor; eerst inrichten met provision-voorraadthuis.sh.
  koppen "http://$IP/healthz" '^x-voorraadthuis: app' || { echo 'Op poort 80 antwoordt niet de VoorraadThuis-app (achtergebleven webserver?). Draai eerst: provision-voorraadthuis.sh '"$CTID"'.' >&2; diagnose; rollback; }
  proef "http://$IP/" 'VoorraadThuis' || { echo 'App-pagina niet gevonden op / (staat index.html in /var/www/voorraadthuis/public?).' >&2; rollback; }
  proef "http://$IP/api/products" '^\[' || { echo 'API-test mislukt.' >&2; rollback; }
  proef "http://$IP/api/barcode/8710400058519" 'found' || { echo 'Barcodeherkenning niet bereikbaar.' >&2; rollback; }
  proef "http://$IP/favicon.svg" '<svg' || { echo 'App-pictogram niet bereikbaar.' >&2; rollback; }
  proef "http://$IP/manifest.webmanifest" '"display"' || { echo 'Webapp-manifest niet bereikbaar.' >&2; rollback; }
  # Draait de app ook echt de nieuwe versie? Een oude service die nog op poort 80 luistert
  # laat de pagina wel nieuw lijken (die komt van schijf), maar de nieuwe routes ontbreken
  # dan: op de pagina staat dan wel 'Wat kan ik koken?', maar de knop geeft niets terug.
  # Daarom vergelijken we hier de bestanden die de app uitserveert met wat we net ophaalden.
  nieuweVersieDraait(){
    proef "http://$IP/api/kookpot?max=2&aantal=1" '"samenvatting"' || return 1
    curl -fsS --max-time 20 -H 'Cache-Control: no-cache' "http://$IP/sw.js" -o "$TMP/sw-gediend.js" 2>/dev/null || return 1
    cmp -s "$TMP/sw-gediend.js" "$TMP/public/sw.js"
  }
  if ! nieuweVersieDraait; then
    echo 'De nieuwe versie draait nog niet; ik start de app nog een keer opnieuw.' >&2
    pct exec "$CTID" -- systemctl restart voorraadthuis
    ok2=0
    for _ in $(seq 1 60); do
      if proef "http://$IP/healthz" '^ok$'; then ok2=1; break; fi
      sleep 2
    done
    if [ "$ok2" != 1 ] || ! nieuweVersieDraait; then
      echo 'De bestanden staan goed, maar op poort 80 antwoordt nog een oudere versie.' >&2
      echo 'Kijk welk proces daar luistert en wat de service start:' >&2
      echo "  pct exec $CTID -- ss -ltnp | grep ':80'" >&2
      echo "  pct exec $CTID -- systemctl cat voorraadthuis" >&2
      diagnose
      exit 1
    fi
    echo 'De app draait nu de nieuwe versie.'
  fi
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
