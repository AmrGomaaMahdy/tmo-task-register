"""Role names of 1.16 (see apps/accounts/role_names.py): users keep their roles under the new names."""

from django.db import migrations


def forwards(apps, schema_editor):
    from apps.accounts.role_names import upgrade_role_names

    upgrade_role_names(apps.get_model("auth", "Group"), apps.get_model("masterdata", "WorkGroup"))


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0002_team_roles_replace_profile"),
        ("masterdata", "0008_initial_data_fields"),
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
