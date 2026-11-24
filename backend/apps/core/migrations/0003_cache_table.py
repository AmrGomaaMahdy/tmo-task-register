"""
Creates the database cache table "app_cache" used for rate limits and the sign-in lockout
(see CACHES in config/settings.py). Running it as a migration means every deployment gets the table
with the usual "migrate" step, without a separate "createcachetable" command.
"""

from django.core.management import call_command
from django.db import migrations


def create_cache_table(apps, schema_editor):
    call_command("createcachetable", "app_cache", verbosity=0, database=schema_editor.connection.alias)


def drop_cache_table(apps, schema_editor):
    schema_editor.execute("DROP TABLE IF EXISTS app_cache")


class Migration(migrations.Migration):
    dependencies = [("core", "0002_audit_export_restore")]

    operations = [migrations.RunPython(create_cache_table, drop_cache_table)]
