from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.accounts.roles import FIXED_ROLES, LEGACY_ROLES, sync_team_roles


class Command(BaseCommand):
    help = "Create the fixed roles and one team role per work group, and retire old roles. Safe to run repeatedly."

    @transaction.atomic
    def handle(self, *args, **options):
        for name in FIXED_ROLES:
            _, created = Group.objects.get_or_create(name=name)
            self.stdout.write(f"{'Created' if created else 'Exists '} role: {name}")
        for name in sync_team_roles():
            self.stdout.write(f"Created role: {name}")
        for old in Group.objects.filter(name__in=LEGACY_ROLES):
            name = old.name
            old.delete()
            self.stdout.write(f"Retired old role: {name}")
