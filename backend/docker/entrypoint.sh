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
  echo "[entrypoint] loading the initial data, demo tasks and trial users (tasks skipped if already loaded)"
  if [ "${SEED_DEMO_RESET:-false}" = "true" ]; then python manage.py seed_demo --reset; else python manage.py seed_demo; fi
elif [ "${LOAD_INITIAL_DATA:-true}" = "true" ]; then
  # The organisation's work groups, directions, sub-objectives, members and their accounts.
  # Adds what is missing only, so edits made in Configuration are kept.
  echo "[entrypoint] loading the initial data (missing records only)"
  python manage.py load_initial_data
fi

exec "$@"
