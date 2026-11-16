# Data step: kept apart from schema changes, as PostgreSQL requires.

from django.db import migrations

REMOVED_LISTS = ["task_type", "output_type", "profile", "capability", "control", "oversight", "cost_status"]


def _ref(their_task, ref):
    """Their task as a task number, e.g. "HR-T012"."""
    if their_task is not None:
        return their_task.code
    return (ref or "").split(" – ")[0].strip()[:20]


def convert_links(apps, schema_editor):
    """Dependencies become the partner rows of table A; one contribution per task is kept (table B)."""
    Task = apps.get_model("register", "Task")
    Partner = apps.get_model("register", "TaskPartner")
    Dependency = apps.get_model("register", "Dependency")
    Contribution = apps.get_model("register", "Contribution")

    for task in Task.objects.all():
        for slot, partner in enumerate(Partner.objects.filter(task=task).order_by("id"), start=1):
            partner.slot = slot
            partner.save(update_fields=["slot"])

    for dep in Dependency.objects.select_related("task", "their_task").order_by("id"):
        if dep.from_group_id == dep.task.work_group_id:
            continue  # links between a group's own tasks are not part of the simplified register
        partner = Partner.objects.filter(task=dep.task, work_group_id=dep.from_group_id).first()
        if partner is None:
            used = Partner.objects.filter(task=dep.task).count()
            if used >= 3:
                continue
            partner = Partner(task=dep.task, work_group_id=dep.from_group_id, slot=used + 1)
        if partner.need:
            continue  # keep the first need recorded for this partner
        partner.need = dep.need[:300]
        partner.needed_when_id = dep.needed_when_id
        partner.their_task_ref = _ref(dep.their_task, dep.their_task_ref)
        partner.their_task_id = dep.their_task_id
        partner.save()

    seen = set()
    for con in Contribution.objects.select_related("their_task").order_by("id"):
        if con.task_id in seen:
            con.delete()
            continue
        seen.add(con.task_id)
        con.their_task_ref = _ref(con.their_task, con.their_task_ref)
        con.save(update_fields=["their_task_ref"])


class Migration(migrations.Migration):
    """Step 2: dependencies become the partner rows of table A; one contribution per task is kept (table B)."""

    dependencies = [("register", "0002_simplified_register")]

    operations = [migrations.RunPython(convert_links, migrations.RunPython.noop)]
