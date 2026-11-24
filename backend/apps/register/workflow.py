"""
A task's way through the readiness flow, for the status timeline on its page: who did each step and when.

The steps come from the audit trail (created, submitted, withdrawn, the leader's decision, the TMO's
decision, other status changes). Tasks older than their audit entries (loaded data, restored backups)
are completed from the task's own fields: who created it, the leader's decision and the TMO's decision.
"""

from apps.core.models import AuditLog

from .models import Decision, Task

S = Task.Status
LABEL = dict(S.choices)
BY_LABEL = {v: k for k, v in LABEL.items()}
# Who usually takes each step, shown next to the person's name.
ROLE = {
    "created": "Focal Point",
    "submitted": "Focal Point",
    "withdrawn": "Focal Point",
    "status": "Focal Point",
    "leader_approved": "Leader",
    "leader_rejected": "Leader",
    "included": "TMO",
    "sent_back": "TMO",
}


def _name(user, fallback: str = "") -> str:
    return (user.get_full_name() or user.get_username()) if user else fallback


def _after(changes: dict, key: str):
    v = (changes or {}).get(key)
    return v[1] if isinstance(v, list) and len(v) == 2 else None


def _before(changes: dict, key: str):
    v = (changes or {}).get(key)
    return v[0] if isinstance(v, list) and len(v) == 2 else None


def _event(kind, at, by, to=None, frm=None, note=""):
    return {
        "kind": kind,
        "at": at,
        "by": by or "",
        "role": ROLE.get(kind, ""),
        "from_status": frm,
        "to_status": to,
        "note": note or "",
    }


def task_workflow(task: Task) -> dict:
    entries = (
        AuditLog.objects.filter(entity="Task", entity_id=str(task.pk), action__in=["create", "transition", "approval"])
        .select_related("actor")
        .order_by("created_at", "id")
    )
    events = []
    for e in entries:
        by = _name(e.actor, e.actor_name)
        ch = e.changes or {}
        if e.action == "create":
            to = BY_LABEL.get(_after(ch, "Readiness status") or "", S.DRAFT)
            events.append(_event("created", e.created_at, by, to=to))
        elif e.action == "approval":
            decision = _after(ch, "Decision")
            to = BY_LABEL.get(_after(ch, "Readiness status") or "")
            kind = "leader_approved" if decision == Decision.APPROVED.label else "leader_rejected"
            events.append(_event(kind, e.created_at, by, to=to, frm=S.READY, note=_after(ch, "Note") or ""))
        else:
            frm = BY_LABEL.get(_before(ch, "Readiness status") or "")
            to = BY_LABEL.get(_after(ch, "Readiness status") or "")
            if to == S.READY:
                kind = "submitted"
            elif frm == S.READY and to == S.DRAFT:
                kind = "withdrawn"
            elif to == S.IN_MASTER_PLAN:
                kind = "included"
            elif to == S.NEEDS_COMPLETION and frm in (S.LEADER_APPROVED, S.IN_MASTER_PLAN):
                kind = "sent_back"
            else:
                kind = "status"
            events.append(_event(kind, e.created_at, by, to=to, frm=frm, note=_after(ch, "TMO note") or ""))

    kinds = {e["kind"] for e in events}
    filled = []  # the start steps completed from the task's fields, not from the audit trail
    # Completed from the task's fields when the audit trail does not have the step.
    if "created" not in kinds:
        filled.append(_event("created", task.created_at, _name(task.created_by, "Data load"), to=S.DRAFT))
    decided = task.approval in (Decision.APPROVED, Decision.REJECTED, Decision.CLARIFICATION)
    if task.approval_at and decided and not kinds & {"leader_approved", "leader_rejected"}:
        kind = "leader_approved" if task.approval == Decision.APPROVED else "leader_rejected"
        to = S.LEADER_APPROVED if kind == "leader_approved" else S.NEEDS_COMPLETION
        events.append(
            _event(kind, task.approval_at, _name(task.approval_by), to=to, frm=S.READY, note=task.approval_note)
        )
    if task.tmo_at and not kinds & {"included", "sent_back"}:
        if task.tmo_note:
            events.append(
                _event("sent_back", task.tmo_at, _name(task.tmo_by), to=S.NEEDS_COMPLETION, note=task.tmo_note)
            )
        elif task.status == S.IN_MASTER_PLAN:
            events.append(
                _event("included", task.tmo_at, _name(task.tmo_by), to=S.IN_MASTER_PLAN, frm=S.LEADER_APPROVED)
            )
    # A task loaded or moved before the audit trail had the step: it was submitted when it was created.
    reached = task.status in (S.READY, S.LEADER_APPROVED, S.IN_MASTER_PLAN)
    if "submitted" not in kinds and (reached or any(e["kind"].startswith("leader_") for e in events)):
        created = next((e for e in events + filled if e["kind"] == "created"), None)
        at, by = (created["at"], created["by"]) if created else (task.created_at, "")
        filled.append(_event("submitted", at, by, to=S.READY, frm=S.DRAFT))
    # Included before the TMO's decision was recorded: when and by whom is not known.
    if task.status == S.IN_MASTER_PLAN and "included" not in {e["kind"] for e in events}:
        events.append(_event("included", None, "", to=S.IN_MASTER_PLAN, frm=S.LEADER_APPROVED))
    # A completed start step never comes after a recorded step (a sample loaded after its decisions).
    dated = [e["at"] for e in events if e["at"]]
    for e in filled:
        if dated and e["at"] and e["at"] > min(dated):
            e["at"] = min(dated)
    events = filled + events
    events.sort(key=lambda e: (e["at"] is None, e["at"]))
    return {"status": task.status, "events": events}
