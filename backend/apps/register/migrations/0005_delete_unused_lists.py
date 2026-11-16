# Data step: the lists only the long task form used.

from django.db import migrations

REMOVED_LISTS = ["task_type", "output_type", "profile", "capability", "control", "oversight", "cost_status"]


def delete_unused_lists(apps, schema_editor):
    LookupValue = apps.get_model("masterdata", "LookupValue")
    LookupValue.objects.filter(list_key__in=REMOVED_LISTS).delete()
    LookupValue.objects.filter(semantic__in=["estimated", "under_estimation"]).update(semantic="")


class Migration(migrations.Migration):
    """Step 4: delete the values of the lists the simplified register no longer uses."""

    dependencies = [("register", "0004_remove_old_fields"), ("masterdata", "0002_simplified_register")]

    operations = [migrations.RunPython(delete_unused_lists, migrations.RunPython.noop)]
