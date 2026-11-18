"""Readable snapshots of tasks and activities for the audit trail (what changed, before and after)."""

from apps.core import audit

TASK_FIELDS = [
    "code",
    "title",
    "description",
    "work_group",
    "direction",
    "workstream",
    "sub_objective",
    "owner_role",
    "planned_start",
    "planned_finish",
    "status",
    "approval",
    "approval_note",
]


def _join(*parts) -> str:
    return " · ".join(str(p) for p in parts if p)


def task_snapshot(task) -> dict:
    """The task's own fields, then one line per partner row and contribution."""
    if task is None:
        return {}
    out = audit.snapshot(task, TASK_FIELDS)
    for p in task.partners.select_related("work_group", "role", "needed_when").order_by("slot"):
        out[f"Partner {p.slot}"] = _join(
            f"{p.work_group.code} ({p.role.value if p.role_id else 'role not set'})",
            p.need and f"needs: {p.need}",
            p.needed_when.value if p.needed_when_id else "",
            p.their_task_ref and f"their task {p.their_task_ref}",
        )[: audit.MAX_VALUE]
    for c in task.contributions.select_related("to_group", "needed_when").order_by("slot"):
        out[f"Contribution {c.slot}"] = _join(
            c.to_group.code if c.to_group_id else "group not set",
            c.benefit and f"delivers: {c.benefit}",
            c.needed_when.value if c.needed_when_id else "",
            c.their_task_ref and f"their task {c.their_task_ref}",
        )[: audit.MAX_VALUE]
    return out


def activity_snapshot(activity) -> dict:
    if activity is None:
        return {}
    out = audit.snapshot(activity, ["name", "owner", "start_date", "finish_date"])
    out["Activity"] = activity.code
    preds = ", ".join(p.code for p in activity.predecessors.order_by("order"))
    out["Predecessors"] = preds or None
    return out
