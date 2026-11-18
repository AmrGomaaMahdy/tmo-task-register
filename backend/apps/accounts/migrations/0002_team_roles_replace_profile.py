"""Move to one role per work group ("<CODE> Team").

Users who had Group Lead or Group Editor get the team role of the work group on their profile.
The profile table is then removed: a user's work groups now come from their team roles.
"""

from django.db import migrations

OLD_GROUP_ROLES = ["Group Lead", "Group Editor"]


def forwards(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    WorkGroup = apps.get_model("masterdata", "WorkGroup")
    Profile = apps.get_model("accounts", "Profile")

    teams = {}
    for wg in WorkGroup.objects.all():
        teams[wg.id], _ = Group.objects.get_or_create(name=f"{wg.code} Team")

    for profile in Profile.objects.exclude(work_group=None).select_related("user"):
        if profile.user.groups.filter(name__in=OLD_GROUP_ROLES).exists():
            profile.user.groups.add(teams[profile.work_group_id])


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0001_initial"),
        ("masterdata", "0001_initial"),
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [
        migrations.RunPython(forwards, migrations.RunPython.noop),
        migrations.DeleteModel(name="Profile"),
    ]
