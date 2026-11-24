"""1.19: "<CODE> Team Coordinator" is renamed "<CODE> Team Focal Point"; users keep their roles."""

from django.db import migrations


def forwards(apps, schema_editor):
    from apps.accounts.role_names import upgrade_role_names

    upgrade_role_names(apps.get_model("auth", "Group"), apps.get_model("masterdata", "WorkGroup"))


class Migration(migrations.Migration):
    dependencies = [("accounts", "0003_role_names_1_16")]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
