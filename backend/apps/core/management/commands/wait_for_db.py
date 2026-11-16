"""Wait until the database accepts connections, and explain the common setup mistakes clearly."""

import time

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.db.utils import OperationalError

AUTH_FAILED_HELP = """
The database refused the password for user "{user}".

Most often this is because PostgreSQL keeps the password it was given the FIRST time
its data volume was created. Changing DB_PASSWORD in .env afterwards does not change it.

Fix it in one of two ways:
  1. Put the original DB_PASSWORD back in .env, then run:  docker compose up -d
  2. Start with an empty database (this DELETES all data in it):
       docker compose down -v
       docker compose up --build

On Azure PostgreSQL: check DB_USER / DB_PASSWORD (or DATABASE_URL) against the server's admin login.
"""


class Command(BaseCommand):
    help = "Wait for the database (up to --timeout seconds) and stop with a clear message on fatal errors."

    def add_arguments(self, parser):
        parser.add_argument("--timeout", type=int, default=60)

    def handle(self, *args, **options):
        db = settings.DATABASES["default"]
        target = (
            f"{db.get('ENGINE', '').rsplit('.', 1)[-1]} {db.get('HOST') or ''}:{db.get('PORT') or ''}/{db.get('NAME')}"
        )
        deadline = time.monotonic() + options["timeout"]
        while True:
            try:
                connection.ensure_connection()
                self.stdout.write(f"Database is ready ({target}).")
                return
            except OperationalError as exc:
                message = str(exc).strip()
                if "password authentication failed" in message or "no password supplied" in message:
                    raise CommandError(AUTH_FAILED_HELP.format(user=db.get("USER"))) from exc
                if f'database "{db.get("NAME")}" does not exist' in message:
                    raise CommandError(
                        f'The database "{db.get("NAME")}" does not exist on the server. Create it, or check DB_NAME.'
                    ) from exc
                if time.monotonic() > deadline:
                    raise CommandError(f"The database at {target} is not reachable: {message}") from exc
                self.stdout.write(f"Waiting for the database at {target} ...")
                time.sleep(2)
