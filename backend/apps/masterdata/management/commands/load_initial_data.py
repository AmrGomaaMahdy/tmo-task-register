"""
Load the organisation's initial data: 13 work groups with missions and weights, their leadership
directions, sub-objectives and members, and a sign-in account for every member.

    python manage.py load_initial_data             # add what is missing; existing records are kept
    python manage.py load_initial_data --update    # also overwrite names and texts with the file's
    python manage.py load_initial_data --no-users  # without sign-in accounts

New accounts get the password in INITIAL_USER_PASSWORD. Without it their password is unusable: an
Admin sets one in the admin site, or they sign in with Microsoft Entra ID. Users change their own
password from the menu (Change password).
"""

import os

from django.core.management.base import BaseCommand

from apps.masterdata import initial


class Command(BaseCommand):
    help = "Load the initial work groups, directions, sub-objectives, members and their accounts."

    def add_arguments(self, parser):
        parser.add_argument("--update", action="store_true", help="Overwrite names and texts with the file's.")
        parser.add_argument("--no-users", action="store_true", help="Do not create sign-in accounts.")

    def handle(self, *args, **options):
        password = os.environ.get("INITIAL_USER_PASSWORD") or None
        result = initial.load(update=options["update"], users=not options["no_users"], password=password)
        for line in result.lines():
            self.stdout.write(line)
        if result.users_created and not password:
            self.stdout.write(
                self.style.WARNING(
                    "New accounts have no usable password. Set INITIAL_USER_PASSWORD before loading, set "
                    "passwords in the admin site, or sign in with Microsoft Entra ID."
                )
            )
