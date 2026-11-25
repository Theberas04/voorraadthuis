#!/usr/bin/env bash
# Ververs de Discogs-vinylcatalogus van VoorraadThuis: nieuwste maandelijkse dump ->
# alleen-lezen database -> release-asset -> de pin in het ophaalscript en de cijfers in het README.
#
# Draai dit waar gh en de repo staan (de Hermes-container), als de gebruiker die bij GitHub mag:
#   bash scripts/ververs-discogs-catalogus.sh                # nieuwste dump; niets publiceren (proef)
#   bash scripts/ververs-discogs-catalogus.sh --doen          # echt publiceren, pin bijwerken, pushen
#   bash scripts/ververs-discogs-catalogus.sh --datum 2026-11-01 --doen
#   bash scripts/ververs-discogs-catalogus.sh --hergebruik --doen   # database staat er al; niet opnieuw bouwen
#
# Zonder --doen gebeurt alles behalve publiceren en pushen: de dump wordt opgehaald, de database
# gebouwd en het verslag (met aantallen en SHA-256) geschreven, zodat je het kunt nakijken.
# Met --hergebruik wordt niet opnieuw gebouwd: de database en het verslag in de werkmap worden
# gebruikt (met controle dat de asset bij het verslag hoort). Handig als publiceren of pushen
# eerder misliep, of als je na een geslaagde bouw alleen nog wilt publiceren.
set -euo pipefail

WERKMAP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$WERKMAP"
WERKDIR="${DISCOGS_WERKMAP:-/home/hermes/discogs-work}"
REPO="Theberas04/voorraadthuis"
DOEN=0
MELD=0
HERGEBRUIK=0
DATUM=""

while [ $# -gt 0 ]; do
  case "$1" in
    --doen) DOEN=1 ;;
    --meld) MELD=1 ;;
    --hergebruik) HERGEBRUIK=1 ;;
    --datum) DATUM="${2:-}"; shift ;;
    --werkmap) WERKDIR="${2:-}"; shift ;;
    *) printf 'Onbekende optie: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

zeg() { printf '%s\n' "$*"; }
meld() {
  # --meld: het resultaat ook naar de meldkamer sturen. Dat gebeurt met 'hermes send',
  # dat de inloggegevens van de gateway hergebruikt en zonder draaiende gateway werkt.
  [ "$MELD" = "1" ] || return 0
  command -v hermes >/dev/null 2>&1 || { zeg "(geen hermes in het pad; melding overgeslagen)"; return 0; }
  printf '%s\n' "$*" | hermes send -t "${MELD_AAN:-slack}" -s "Discogs-vinylcatalogus" || true
}
stop() { printf '[fout] %s\n' "$*" >&2; meld "De maandelijkse Discogs-verversing is misgelopen: $*"; exit 1; }

command -v gh >/dev/null 2>&1 || stop "gh ontbreekt; zet ~/.local/bin in je pad."
mkdir -p "$WERKDIR"
UIT="$WERKDIR/discogs-vinyl.sqlite"
VERSLAG="$WERKDIR/discogs-catalogus-verslag.json"

# --- 1. Welke maand? -----------------------------------------------------------
if [ -z "$DATUM" ] && [ "$HERGEBRUIK" = "1" ]; then
  [ -s "$VERSLAG" ] || stop "Hergebruik gevraagd, maar het verslag $VERSLAG bestaat niet."
  DATUM="$(python3 -c "import json;print(json.load(open('$VERSLAG')).get('dumpdatum',''))")"
  DATUM="${DATUM:0:4}-${DATUM:4:2}-${DATUM:6:2}"
fi
if [ -z "$DATUM" ]; then
  jaar="$(date +%Y)"
  bestand=""
  for j in "$jaar" "$((jaar - 1))"; do
    bestand="$(curl -s --max-time 30 "https://data.discogs.com/?prefix=data/$j/" | grep -o "discogs_[0-9]\{8\}_releases\.xml\.gz" | sort | tail -1 || true)"
    [ -n "$bestand" ] && break
  done
  [ -n "$bestand" ] || stop "Geen dump gevonden in de lijst van data.discogs.com."
  ruw="${bestand#discogs_}"; ruw="${ruw%%_*}"
  DATUM="${ruw:0:4}-${ruw:4:2}-${ruw:6:2}"
fi
TAG="discogs-$DATUM"
RUWDATUM="${DATUM//-/}"
DUMP="$WERKDIR/discogs_${RUWDATUM}_releases.xml.gz"
zeg "== Discogs-vinylcatalogus verversen ($DATUM) =="

# --- 2. Al gedaan? -------------------------------------------------------------
AL_GEPUBLICEERD=0
if gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
  if grep -q "discogs-$DATUM" deploy/proxmox/fetch-discogs-catalog.sh; then
    zeg "De release $TAG bestaat al en de pin staat erop; er is niets te doen."
    exit 0
  fi
  # Bijvoorbeeld na een misgelopen publicatie: de release staat er, de rest nog niet.
  zeg "De release $TAG bestaat al, maar de pin staat er nog niet op: ik zet de pin, de cijfers en de push recht."
  AL_GEPUBLICEERD=1
fi

if [ "$HERGEBRUIK" = "1" ]; then
  # --- 3b. Niets bouwen: de bestaande database en het verslag gebruiken --------
  [ -s "$UIT" ] || stop "Hergebruik gevraagd, maar de database $UIT bestaat niet."
  zeg "Hergebruik: database en verslag staan er al, er wordt niets opnieuw gebouwd."
  ASSET="$WERKDIR/discogs-vinyl-${RUWDATUM}.sqlite.gz"
  if [ ! -s "$ASSET" ] && [ -s "$UIT.gz" ]; then mv -f "$UIT.gz" "$ASSET"; fi
  [ -s "$ASSET" ] || stop "Hergebruik gevraagd, maar de asset $ASSET bestaat niet."
  SHA="$(sha256sum "$ASSET" | cut -d' ' -f1)"
  VERWACHT_SHA="$(python3 -c "import json;print(json.load(open('$VERSLAG')).get('gz_sha256',''))")"
  if [ -n "$VERWACHT_SHA" ] && [ "$VERWACHT_SHA" != "$SHA" ]; then
    stop "De asset hoort niet bij het verslag ($SHA tegen $VERWACHT_SHA)."
  fi
  zeg "Asset: $ASSET ($(du -h "$ASSET" | cut -f1), sha256 $SHA)"
else

# --- 3. Ophalen en controleren -------------------------------------------------
if [ ! -s "$DUMP" ]; then
  zeg "Ophalen: $DUMP"
  curl -L --fail --retry 5 --retry-delay 10 -C - -o "$DUMP" \
    "https://data.discogs.com/?download=data%2F$(date -d "$DATUM" +%Y)%2Fdiscogs_${RUWDATUM}_releases.xml.gz"
else
  zeg "De dump staat er al: $DUMP"
fi
if [ ! -s "$WERKDIR/CHECKSUM.txt" ]; then
  curl -s --max-time 30 -o "$WERKDIR/CHECKSUM.txt" \
    "https://data.discogs.com/?download=data%2F$(date -d "$DATUM" +%Y)%2Fdiscogs_${RUWDATUM}_CHECKSUM.txt" || true
fi
verwacht="$(awk -v n="discogs_${RUWDATUM}_releases.xml.gz" '$2 == n {print $1}' "$WERKDIR/CHECKSUM.txt" || true)"
if [ -n "$verwacht" ]; then
  zeg "Controlegetal van de dump controleren..."
  echo "$verwacht  $DUMP" | sha256sum --check --status || stop "De dump heeft niet het verwachte SHA-256."
  zeg "De dump is compleet en klopt."
else
  zeg "Let op: geen controlegetal gevonden; de grootte is $(du -h "$DUMP" | cut -f1)."
fi

# --- 4. Bouwen -----------------------------------------------------------------
rm -f "$UIT" "$UIT.gz"
zeg "Bouwen (dit duurt een paar uur)..."
python3 scripts/bouw-discogs-vinylcatalogus.py --dump "$DUMP" --uit "$UIT" --verslag "$VERSLAG"

ASSET="$WERKDIR/discogs-vinyl-${RUWDATUM}.sqlite.gz"
mv -f "$UIT.gz" "$ASSET"
SHA="$(sha256sum "$ASSET" | cut -d' ' -f1)"
zeg "Asset: $ASSET ($(du -h "$ASSET" | cut -f1), sha256 $SHA)"
fi

# --- 5. Publiceren -------------------------------------------------------------
NOTITIES="Alleen-lezen Discogs-vinylcatalogus voor zoekresultaten, uit de release-dump van $(date -d "$DATUM" "+%-d %B %Y"). Geen hoesafbeeldingen, geen gebruikers- of marketplacegegevens. Licentie en attributie: product-data/README.md."
if [ "$DOEN" = "1" ]; then
  if [ "$AL_GEPUBLICEERD" = "1" ]; then
    zeg "Publiceren overgeslagen: $TAG bestaat al."
    if ! gh release view "$TAG" -R "$REPO" --json assets --jq '.assets[].name' | grep -qx "$(basename "$ASSET")"; then
      zeg "De asset ontbreekt bij $TAG; ik zet hem erbij."
      gh release upload "$TAG" "$ASSET" -R "$REPO" --clobber
    fi
  else
    zeg "Publiceren: $TAG"
    # Eerst de release, daarna de asset apart: 'gh release create <tag> <bestand>' liet de
    # GitHub-API hier met een 500 klappen, deze twee stappen werken wel. Met herkansingen,
    # want de API geeft af en toe een tijdelijke 500.
    for poging in 1 2 3; do
      if gh release create "$TAG" -R "$REPO" \
        --title "Discogs-vinylcatalogus $DATUM" --notes "$NOTITIES"; then
        break
      fi
      if [ "$poging" = "3" ]; then
        stop "De release $TAG kon niet aangemaakt worden."
      fi
      zeg "Poging $poging mislukte; ik probeer het zo opnieuw."
      sleep 15
    done
    zeg "Asset uploaden: $ASSET ($(du -h "$ASSET" | cut -f1))"
    gh release upload "$TAG" "$ASSET" -R "$REPO" || stop "De asset kon niet bij de release gezet worden."
  fi
else
  zeg "[proef] Ik zou nu publiceren: gh release create $TAG $ASSET"
fi

# --- 6. De pin en de cijfers bijwerken ----------------------------------------
python3 - "$DATUM" "$RUWDATUM" "$SHA" "$VERSLAG" "$DOEN" <<'PY'
import json, pathlib, re, sys
datum, ruwdatum, sha, verslagpad, doen = sys.argv[1:6]
verslag = json.loads(pathlib.Path(verslagpad).read_text('utf-8'))
maanden = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december']
jaar, maand, dag = (int(deel) for deel in datum.split('-'))
mooi = f"{dag} {maanden[maand-1]} {jaar}"
d = lambda n: f"{n:,}".replace(',', '.')
asset = f"discogs-vinyl-{ruwdatum}.sqlite.gz"
url = f"https://github.com/Theberas04/voorraadthuis/releases/download/discogs-{datum}/{asset}"

# het ophaalscript
pad = pathlib.Path('deploy/proxmox/fetch-discogs-catalog.sh')
tekst = pad.read_text('utf-8')
tekst = re.sub(r'CATALOG_URL="\$\{DISCOGS_CATALOG_URL:-[^}]*\}"',
               f'CATALOG_URL="${{DISCOGS_CATALOG_URL:-{url}}}"', tekst)
tekst = re.sub(r'CATALOG_SHA256="\$\{DISCOGS_CATALOG_SHA256:-[^}]*\}"',
               f'CATALOG_SHA256="${{DISCOGS_CATALOG_SHA256:-{sha}}}"', tekst)
pad.write_text(tekst, 'utf-8')

# het README-blok
pad = pathlib.Path('product-data/README.md')
tekst = pad.read_text('utf-8')
regels = [
    '## Discogs-vinylcatalogus',
    '',
    f'De release-asset `{asset}` bevat een lokale, alleen-lezen zoekcatalogus uit de maandelijkse Discogs-release-dump van {mooi}. Discogs stelt zijn maandelijkse XML-dumps van release-, artiest-, label- en mastergegevens beschikbaar onder CC0 No Rights Reserved.[1] De voorwaarden onderscheiden CC0-catalogusgegevens — waaronder release-titels, formaten en barcodes — van restricted user-, marketplace- en beeldgegevens.[2] De CC0-deed staat kopiëren, aanpassen en verspreiden toe; we behouden daarnaast expliciet de bronvermelding.[3]',
    '',
    f"- **{d(verslag['rijen'])}** unieke koppelingen tussen een geldige vinylbarcode en een release-ID, met **{d(verslag['unieke_barcodes'])}** verschillende geldige vinylbarcodes. Daarvan zijn **{d(verslag.get('nieuw_tov_musicbrainz', 0))}** barcodes nieuw ten opzichte van de lokale MusicBrainz-barcodelijst; **{d(verslag.get('in_beide', 0))}** kwamen in beide voor.",
    f"- Alleen GTIN-8/12/13/14 met geldig controlecijfer zijn opgenomen; identifiers die uitsluitend uit herhaalde identieke cijfers bestaan zijn als placeholders geweerd ({verslag.get('placeholder_codes', 0)} codes, {verslag.get('placeholder', 0)} releasekoppelingen). Discogs schrijft barcodes soms met spaties en streepjes — daarvan worden alleen de cijfers bewaard, zodat een scan altijd past.",
    '- Eén barcode kan bij meerdere persingen horen en één uitgave kan meerdere barcodes hebben; de database bewaart daarom regels per barcode én release-ID, en alle barcodes van een uitgave staan erin. Zoekt de app op een code met andere voorloopnullen, dan probeert ze die varianten zelf. Een barcode-opzoeking kiest deterministisch één match; tekstzoekresultaten kunnen meerdere uitgaven tonen.',
    '- Alleen metadata wordt opgenomen (barcode, release-ID, titel, artiest, jaar, label, formaat, genre en stijl). Er worden geen Discogs-hoesafbeeldingen, gebruikersgegevens of marketplacegegevens in de catalogus gezet; zoekresultaten veranderen de persoonlijke verzameling niet.',
    '- De app toont **Discogs** als bron en linkt per resultaat naar de bijbehorende releasepagina. De SQLite-database staat als release-asset buiten de Git-boom; het Proxmox-helper-script controleert de SHA-256 en database vóór installatie.',
    '',
]
nieuw = '\n'.join(regels) + '\n'
patroon = re.compile(r'## Discogs-vinylcatalogus\n.*?\n(?=## Opnieuw opbouwen)', re.S)
if not patroon.search(tekst):
    raise SystemExit('Het blok Discogs-vinylcatalogus in product-data/README.md is niet gevonden.')
pad.write_text(patroon.sub(nieuw, tekst, count=1), 'utf-8')
print('[bijgewerkt] deploy/proxmox/fetch-discogs-catalog.sh en product-data/README.md')
PY

# --- 7. Controle en publicatie van de repo ------------------------------------
zeg "Tests draaien..."
node --test test/*.test.js > "$WERKDIR/tests.log" 2>&1 || { tail -30 "$WERKDIR/tests.log"; stop "De proeven zakten; zie $WERKDIR/tests.log"; }
grep -E "^# (tests|pass|fail)" "$WERKDIR/tests.log" || true

if [ "$DOEN" = "1" ]; then
  # De bestanden die deze wikkel beheert: de pin, de cijfers in het README en de pijplijn zelf.
  git add deploy/proxmox/fetch-discogs-catalog.sh product-data/README.md \
    scripts/ververs-discogs-catalogus.sh scripts/bouw-discogs-vinylcatalogus.py test/discogs-bouwer.test.js
  git -c user.name="Hermes" -c user.email="hermes@werdensmedia.net" commit \
    -m "Discogs-vinylcatalogus bijgewerkt naar de dump van $DATUM" \
    -m "Release-asset discogs-vinyl-${RUWDATUM}.sqlite.gz met $(python3 -c "import json;v=json.load(open('$VERSLAG'));print(f\"{v['rijen']} koppelingen en {v['unieke_barcodes']} unieke barcodes\")")." \
    >/dev/null
  git push origin main
  zeg "Gepusht."
else
  zeg "[proef] Ik zou nu committen en pushen; draai met --doen om dat echt te doen."
fi
zeg "Klaar: $TAG"

# --- 8. Melden ----------------------------------------------------------------
RIJEN="$(python3 -c "import json;v=json.load(open('$VERSLAG'));print(f\"{v['rijen']:,}\".replace(',','.'))")"
UNIEK="$(python3 -c "import json;v=json.load(open('$VERSLAG'));print(f\"{v['unieke_barcodes']:,}\".replace(',','.'))")"
NIEUW="$(python3 -c "import json;v=json.load(open('$VERSLAG'));print(f\"{v.get('nieuw_tov_musicbrainz',0):,}\".replace(',','.'))")"
PROEF=""
[ "$DOEN" = "1" ] || PROEF=" (proefstand: niets gepubliceerd of gepusht)"
MELDTEKST="De Discogs-vinylcatalogus is bijgewerkt naar de dump van $DATUM$PROEF."
MELDTEKST="$MELDTEKST"$'\n\n'"- $RIJEN koppelingen tussen barcode en release-ID, $UNIEK unieke vinylbarcodes"
MELDTEKST="$MELDTEKST"$'\n'"- waarvan $NIEUW nieuw ten opzichte van de MusicBrainz-lijst"
MELDTEKST="$MELDTEKST"$'\n'"- release: $TAG (asset $(du -h "$ASSET" | cut -f1))"
MELDTEKST="$MELDTEKST"$'\n'"- de pin in fetch-discogs-catalog.sh is bijgewerkt; een Bijwerken in de app haalt de nieuwe catalogus op"
meld "$MELDTEKST"
