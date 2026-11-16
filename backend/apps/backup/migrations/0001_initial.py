from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = []

    operations = [
        migrations.CreateModel(
            name="RestorePoint",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("created_by", models.CharField(blank=True, max_length=150)),
                ("reason", models.CharField(max_length=300)),
                ("counts", models.JSONField(default=dict)),
                (
                    "document",
                    models.TextField(help_text="The backup document (JSON), as the backup download would hold it."),
                ),
            ],
            options={"ordering": ["-created_at", "-id"]},
        ),
    ]
