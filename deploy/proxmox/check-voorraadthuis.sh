#!/usr/bin/env bash
# Kijkt in één keer na hoe de VoorraadThuis-container ervoor staat: systeem, netwerk,
# de dienst, Node, de poorten, het geheugen en het journaal. Draai als root op de
# Proxmox-host:
#   bash check-voorraadthuis.sh <CTID>
set -uo pipefail
CTID="${1:-${CTID:-}}"
SITE=/var/www/voorraadthuis
kop(){ printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
binnen(){ pct exec "$CTID" -- "$@" 2>&1; }
binnen_bash(){ pct exec "$CTID" -- bash -c "$1" 2>&1; }

kop "1. De container zelf"
pct status "$CTID" 2>&1
printf 'geheugen-limiet: '; pct config "$CTID" 2>/dev/null | grep -E '^memory' || echo 'onbekend'
printf 'schijf-limiet:   '; pct config "$CTID" 2>/dev/null | grep -E '^rootfs' || echo 'onbekend'
if [ "$(pct status "$CTID" 2>/dev/null)" != 'status: running' ]; then
  printf '\033[1;31mDe container draait niet.\033[0m Start hem met: pct start %s\n' "$CTID"
  exit 0
fi

kop "2. Het systeem in de container"
printf 'Debian-versie: '; binnen cat /etc/debian_version
binnen_bash '. /etc/os-release 2>/dev/null; echo "codenaam: ${VERSION_CODENAME:-onbekend}"'
printf 'hostnaam:      '; binnen hostname
printf 'uptime:        '; binnen uptime | tr -s ' '

kop "3. Netwerk"
printf 'adressen:\n'; binnen ip -4 -o addr show | sed 's/^/    /'
printf 'standaardroute:\n'; binnen ip route show default | sed 's/^/    /' || echo '    geen'
printf 'DNS (resolv.conf):\n'; binnen_bash 'cat /etc/resolv.conf 2>/dev/null | grep -v "^#" | sed "s/^/    /"'
printf 'probeert de container internet? '; binnen_bash 'curl -fsS --max-time 8 -o /dev/null -w "HTTP %{http_code}\n" https://api.github.com 2>&1 || echo mislukt'

kop "4. De dienst en Node"
printf 'dienst:  '; binnen systemctl is-active voorraadthuis
printf 'opstarten bij boot: '; binnen systemctl is-enabled voorraadthuis
printf 'poort in de dienst:  '; binnen_bash "grep -h '^Environment=PORT' /etc/systemd/system/voorraadthuis.service 2>/dev/null || echo 'geen unit gevonden'"
printf 'node:    '; binnen_bash 'node --version 2>&1'
printf 'node:sqlite bruikbaar? '; binnen_bash 'node -e "require(\"node:sqlite\"); console.log(\"ja\")" 2>/dev/null || echo nee'
printf 'node-pad: '; binnen_bash 'command -v node || echo ontbreekt'
printf 'nginx aanwezig? '; binnen_bash 'command -v nginx >/dev/null 2>&1 && echo "ja (oude opzet: deze container moet opnieuw ingericht worden)" || echo nee'

kop "5. Wat er luistert"
binnen_bash 'ss -ltnpH 2>/dev/null | sed "s/^/    /" || echo "    niets"'

kop "6. Is de app te bereiken?"
printf 'vanuit de container zelf: '; binnen_bash 'curl -sS --max-time 6 -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1/healthz 2>&1 || echo mislukt'
IP=$(binnen ip -4 -o addr show dev eth0 | awk '{print $4}' | cut -d/ -f1 | head -1)
printf 'IP: %s\n' "${IP:-geen}"
if [ -n "$IP" ]; then
  printf 'vanaf de host op het IP:  '; curl -sS --max-time 8 -o /dev/null -w "HTTP %{http_code}\n" "http://$IP/healthz" 2>&1 || echo mislukt
  printf 'https op 443:             '; curl -sSk --max-time 8 -o /dev/null -w "HTTP %{http_code}\n" "https://$IP/healthz" 2>&1 || echo mislukt
fi

kop "7. Geheugen in de container"
binnen free -m | sed 's/^/    /'

kop "8. Het journaal van de app (laatste 25 regels)"
binnen journalctl -u voorraadthuis -n 25 --no-pager | sed 's/^/    /'
printf '\n(startproblemen van de dienst, laatste 12 regels boot:)\n'
binnen journalctl -b -n 12 --no-pager | sed 's/^/    /'

kop "9. De bestanden en de gegevens"
binnen ls -la "$SITE" 2>&1 | sed 's/^/    /'
printf 'public:\n'; binnen ls "$SITE/public" 2>&1 | head -20 | sed 's/^/    /'
printf 'gegevensbank:\n'; binnen ls -la /var/lib/voorraadthuis/voorraad.db* 2>&1 | sed 's/^/    /'
printf 'ruimte in de container:\n'; binnen df -h / | sed 's/^/    /'

kop "10. De laatste systeemsprong (Debian 12 -> 13)"
if binnen test -f /root/debian13-upgrade.log; then
  binnen tail -15 /root/debian13-upgrade.log | sed 's/^/    /'
else
  echo '    geen logbestand van een sprong gevonden'
fi
binnen_bash 'ls -la /root/voor-debian13/ 2>/dev/null | sed "s/^/    /"'

kop "Wat nu?"
cat <<'HINT'
    - Draait de container niet?         pct start <CTID>
    - Geen IP-adres?                    pct exec <CTID> -- systemctl restart networking   (of: systemctl restart systemd-networkd)
    - "node:sqlite bruikbaar? nee" of node 20.x?
                                         de app vraagt Node 22.5+; zet Node 22 er weer op:
                                         pct exec <CTID> -- bash -lc 'curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg; echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list; apt-get update -qq && apt-get install -y nodejs'
    - "nginx aanwezig? ja"              deze container heeft nog de oude opzet; opnieuw inrichten:
                                         cd /root && rm -rf voorraadthuis-main && curl -fsSL https://codeload.github.com/Theberas04/voorraadthuis/tar.gz/refs/heads/main | tar xz && bash /root/voorraadthuis-main/deploy/proxmox/provision-voorraadthuis.sh <CTID>
    - Alles goed, maar de pagina laadt niet?
                                         pct exec <CTID> -- systemctl restart voorraadthuis
HINT
