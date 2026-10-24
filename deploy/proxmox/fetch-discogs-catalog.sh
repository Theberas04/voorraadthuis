#!/usr/bin/env bash
# Download and safely install the immutable, read-only Discogs vinyl catalogue.
set -euo pipefail

CATALOG_URL="${DISCOGS_CATALOG_URL:-https://github.com/Theberas04/voorraadthuis/releases/download/discogs-2026-10-01/discogs-vinyl-20261001.sqlite.gz}"
CATALOG_SHA256="${DISCOGS_CATALOG_SHA256:-c1c76ede1e67e50a93b7b51ec89a0297d1bda466edbbccb734b4d77a6486b6d3}"
CATALOG_DEST="${DISCOGS_CATALOG_DEST:-/var/lib/voorraadthuis/discogs-vinyl.sqlite}"

fetch_catalog() {
  local url="$1" sha="$2" dest="$3" dir work
  [[ "$sha" =~ ^[[:xdigit:]]{64}$ ]] || { echo '[fout] De Discogs-checksum is niet ingesteld of ongeldig.' >&2; return 2; }
  dir="$(dirname "$dest")"
  mkdir -p "$dir"
  if [[ -s "$dest" && -s "${dest}.source.sha256" ]] && [[ "$(<"${dest}.source.sha256")" == "$sha" ]]; then
    if validate_catalog "$dest" >/dev/null 2>&1; then
      echo 'Discogs-catalogus is al aanwezig en gecontroleerd.'
      return 0
    fi
  fi

  work="$(mktemp -d "$dir/.discogs-catalog.XXXXXX")"
  trap 'rm -rf "$work"' RETURN
  curl --silent --show-error --fail --location --retry 3 --retry-delay 2 --connect-timeout 30 --max-time 3600 \
    "$url" -o "$work/catalog.sqlite.gz"
  printf '%s  %s\n' "$sha" "$work/catalog.sqlite.gz" | sha256sum --check --status || {
    echo '[fout] De gedownloade catalogus heeft niet de verwachte SHA-256.' >&2
    return 3
  }
  gzip --test "$work/catalog.sqlite.gz"
  gzip --decompress --stdout "$work/catalog.sqlite.gz" > "$work/catalog.sqlite"
  validate_catalog "$work/catalog.sqlite"

  chmod 644 "$work/catalog.sqlite"
  mv -f "$work/catalog.sqlite" "$dest"
  printf '%s\n' "$sha" > "$work/source.sha256"
  chmod 644 "$work/source.sha256"
  mv -f "$work/source.sha256" "${dest}.source.sha256"
  if getent passwd voorraadthuis >/dev/null 2>&1; then
    chown voorraadthuis:voorraadthuis "$dest" "${dest}.source.sha256"
  fi
  echo "Discogs-catalogus geïnstalleerd: $dest"
}

validate_catalog() {
  node - "$1" <<'NODE'
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[2], { readOnly: true });
try {
  const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  if (!names.has('records') || !names.has('records_fts')) throw new Error('records/records_fts ontbreken');
  if (!db.prepare('SELECT 1 FROM records LIMIT 1').get()) throw new Error('records is leeg');
  if (!db.prepare('SELECT 1 FROM records_fts LIMIT 1').get()) throw new Error('records_fts is leeg');
} finally {
  db.close();
}
NODE
}

case "${1:-}" in
  --local)
    shift
    [[ "$#" -eq 3 ]] || { echo "Gebruik: $0 --local <gzip-url> <sha256> <doelbestand>" >&2; exit 2; }
    fetch_catalog "$1" "$2" "$3"
    exit 0
    ;;
  --inside)
    shift
    [[ "$#" -eq 3 ]] || { echo '[fout] Interne aanroep mist catalogusparameters.' >&2; exit 2; }
    fetch_catalog "$1" "$2" "$3"
    exit 0
    ;;
esac

CTID="${1:-${CTID:-}}"
[[ -n "$CTID" ]] || { echo "Gebruik: $0 <container-id>" >&2; exit 2; }
[[ "$(id -u)" -eq 0 ]] || { echo '[fout] Draai dit als root op de Proxmox-host.' >&2; exit 1; }
command -v pct >/dev/null 2>&1 || { echo '[fout] pct niet gevonden: dit is geen Proxmox VE-host.' >&2; exit 1; }
pct exec "$CTID" -- bash -s -- --inside "$CATALOG_URL" "$CATALOG_SHA256" "$CATALOG_DEST" < "$0"
