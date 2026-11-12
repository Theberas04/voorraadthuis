#!/bin/bash
# Werkt een VoorraadThuis-installatie in de container zelf bij vanaf GitHub.
#
# Wordt als root gestart door voorraadthuis-update.service, die op zijn beurt door de
# padunit voorraadthuis-update.path wordt getriggerd zodra de app het bestand
# 'update-aanvraag' in zijn gegevensmap schrijft. Zo kan de knop in het beheergedeelte
# bijwerken zonder dat de app zelf rechten krijgt: hij schrijft alleen een vlagbestand.
#
# Voortgang gaat naar /var/lib/voorraadthuis/update-log.txt, zodat de app kan laten zien
# wat er gebeurd is. Mislukt de nieuwe versie, dan gaat de vorige automatisch terug.
#
# Alleen voor een installatie zoals deploy/proxmox/ die aanlegt. In de proefopstelling
# zijn SITE, DATA, HERSTART en de bestandspaden over te schrijven.
set -Eeuo pipefail

SITE=${SITE:-/var/www/voorraadthuis}
SERVICE=${SERVICE:-voorraadthuis}
GEBRUIKER=${GEBRUIKER:-voorraadthuis}
DATA=${DATA:-/var/lib/voorraadthuis}
REPO=${REPO:-Theberas04/voorraadthuis}
LOGBESTAND=${LOGBESTAND:-$DATA/update-log.txt}
VERSIE_BESTAND=${VERSIE_BESTAND:-$SITE/VERSIE}
VRAAG=${VRAAG:-$DATA/update-aanvraag}
HERSTART=${HERSTART:-1}
POORT=${POORT:-80}

STAGE=$(mktemp -d /tmp/voorraadthuis-update-XXXXXX)
NIEUW="$STAGE/nieuw"
log(){ printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
opruimen(){ rm -rf "$STAGE"; }
trap opruimen EXIT

install -d -m 755 "$DATA"
: >> "$LOGBESTAND"
chmod 644 "$LOGBESTAND" 2>/dev/null || true

uitvoer(){ log "$*" | tee -a "$LOGBESTAND" >&2; }

GEWENST=main
if [ -s "$VRAAG" ]; then
  EERSTE=$(head -n1 "$VRAAG" | tr -d '\r\n')
  case "$EERSTE" in ''|main) GEWENST=main;; *)
    if printf '%s' "$EERSTE" | grep -Eq '^[0-9a-f]{7,40}$'; then GEWENST="$EERSTE"; fi;;
  esac
fi

uitvoer "Bijwerken gestart (gevraagd: $GEWENST)."

# 1. De bron ophalen en uitpakken; de draaiende app blijft ondertussen gewoon werken.
mkdir -p "$NIEUW"
if ! curl -fsSL --max-time 180 -o "$STAGE/bron.tgz" "https://codeload.github.com/$REPO/tar.gz/$GEWENST" 2>>"$LOGBESTAND"; then
  uitvoer "Mislukt: de nieuwe versie kon niet gedownload worden van GitHub."
  exit 1
fi
if ! tar -xzf "$STAGE/bron.tgz" -C "$NIEUW" --strip-components=1 2>>"$LOGBESTAND"; then
  uitvoer "Mislukt: het gedownloade bestand is geen geldig pakket."
  exit 1
fi
if [ ! -s "$NIEUW/server.js" ] || [ ! -s "$NIEUW/public/index.html" ]; then
  uitvoer "Mislukt: het pakket mist server.js of public/index.html."
  exit 1
fi
if ! node --check "$NIEUW/server.js" 2>>"$LOGBESTAND"; then
  uitvoer "Mislukt: server.js in de nieuwe versie is geen geldige JavaScript."
  exit 1
fi

# 2. Welke versie is dit? De commit-metadata komt van de GitHub-API (openbaar, geen sleutel).
VIA_API=$(curl -fsSL --max-time 20 -H 'Accept: application/vnd.github+json' -H 'User-Agent: VoorraadThuis-bijwerk' \
  "https://api.github.com/repos/$REPO/commits/$GEWENST" 2>>"$LOGBESTAND" || true)
if [ -n "$VIA_API" ]; then
  META=$(printf '%s' "$VIA_API" | node -e 'let t="";process.stdin.on("data",d=>t+=d).on("end",()=>{try{const d=JSON.parse(t);process.stdout.write([d.sha||"",(d.commit&&d.commit.author&&d.commit.author.date)||"",((d.commit&&d.commit.message)||"").split("\n")[0]].map(s=>String(s).replace(/[\t\n\r]/g," ")).join("\t"))}catch{}})' 2>/dev/null || true)
else
  META=""
fi
IFS=$'\t' read -r SHA DATUM ONDERWERP <<< "${META:-}"
[ -n "${SHA:-}" ] || SHA="$GEWENST"

# 3. Wisselen: eerst een volledige kopie van de huidige versie als terugvaloptie.
uitvoer "Nieuwe versie ${SHA:0:7} klaargezet; de app wordt nu herstart."
if [ "$HERSTART" = "1" ]; then
  systemctl stop "$SERVICE" || true
fi
rm -rf "$DATA/backup-vorige"
mkdir -p "$DATA/backup-vorige"
cp -a "$SITE/." "$DATA/backup-vorige/" 2>>"$LOGBESTAND" || true

terugzetten(){
  uitvoer "Mislukt: de nieuwe versie startte niet; de vorige versie wordt teruggezet."
  if [ "$HERSTART" = "1" ]; then
    systemctl stop "$SERVICE" || true
  fi
  rm -rf "$SITE"
  mkdir -p "$SITE"
  cp -a "$DATA/backup-vorige/." "$SITE/" 2>>"$LOGBESTAND" || true
  chown -R "$GEBRUIKER:$GEBRUIKER" "$SITE" 2>/dev/null || true
  if [ "$HERSTART" = "1" ]; then
    systemctl start "$SERVICE" || true
  fi
  uitvoer "Klaar: de vorige versie draait weer."
}

rm -rf "$SITE"
mkdir -p "$SITE"
cp -a "$NIEUW/." "$SITE/" 2>>"$LOGBESTAND" || true
printf '%s\n%s\n%s\n' "$SHA" "${DATUM:-$(date -Is)}" "${ONDERWERP:-Geen omschrijving}" > "$VERSIE_BESTAND"
chown -R "$GEBRUIKER:$GEBRUIKER" "$SITE" 2>/dev/null || true
chmod 644 "$VERSIE_BESTAND" 2>/dev/null || true

if [ "$HERSTART" != "1" ]; then
  uitvoer "Klaar: bestanden bijgewerkt naar ${SHA:0:7} (zonder herstart, proefopstelling)."
  rm -f "$VRAAG"
  exit 0
fi

systemctl start "$SERVICE" || true
GELUKT=0
for _ in $(seq 1 45); do
  if curl -fsS --max-time 5 "http://127.0.0.1:$POORT/healthz" 2>/dev/null | grep -qi '^ok$'; then GELUKT=1; break; fi
  sleep 2
done
if [ "$GELUKT" != "1" ]; then
  terugzetten
  rm -f "$VRAAG"
  exit 1
fi

uitvoer "Klaar: versie ${SHA:0:7} draait (${ONDERWERP:-geen omschrijving})."
rm -f "$VRAAG"
exit 0
