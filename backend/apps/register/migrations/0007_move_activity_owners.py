"""
Group members used to be a plain list of names. Each name becomes a member of a work group:
the group whose tasks the person owns most activities on, or the first work group when the
person owns none. Activities keep their owner.
"""

from collections import Counter

from django.db import migrations


def forwards(apps, schema_editor):
    LookupValue = apps.get_model("masterdata", "LookupValue")
    GroupMember = apps.get_model("masterdata", "GroupMember")
    WorkGroup = apps.get_model("masterdata", "WorkGroup")
    Activity = apps.get_model("register", "Activity")
    first_group = WorkGroup.objects.order_by("code").first()
    for person in LookupValue.objects.filter(list_key="person").order_by("sort_order", "id"):
        acts = list(Activity.objects.filter(owner_id=person.id).select_related("task"))
        groups = Counter(a.task.work_group_id for a in acts)
        group_id = groups.most_common(1)[0][0] if groups else (first_group.id if first_group else None)
        if group_id is None:
            continue
        member, _ = GroupMember.objects.get_or_create(name=person.value, defaults={"work_group_id": group_id})
        Activity.objects.filter(owner_id=person.id).update(owner_member=member)


def backwards(apps, schema_editor):
    LookupValue = apps.get_model("masterdata", "LookupValue")
    GroupMember = apps.get_model("masterdata", "GroupMember")
    Activity = apps.get_model("register", "Activity")
    for i, member in enumerate(GroupMember.objects.order_by("work_group__code", "name")):
        person, _ = LookupValue.objects.get_or_create(list_key="person", value=member.name, defaults={"sort_order": i})
        Activity.objects.filter(owner_member=member).update(owner_id=person.id)


class Migration(migrations.Migration):
    dependencies = [("register", "0006_activity_owner_member")]

    operations = [migrations.RunPython(forwards, backwards)]
