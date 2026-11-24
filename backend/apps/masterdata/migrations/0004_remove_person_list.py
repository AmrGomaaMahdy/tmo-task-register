from django.db import migrations, models


def delete_person_values(apps, schema_editor):
    apps.get_model("masterdata", "LookupValue").objects.filter(list_key="person").delete()


class Migration(migrations.Migration):
    dependencies = [("masterdata", "0003_groupmember"), ("register", "0008_activity_owner_field")]

    operations = [
        migrations.RunPython(delete_person_values, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="lookupvalue",
            name="list_key",
            field=models.CharField(
                choices=[
                    ("workstream", "Workstreams"),
                    ("sub_objective", "Sub-objectives"),
                    ("owner_role", "Owner roles"),
                    ("partner_role", "Partner roles"),
                    ("needed", "When needed"),
                ],
                db_index=True,
                max_length=20,
            ),
        ),
    ]
