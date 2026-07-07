#!/bin/sh
# Backs up the radiology Postgres database to a timestamped .sql.gz file.
#
# Usage (from the project folder on your NAS):
#   ./scripts/backup-db.sh
#
# Restore later with:
#   gunzip -c backups/radiology-2026-07-08.sql.gz | docker compose exec -T radiology-db \
#     psql -U "$RAD_DB_USER" -d "$RAD_DB_NAME"
#
# Consider scheduling this with Synology Task Scheduler (Control Panel ->
# Task Scheduler -> Create -> Scheduled Task -> User-defined script),
# e.g. daily at 2am: sh /volume1/docker/radiology/scripts/backup-db.sh

set -eu
cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
[ -f .env ] && . ./.env

RAD_DB_USER="${RAD_DB_USER:-radiology}"
RAD_DB_NAME="${RAD_DB_NAME:-radiology}"
OUT_DIR="./backups"
STAMP=$(date +%Y-%m-%d_%H%M%S)
OUT_FILE="$OUT_DIR/radiology-$STAMP.sql.gz"

mkdir -p "$OUT_DIR"

docker compose exec -T radiology-db pg_dump -U "$RAD_DB_USER" -d "$RAD_DB_NAME" | gzip > "$OUT_FILE"

echo "Backup written to $OUT_FILE"

# Keep only the last 14 backups
ls -1t "$OUT_DIR"/radiology-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm --
