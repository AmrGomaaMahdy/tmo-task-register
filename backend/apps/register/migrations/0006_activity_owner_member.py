import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("register", "0005_delete_unused_lists"), ("masterdata", "0003_groupmember")]

    operations = [
        migrations.AddField(
            model_name="activity",
            name="owner_member",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="activities",
                to="masterdata.groupmember",
            ),
        ),
    ]
