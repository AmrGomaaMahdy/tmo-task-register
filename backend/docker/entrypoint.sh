#!/bin/sh
# Prepares the database, then hands over to the container command (gunicorn).
set -eu

echo "[entrypoint] checking the database connection"
python manage.py wait_for_db

echo "[entrypoint] applying migrations"
python manage.py migrate --noinput

echo "[entrypoint] ensuring roles and permissions"
python manage.py setup_roles

if [ "${SEED_DEMO:-false}" = "true" ]; then
  echo "[entrypoint] loading demo data and trial users (skipped if already loaded)"
  python manage.py seed_demo
fi

exec "$@"
