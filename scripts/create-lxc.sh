#!/usr/bin/env bash
# Provision VoorraadThuis as a native Node.js service in an unprivileged Proxmox LXC.
set -Eeuo pipefail

if [[ $EUID -ne 0 ]]; then echo "Run this on the Proxmox host as root." >&2; exit 1; fi
if [[ $# -lt 1 || ! -d $1 ]]; then echo "Usage: $0 /path/to/voorraadthuis-source [CTID]" >&2; exit 2; fi
SRC=$(realpath "$1"); CTID=${2:-120}
: "${HOSTNAME_CT:=voorraadthuis}"
: "${BRIDGE:=vmbr0}"
: "${STORAGE:=local-lvm}"
: "${TEMPLATE_STORAGE:=local}"
: "${MEMORY:=512}"
: "${CORES:=1}"
: "${DISK:=8}"
: "${IP:=dhcp}"
: "${GATEWAY:=}"
: "${DNS:=1.1.1.1}"
: "${PORT:=3000}"
for f in server.js package.json; do [[ -f "$SRC/$f" ]] || { echo "Missing $SRC/$f" >&2; exit 2; }; done
[[ -f "$SRC/public/index.html" ]] || { echo "Missing public/index.html" >&2; exit 2; }
command -v pct >/dev/null || { echo "pct not found; run on a Proxmox VE host." >&2; exit 1; }
pct status "$CTID" >/dev/null 2>&1 && { echo "CTID $CTID already exists; refusing to overwrite." >&2; exit 1; }

if [[ -z ${TEMPLATE:-} ]]; then
  TEMPLATE=$(pveam available --section system | awk '$2 ~ /^debian-12-standard_.*_amd64\.tar\.(zst|gz)$/ {print $2}' | sort -V | tail -n1)
fi
[[ -n "$TEMPLATE" ]] || { echo "Could not find Debian 12 template. Set TEMPLATE=... and retry." >&2; exit 1; }
pveam download "$TEMPLATE_STORAGE" "$TEMPLATE"
TEMPLATE_PATH="$TEMPLATE_STORAGE:vztmpl/$TEMPLATE"
NET="name=eth0,bridge=$BRIDGE,ip=$IP"
if [[ "$IP" != dhcp && -n "$GATEWAY" ]]; then NET+=" ,gw=$GATEWAY"; NET=${NET/ ,/,}; fi
pct create "$CTID" "$TEMPLATE_PATH" --hostname "$HOSTNAME_CT" --unprivileged 1 --cores "$CORES" --memory "$MEMORY" --swap 512 --rootfs "$STORAGE:$DISK" --net0 "$NET" --nameserver "$DNS" --onboot 1 --features nesting=0
pct start "$CTID"
for _ in {1..30}; do pct exec "$CTID" -- ping -c1 -W1 1.1.1.1 >/dev/null 2>&1 && break; sleep 2; done
pct exec "$CTID" -- bash -lc 'apt-get update && apt-get install -y ca-certificates curl gnupg'
pct exec "$CTID" -- bash -lc 'install -d -m 0755 /etc/apt/keyrings && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && chmod a+r /etc/apt/keyrings/nodesource.gpg && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && apt-get update && apt-get install -y nodejs'
pct exec "$CTID" -- useradd --system --home /var/lib/voorraadthuis --shell /usr/sbin/nologin voorraadthuis
pct exec "$CTID" -- install -d -o voorraadthuis -g voorraadthuis /opt/voorraadthuis/public /var/lib/voorraadthuis
pct push "$CTID" "$SRC/server.js" /opt/voorraadthuis/server.js
pct push "$CTID" "$SRC/package.json" /opt/voorraadthuis/package.json
pct push "$CTID" "$SRC/public/index.html" /opt/voorraadthuis/public/index.html
pct exec "$CTID" -- chown -R voorraadthuis:voorraadthuis /opt/voorraadthuis /var/lib/voorraadthuis
UNIT=$(mktemp)
cat >"$UNIT" <<EOF
[Unit]
Description=VoorraadThuis voorraad-app
After=network.target
[Service]
Type=simple
User=voorraadthuis
Group=voorraadthuis
Environment=PORT=$PORT
Environment=DB_PATH=/var/lib/voorraadthuis/voorraad.db
WorkingDirectory=/opt/voorraadthuis
ExecStart=/usr/bin/node /opt/voorraadthuis/server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/voorraadthuis
[Install]
WantedBy=multi-user.target
EOF
pct push "$CTID" "$UNIT" /etc/systemd/system/voorraadthuis.service
rm -f "$UNIT"
pct exec "$CTID" -- systemctl daemon-reload
pct exec "$CTID" -- systemctl enable --now voorraadthuis.service
IP_ADDR=''
for _ in {1..15}; do IP_ADDR=$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}'); [[ -n "$IP_ADDR" ]] && break; sleep 2; done
echo "VoorraadThuis LXC is geïnstalleerd (CTID $CTID)."
if [[ -n "$IP_ADDR" ]]; then echo "Open: http://$IP_ADDR:$PORT"; else echo "Container gestart; haal het IP op met: pct exec $CTID -- hostname -I"; fi
echo "Status: pct exec $CTID -- systemctl status voorraadthuis"
echo "Data: /var/lib/voorraadthuis/voorraad.db (bewaar/back-up deze map)."
