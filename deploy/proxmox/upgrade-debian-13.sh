#!/usr/bin/env bash
# Zet de Debian-versie van de VoorraadThuis-container om van 12 (bookworm) naar
# 13 (trixie), zonder de app of de database kwijt te raken.
#
# Draaien als root op de Proxmox-host:
#   bash upgrade-debian-13.sh <CTID>
# Of rechtstreeks vanaf GitHub:
#   bash <(curl -fsSL -H 'Accept: application/vnd.github.raw' \
#     https://api.github.com/repos/Theberas04/voorraadthuis/contents/deploy/proxmox/upgrade-debian-13.sh) 101
#
# Voor de sprong wordt een momentopname (snapshot) gemaakt; lukt de app na de
# sprong niet, dan komt de momentopname automatisch terug (uit te zetten met
# GEEN_TERUG=1). Zonder momentopname wordt er niet begonnen, tenzij je
# ZONDER_SNAPSHOT=1 meegeeft.
set -euo pipefail

CTID="${1:-${CTID:-}}"
SITE=/var/www/voorraadthuis
VANAF_CODENAAM=bookworm
DOEL_CODENAAM=trixie
DOEL_VERSIE=13
ZONDER_SNAPSHOT="${ZONDER_SNAPSHOT:-0}"
GEEN_TERUG="${GEEN_TERUG:-0}"
# DROOG=1: alleen kijken wat er zou gebeuren (pakketbronnen nakijken), niets installeren.
DROOG="${DROOG:-0}"
STAMP=$(date +%Y%m%d-%H%M)
SNAPSHOT="voor-debian${DOEL_VERSIE}-${STAMP}"
LOGBESTAND="/root/debian${DOEL_VERSIE}-upgrade-${STAMP}.log"

log(){ printf '\033[1;36m==>\033[0m %s\n' "$*"; }
waarschuw(){ printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die(){ printf '\033[1;31m[fout]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Draai als root op de Proxmox-host."
[ -n "$CTID" ] || die "Gebruik: $0 <CTID>"
command -v pct >/dev/null || die "pct niet gevonden; dit script hoort op de Proxmox-host te draaien."
pct status "$CTID" >/dev/null 2>&1 || die "Container $CTID bestaat niet."
[ "$(pct status "$CTID")" = 'status: running' ] || die "Container $CTID draait niet; start hem eerst."

in_container(){ pct exec "$CTID" -- "$@"; }
if [ "$DROOG" = 1 ]; then log "DROGE PROEF: er wordt niets geïnstalleerd en niets opnieuw opgestart."; fi

HUIDIGE_VERSIE=$(in_container cat /etc/debian_version 2>/dev/null | tr -d '\r\n' || true)
HUIDIGE_CODENAAM=$(in_container bash -lc '. /etc/os-release 2>/dev/null; printf "%s" "${VERSION_CODENAME:-}"' || true)
[ -n "$HUIDIGE_VERSIE" ] || die "Kon de Debian-versie in container $CTID niet lezen."
log "Container $CTID draait Debian $HUIDIGE_VERSIE (${HUIDIGE_CODENAAM:-onbekend})."

if [ "$HUIDIGE_CODENAAM" = "$DOEL_CODENAAM" ] || [ "${HUIDIGE_VERSIE%%.*}" = "$DOEL_VERSIE" ]; then
  log "Deze container draait al Debian $DOEL_VERSIE; er is niets te doen."
  exit 0
fi
[ "$HUIDIGE_CODENAAM" = "$VANAF_CODENAAM" ] || die "Alleen de sprong van Debian 12 ($VANAF_CODENAAM) naar $DOEL_VERSIE ($DOEL_CODENAAM) wordt ondersteund; deze container staat op ${HUIDIGE_CODENAAM:-onbekend}."

# 1. Momentopname: de enige echte terugweg bij een mislukte systeemsprong.
if [ "$ZONDER_SNAPSHOT" = 1 ]; then
  waarschuw "ZONDER_SNAPSHOT=1: er wordt geen momentopname gemaakt; terugzetten kan dan niet."
else
  log "Momentopname maken ($SNAPSHOT)…"
  if pct snapshot "$CTID" "$SNAPSHOT" >/dev/null 2>&1; then
    log "Momentopname $SNAPSHOT gemaakt."
  else
    die "Geen momentopname mogelijk op deze opslag. Er is niets gewijzigd. Draai opnieuw met ZONDER_SNAPSHOT=1 als je het toch wilt proberen (dan is er geen terugweg)."
  fi
fi

# 2. Een kopie van de database, zowel in de container als hier op de host.
log "Database veiligstellen…"
in_container install -d -m 700 /root/voor-debian13
in_container systemctl stop voorraadthuis 2>/dev/null || true
in_container bash -c "if [ -f /var/lib/voorraadthuis/voorraad.db ]; then cp -a /var/lib/voorraadthuis/voorraad.db /root/voor-debian13/voorraad.db; rm -f /root/voor-debian13/voorraad.db-wal /root/voor-debian13/voorraad.db-shm; fi"
in_container bash -c "[ -d $SITE ] && tar -czf /root/voor-debian13/app.tar.gz -C $SITE . 2>/dev/null || true"
pct pull "$CTID" /root/voor-debian13/voorraad.db "/root/voorraadthuis-voor-debian${DOEL_VERSIE}-${STAMP}.db" >/dev/null 2>&1 \
  || waarschuw "Kon geen kopie van de database naar de host halen; de kopie in de container staat in /root/voor-debian13/."

# 3. Het binnenwerk van de sprong, als los script de container in (geen geknoei met quotes).
TMP=$(mktemp -d); PROEF=$(mktemp); trap 'rm -rf "$TMP" "$PROEF"' EXIT
cat > "$TMP/binnen.sh" <<'BINNEN'
#!/usr/bin/env bash
# Draait ín de container. Zet Debian 12 om naar Debian 13.
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive
APT_OPTS=(-y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold)
stap(){ printf '\n== %s ==\n' "$*"; }
fout(){ printf '[fout] %s\n' "$*" >&2; exit "${2:-1}"; }

stap "0/4 Uitgangspunt"
# Voor een droge proef zijn deze twee te verzetten; in de container staan ze goed.
VERSIE_BESTAND="${VERSIE_BESTAND:-/etc/debian_version}"
OS_RELEASE="${OS_RELEASE:-/etc/os-release}"
cat "$VERSIE_BESTAND"
. "$OS_RELEASE" 2>/dev/null || true
echo "codenaam: ${VERSION_CODENAME:-onbekend}"
if [ "${VERSION_CODENAME:-}" = trixie ]; then echo '@@ AL KLAAR @@'; exit 0; fi
[ "${VERSION_CODENAME:-}" = bookworm ] || fout "deze container staat niet op bookworm maar op ${VERSION_CODENAME:-onbekend}" 2

stap "1/4 Debian 12 helemaal bijwerken vóór de sprong"
if [ "${DROOG:-0}" = 1 ]; then
  echo "  (droge proef: er wordt niets bijgewerkt)"
else
  apt-get update -qq || fout "apt-get update mislukte (Debian 12)" 3
  apt-get "${APT_OPTS[@]}" full-upgrade -qq || fout "full-upgrade op Debian 12 mislukte" 4
  apt-get "${APT_OPTS[@]}" autoremove -qq || true
fi

stap "2/4 Pakketbronnen omzetten naar trixie"
# BRONNEN staat standaard op /etc/apt; alleen voor een droge proef te verzetten.
BRONNEN="${BRONNEN:-/etc/apt}"
BEWAAR="${BEWAAR:-/root/voor-debian13/bronnen}"
mkdir -p "$BEWAAR"
gevonden=0
for f in "$BRONNEN/sources.list" "$BRONNEN"/sources.list.d/*.sources "$BRONNEN"/sources.list.d/*.list; do
  [ -f "$f" ] || continue
  grep -q 'bookworm' "$f" 2>/dev/null || continue
  cp -a "$f" "$BEWAAR/$(basename "$f").voor"
  sed -i 's/bookworm/trixie/g' "$f"
  echo "  $(basename "$f") -> trixie"
  gevonden=$((gevonden+1))
done
[ "$gevonden" -gt 0 ] || fout "geen enkele pakketbron noemde bookworm; niets om te zetten" 5
if grep -rlqs 'bookworm' "$BRONNEN/sources.list" "$BRONNEN"/sources.list.d/ 2>/dev/null; then
  fout "er staat nog een bron op bookworm: $(grep -rl 'bookworm' "$BRONNEN/sources.list" "$BRONNEN"/sources.list.d/ 2>/dev/null | tr '\n' ' ')" 6
fi
grep -rqs 'trixie' "$BRONNEN/sources.list" "$BRONNEN"/sources.list.d/ 2>/dev/null || fout "geen enkele bron staat nu op trixie" 7
if [ "${DROOG:-0}" = 1 ]; then
  echo "  bewaard in $BEWAAR (achteraf terug te zetten door .voor over het origineel te kopiëren)"
  echo '@@ DROGE PROEF: pakketbronnen kloppen; er is niets geïnstalleerd @@'
  exit 0
fi

stap "3/4 Debian 13 installeren (dit duurt een paar minuten)"
apt-get update -qq || fout "apt-get update mislukte na het omzetten van de bronnen" 8
if ! apt-get "${APT_OPTS[@]}" full-upgrade -qq; then
  fout "full-upgrade naar Debian 13 mislukte; de pakketbronnen staan nog goed, draai het opnieuw of zet de momentopname terug" 9
fi
apt-get "${APT_OPTS[@]}" --purge autoremove -qq || true
apt-get clean

stap "4/4 Controle"
echo "versie: $(cat "$VERSIE_BESTAND")"
echo "codenaam: $(. "$OS_RELEASE"; echo "${VERSION_CODENAME:-onbekend}")"
echo "node: $(node --version 2>/dev/null || echo ontbreekt)"
echo '@@ SPROOK GESLAAGD @@'
BINNEN
chmod +x "$TMP/binnen.sh"

if ! in_container bash -c 'true'; then die "De container antwoordt niet meer."; fi
pct push "$CTID" "$TMP/binnen.sh" /root/upgrade-binnen.sh --perms 700
if [ "$DROOG" = 1 ]; then
  set +e
  in_container bash -lc 'rm -rf /tmp/vt-droog-apt /tmp/vt-droog-bewaard
    mkdir -p /tmp/vt-droog-apt/sources.list.d
    cp -a /etc/apt/sources.list /tmp/vt-droog-apt/ 2>/dev/null || true
    cp -a /etc/apt/sources.list.d/. /tmp/vt-droog-apt/sources.list.d/ 2>/dev/null || true
    DROOG=1 BRONNEN=/tmp/vt-droog-apt BEWAAR=/tmp/vt-droog-bewaard bash /root/upgrade-binnen.sh'
  DROOGCODE=$?
  set -e
  in_container rm -rf /tmp/vt-droog-apt /tmp/vt-droog-bewaard >/dev/null 2>&1 || true
  in_container rm -f /root/upgrade-binnen.sh >/dev/null 2>&1 || true
  if [ "$DROOGCODE" = 0 ]; then
    log "Droge proef geslaagd: de bronnen kunnen omgezet worden. Er is niets gewijzigd. Draai hetzelfde commando zonder DROOG=1 om de sprong echt te maken."
  else
    die "Droge proef mislukte (code $DROOGCODE); de sprong is niet uitgevoerd en er is niets gewijzigd."
  fi
  exit 0
fi
log "Debian $DOEL_VERSIE installeren in container $CTID (dit duurt een paar minuten)…"
set +e
in_container bash -lc 'set -o pipefail; bash /root/upgrade-binnen.sh 2>&1 | tee /root/debian13-upgrade.log'
SPROOK=$?
set -e
if [ "$SPROOK" != 0 ]; then
  waarschuw "De systeemsprong is niet afgerond (code $SPROOK). Zie het logbestand in de container: /root/debian13-upgrade.log"
  if [ "$ZONDER_SNAPSHOT" != 1 ]; then
    log "Momentopname $SNAPSHOT terugzetten…"
    pct stop "$CTID" >/dev/null 2>&1 || true
    sleep 3
    pct rollback "$CTID" "$SNAPSHOT" >/dev/null 2>&1 || die "Terugzetten mislukte. Zet handmatig terug met: pct rollback $CTID $SNAPSHOT"
    pct start "$CTID" >/dev/null 2>&1 || true
    log "Teruggezet op Debian 12. Meld de fout hierboven; de app en de database zijn ongemoeid."
  fi
  exit 1
fi

# 4. Opnieuw opstarten en wachten tot de container terug is.
log "Container opnieuw opstarten…"
timeout 20 pct exec "$CTID" -- bash -lc 'systemctl reboot' >/dev/null 2>&1 || true
sleep 5
TERUG=0
for _ in $(seq 1 60); do
  sleep 3
  if in_container bash -c 'true' 2>/dev/null; then TERUG=1; break; fi
done
[ "$TERUG" = 1 ] || die "De container komt niet terug na het opnieuw opstarten. Zet de momentopname terug met: pct rollback $CTID $SNAPSHOT"

NIEUWE_VERSIE=$(in_container cat /etc/debian_version 2>/dev/null | tr -d '\r\n' || true)
NIEUWE_CODENAAM=$(in_container bash -lc '. /etc/os-release 2>/dev/null; printf "%s" "${VERSION_CODENAME:-}"' || true)
log "Container $CTID draait nu Debian $NIEUWE_VERSIE (${NIEUWE_CODENAAM:-onbekend})."

# 5. Node controleren: de app heeft node:sqlite nodig (Node 22.5 of nieuwer).
# De pakketbron van NodeSource (nodistro) blijft bij de sprong gewoon staan, maar
# Debian 13 heeft zelf nodejs 20 — als die het overneemt, zetten we 22 er weer op.
NODEV=$(in_container bash -lc 'node --version 2>/dev/null || echo ontbreekt')
log "Node-versie in de container: $NODEV"
case "$NODEV" in
  v22.[5-9]*|v22.[1-9][0-9]*|v2[3-9].*|v[3-9][0-9].*) ;;
  *)
    waarschuw "Node $NODEV is te oud voor de app (node:sqlite vraagt 22.5+); Node 22 opnieuw installeren…"
    in_container bash -lc 'export DEBIAN_FRONTEND=noninteractive; install -d -m 0755 /etc/apt/keyrings
      curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
      chmod a+r /etc/apt/keyrings/nodesource.gpg
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
      apt-get update -qq && apt-get install -y -qq nodejs' || waarschuw "Node opnieuw installeren mislukte."
    NODEV=$(in_container bash -lc 'node --version 2>/dev/null || echo ontbreekt')
    log "Node-versie nu: $NODEV"
    case "$NODEV" in
      v22.[5-9]*|v22.[1-9][0-9]*|v2[3-9].*|v[3-9][0-9].*) ;;
      *) die "De container draait Debian $NIEUWE_VERSIE, maar Node is $NODEV en dat is te oud voor de app (node:sqlite vraagt 22.5+). Zet Node 22 er handmatig op met: pct exec $CTID -- bash -lc 'curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg; echo \"deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main\" > /etc/apt/sources.list.d/nodesource.list; apt-get update -qq && apt-get install -y nodejs' en draai daarna check-voorraadthuis.sh $CTID." ;;
    esac
    ;;
esac

# 6. De app weer aanzetten en controleren.
log "App starten en controleren…"
in_container systemctl daemon-reload >/dev/null 2>&1 || true
in_container systemctl enable --now voorraadthuis >/dev/null 2>&1 || waarschuw "De dienst voorraadthuis wilde niet starten."
IP=$(in_container ip -4 -o addr show dev eth0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1 || true)
proef(){ curl -fsS --max-time 10 "$1" -o "$PROEF" 2>/dev/null || return 1; grep -Eqi "$2" "$PROEF"; }
proefTls(){ curl -fsSk --max-time 10 "$1" -o "$PROEF" 2>/dev/null || return 1; grep -Eqi "$2" "$PROEF"; }
[ -n "$IP" ] || waarschuw "Geen IPv4-adres gevonden; de app kan niet vanaf de host gecontroleerd worden."
ok=0
if [ -n "$IP" ]; then
  for _ in $(seq 1 30); do
    if proef "http://$IP/healthz" '^ok$'; then ok=1; break; fi
    sleep 2
  done
fi
TLS=geen
if [ -n "$IP" ] && proefTls "https://$IP/healthz" '^ok$'; then TLS=ok; fi

if [ "$ok" != 1 ]; then
  waarschuw "De app antwoordt niet op poort 80 in de container."
  printf '     node: ' >&2; in_container bash -lc 'node --version 2>/dev/null || echo ontbreekt' >&2 || true
  printf '     dienst: ' >&2; in_container systemctl is-active voorraadthuis >&2 || true
  in_container journalctl -u voorraadthuis -n 12 --no-pager 2>/dev/null | sed 's/^/     /' >&2 || true
  in_container bash -lc "node --check $SITE/server.js" >/dev/null 2>&1 || waarschuw "server.js is niet syntactisch correct."
  if [ "$GEEN_TERUG" = 1 ]; then
    die "De app werkt niet na de sprong. Zet terug met: pct rollback $CTID $SNAPSHOT (eerst: pct stop $CTID)."
  fi
  log "App werkt niet; momentopname $SNAPSHOT terugzetten…"
  pct stop "$CTID" >/dev/null 2>&1 || true
  sleep 3
  pct rollback "$CTID" "$SNAPSHOT" >/dev/null 2>&1 || die "Terugzetten mislukte. Zet handmatig terug met: pct rollback $CTID $SNAPSHOT"
  pct start "$CTID" >/dev/null 2>&1 || true
  TERUG=0
  for _ in $(seq 1 40); do
    sleep 3
    if in_container bash -c 'true' 2>/dev/null; then TERUG=1; break; fi
  done
  [ "$TERUG" = 1 ] || die "De container komt niet terug na het terugzetten; kijk op de host."
  in_container systemctl enable --now voorraadthuis >/dev/null 2>&1 || true
  die "Teruggezet op Debian 12; de app draait weer op de oude versie. De foutmeldingen staan hierboven en in /root/debian13-upgrade.log in de container."
fi

# Logboek en een kopie van de database naar de host halen, zodat er altijd iets
# buiten de container staat.
pct pull "$CTID" /root/debian13-upgrade.log "$LOGBESTAND" >/dev/null 2>&1 || true
pct pull "$CTID" /root/voor-debian13/voorraad.db "/root/voorraadthuis-na-debian${DOEL_VERSIE}-${STAMP}.db" >/dev/null 2>&1 || true

printf '\n\033[1;32m==> Klaar\033[0m\n'
printf '    systeem:      Debian %s (%s), was Debian %s (%s)\n' "$NIEUWE_VERSIE" "${NIEUWE_CODENAAM:-onbekend}" "$HUIDIGE_VERSIE" "${HUIDIGE_CODENAAM:-onbekend}"
printf '    node:         %s\n' "$NODEV"
printf '    app:          http://%s/ (healthz ok), https op poort 443: %s\n' "${IP:-?}" "$TLS"
printf '    terugweg:     pct rollback %s %s\n' "$CTID" "$SNAPSHOT"
printf '    logbestand:   %s (op de host), /root/debian13-upgrade.log (in de container)\n' "$LOGBESTAND"
printf '    database:     /root/voor-debian13/voorraad.db (in de container)\n'
printf '\n    De app zelf bijwerken blijft gewoon: bash update-from-github.sh %s\n' "$CTID"
