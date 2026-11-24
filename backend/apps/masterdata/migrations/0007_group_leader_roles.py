"""
Group leader roles: every work group gets a "<CODE> Group Leader" role, and the user set as the group's
leader (since 1.11) receives it. From now on the role decides what a leader may do.
"""

from django.db import migrations


def create_leader_roles(apps, schema_editor):
    Group = apps.get_model("auth", "Group")
    WorkGroup = apps.get_model("masterdata", "WorkGroup")
    for wg in WorkGroup.objects.all():
        role, _ = Group.objects.get_or_create(name=f"{wg.code} Group Leader")
        if wg.leader_id:
            role.user_set.add(wg.leader_id)


def remove_leader_roles(apps, schema_editor):
    apps.get_model("auth", "Group").objects.filter(name__endswith=" Group Leader").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("auth", "0012_alter_user_first_name_max_length"),
        ("masterdata", "0006_member_contact_details"),
    ]

    operations = [migrations.RunPython(create_leader_roles, remove_leader_roles)]
