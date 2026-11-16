from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("register", "0007_move_activity_owners")]

    operations = [
        migrations.RemoveField(model_name="activity", name="owner"),
        migrations.RenameField(model_name="activity", old_name="owner_member", new_name="owner"),
    ]
