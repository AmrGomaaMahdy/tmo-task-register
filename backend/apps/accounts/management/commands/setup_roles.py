from django.contrib.auth.models import Group
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.accounts.role_names import upgrade_role_names
from apps.accounts.roles import FIXED_ROLES, LEGACY_ROLES, sync_team_roles
from apps.masterdata.models import WorkGroup


class Command(BaseCommand):
    help = "Create the fixed roles and the three roles of each work group; rename and retire old roles. Repeatable."

    @transaction.atomic
    def handle(self, *args, **options):
        for change in upgrade_role_names(Group, WorkGroup):
            self.stdout.write(f"Renamed role: {change}")
        for name in FIXED_ROLES:
            _, created = Group.objects.get_or_create(name=name)
            self.stdout.write(f"{'Created' if created else 'Exists '} role: {name}")
        for name in sync_team_roles():
            self.stdout.write(f"Created role: {name}")
        for old in Group.objects.filter(name__in=LEGACY_ROLES):
            name = old.name
            old.delete()
            self.stdout.write(f"Retired old role: {name}")
