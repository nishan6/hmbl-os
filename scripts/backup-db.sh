#!/usr/bin/env bash
# Backs up the HMBL OS database from the local Docker Postgres.
# Usage: scripts/backup-db.sh [database]   (default: hmbl_live)
# Keeps 30 days of backups in ./backups. See docs/running-locally.md.
set -euo pipefail

cd "$(dirname "$0")/.."
database="${1:-hmbl_live}"
keep_days="${BACKUP_KEEP_DAYS:-30}"
mkdir -p backups
file="backups/${database}-$(date +%Y%m%d-%H%M%S).dump"

# Custom format: compressed, and restorable table by table with pg_restore.
docker compose exec -T postgres pg_dump -U hmbl --format=custom "$database" > "$file.partial"
mv "$file.partial" "$file"
echo "Backed up $database to $file ($(du -h "$file" | cut -f1))"

find backups -name "${database}-*.dump" -mtime +"$keep_days" -print -delete
