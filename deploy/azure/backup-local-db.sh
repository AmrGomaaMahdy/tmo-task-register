#!/usr/bin/env bash
# Nightly backup when PostgreSQL runs on the VM (docker-compose.azure-db.yml).
#
# Makes two copies in BACKUP_DIR and keeps KEEP_DAYS days of them:
#   * task-register-db-<date>.dump : the whole database (pg_dump custom format; restore with pg_restore)
#   * task-register-app-<date>.json: the application's own export (restore on the Backup & restore page)
# If BACKUP_SAS_URL is set (an Azure Storage container URL with a SAS token, kept in ~/.backup-sas, chmod 600),
# both files are also copied there with azcopy, so a copy survives the loss of the VM.
#
# Cron, every night at 02:00:
#   0 2 * * * ~/task-register/deploy/azure/backup-local-db.sh >> ~/backups/backup.log 2>&1
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/task-register}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
COMPOSE=(docker compose -f "$APP_DIR/docker-compose.azure.yml" -f "$APP_DIR/docker-compose.azure-db.yml")
STAMP="$(date +%F-%H%M)"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
cd "$APP_DIR"

# shellcheck disable=SC2016  # $POSTGRES_* are expanded inside the container
"${COMPOSE[@]}" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP_DIR/task-register-db-$STAMP.dump"
"${COMPOSE[@]}" exec -T backend python manage.py export_data -o - > "$BACKUP_DIR/task-register-app-$STAMP.json"
chmod 600 "$BACKUP_DIR"/task-register-*-"$STAMP".*

# A dump smaller than 1 KB means something went wrong: stop before old copies are removed.
if [ "$(stat -c %s "$BACKUP_DIR/task-register-db-$STAMP.dump")" -lt 1024 ]; then
  echo "$(date -Is) backup FAILED: the database dump is empty" >&2
  exit 1
fi

if [ -z "${BACKUP_SAS_URL:-}" ] && [ -f "$HOME/.backup-sas" ]; then
  BACKUP_SAS_URL="$(cat "$HOME/.backup-sas")"
fi
if [ -n "${BACKUP_SAS_URL:-}" ] && command -v azcopy >/dev/null; then
  azcopy copy "$BACKUP_DIR/task-register-*-$STAMP.*" "$BACKUP_SAS_URL" --log-level=ERROR >/dev/null
fi

find "$BACKUP_DIR" -name 'task-register-*' -mtime +"$KEEP_DAYS" -delete
echo "$(date -Is) backup OK: $STAMP"
