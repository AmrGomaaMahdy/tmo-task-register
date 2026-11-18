import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("masterdata", "0002_simplified_register")]

    operations = [
        migrations.CreateModel(
            name="GroupMember",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=120, unique=True)),
                ("is_active", models.BooleanField(default=True)),
                (
                    "work_group",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="members", to="masterdata.workgroup"
                    ),
                ),
            ],
            options={"ordering": ["work_group__code", "name"]},
        ),
    ]
