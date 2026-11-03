#!/usr/bin/env bash
# Backs up the HMBL OS database from the local Docker Postgres, and copies
# new uploaded documents.
# Usage: scripts/backup-db.sh [database]   (default: hmbl_live)
# Keeps 30 days of backups in ./backups (BACKUP_DIR). See docs/running-locally.md.
set -euo pipefail

cd "$(dirname "$0")/.."
database="${1:-hmbl_live}"
keep_days="${BACKUP_KEEP_DAYS:-30}"
backups="${BACKUP_DIR:-$(grep -E '^BACKUP_DIR=' .env 2>/dev/null | cut -d= -f2- || true)}"
backups="${backups:-backups}"
mkdir -p "$backups"
file="$backups/${database}-$(date +%Y%m%d-%H%M%S).dump"

# Custom format: compressed, and restorable table by table with pg_restore.
docker compose exec -T postgres pg_dump -U hmbl --format=custom "$database" </dev/null >"$file.partial"
mv "$file.partial" "$file"
echo "Backed up $database to $file ($(du -h "$file" | cut -f1))"

find "$backups" -name "${database}-*.dump" -mtime +"$keep_days" -print -delete

# Uploaded documents. Files are never changed once written, so copying the
# ones not yet in the backup is enough (docs/documents.md).
storage="${STORAGE_DIR:-$(grep -E '^STORAGE_DIR=' .env 2>/dev/null | cut -d= -f2- || true)}"
storage="${storage:-storage}"
if [ -d "$storage" ]; then
  mkdir -p "$backups/storage"
  cp -Rn "$storage"/. "$backups/storage/"
  echo "Copied new documents from $storage to $backups/storage"
fi

# Off-site copy: a folder your cloud sync app (Google Drive, OneDrive, iCloud)
# or an external drive keeps elsewhere. A backup on this disk alone doesn't
# survive the disk failing or the computer being lost.
copy_to="${BACKUP_COPY_DIR:-$(grep -E '^BACKUP_COPY_DIR=' .env 2>/dev/null | cut -d= -f2- || true)}"
if [ -n "$copy_to" ]; then
  if [ -d "$copy_to" ]; then
    mkdir -p "$copy_to/storage"
    cp "$file" "$copy_to/"
    [ -d "$backups/storage" ] && cp -Rn "$backups/storage"/. "$copy_to/storage/"
    find "$copy_to" -maxdepth 1 -name "${database}-*.dump" -mtime +"$keep_days" -delete
    echo "Copied the backup to $copy_to"
  else
    echo "BACKUP_COPY_DIR $copy_to doesn't exist (drive unplugged?); backup kept here only" >&2
    exit 2
  fi
fi
