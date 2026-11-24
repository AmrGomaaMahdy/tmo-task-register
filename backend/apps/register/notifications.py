"""
The action centre: what each person has to do now, worked out from the register itself.

Nothing is stored per notification. An item exists while the work waits for the person and goes away as
soon as it is done (by them or by anyone else with the right), so the list is never stale. Only the time
the person last opened the list is kept (NotificationState), to mark the items that arrived since as new.

  Focal Point   tasks of the group sent back (rejected by the leader or returned by the TMO, with the
                reason); other tasks of the group in Needs completion; links on the group's tasks that the
                other group's leader rejected, while the task can still be edited.
  Team Leader   the group's tasks Ready to include (approve or reject); links other groups record with the
                group, waiting for review.
  TMO Officer   Leader Approved tasks (include in the Master Plan or send back).

Administrators can do all of it but are not part of the flow, so they get only what their other roles give.
"""

from django.utils import timezone

from apps.accounts import roles
from apps.core.models import AuditLog

from .models import Contribution, Decision, NotificationState, Task, TaskPartner

S = Task.Status
READY_LABEL = dict(S.choices)[S.READY]
LEADER_RETURN = (Decision.REJECTED, Decision.CLARIFICATION)


def _name(user) -> str:
    return (user.get_full_name() or user.get_username()) if user else ""


def _ts(dt) -> int:
    return int(dt.timestamp()) if dt else 0


def _task(t: Task) -> dict:
    return {"id": t.id, "code": t.code, "title": t.title, "status": t.status, "work_group_code": t.work_group.code}


def _item(key, kind, role, task, at, by="", note="", url="", link=None) -> dict:
    return {
        "key": key,
        "kind": kind,
        "role": role,
        "task": _task(task),
        "at": at,
        "by": by,
        "note": note or "",
        "url": url or f"/tasks/{task.id}?act={kind}",
        "link": link,
    }


def _submissions(task_ids) -> dict[int, tuple]:
    """For each task, who submitted it to the leader last and when (from the audit trail)."""
    found: dict[int, tuple] = {}
    if not task_ids:
        return found
    entries = (
        AuditLog.objects.filter(entity="Task", entity_id__in=[str(i) for i in task_ids], action="transition")
        .select_related("actor")
        .order_by("created_at")
    )
    for e in entries:
        after = (e.changes or {}).get("Readiness status")
        if isinstance(after, list) and len(after) == 2 and after[1] == READY_LABEL:
            found[int(e.entity_id)] = (e.created_at, _name(e.actor) or e.actor_name)
    return found


def action_items(user) -> list[dict]:
    items: list[dict] = []
    base = Task.objects.select_related("work_group", "approval_by", "tmo_by", "updated_by")

    # Focal Point (the leader too: full control of the group).
    groups = roles.work_group_ids(user)
    if groups:
        for t in base.filter(work_group_id__in=groups, status=S.NEEDS_COMPLETION):
            leader = t.approval in LEADER_RETURN and t.approval_at
            tmo = bool(t.tmo_note) and t.tmo_at
            if tmo and (not leader or t.tmo_at >= t.approval_at):
                items.append(
                    _item(
                        f"tmo-back-{t.id}-{_ts(t.tmo_at)}",
                        "returned_tmo",
                        "Focal Point",
                        t,
                        t.tmo_at,
                        _name(t.tmo_by),
                        t.tmo_note,
                    )
                )
            elif leader:
                items.append(
                    _item(
                        f"leader-back-{t.id}-{_ts(t.approval_at)}",
                        "returned_leader",
                        "Focal Point",
                        t,
                        t.approval_at,
                        _name(t.approval_by),
                        t.approval_note,
                    )
                )
            else:
                items.append(_item(f"complete-{t.id}", "complete", "Focal Point", t, t.updated_at, _name(t.updated_by)))
        for model, kind in ((TaskPartner, "partner"), (Contribution, "contribution")):
            rows = model.objects.filter(
                task__work_group_id__in=groups, task__status__in=roles.EDITABLE, review=Decision.REJECTED
            ).select_related("task__work_group", "reviewed_by", "work_group" if model is TaskPartner else "to_group")
            for r in rows:
                other = r.work_group if model is TaskPartner else r.to_group
                items.append(
                    _item(
                        f"link-rejected-{kind}-{r.id}-{_ts(r.reviewed_at)}"
                        if r.reviewed_at
                        else f"link-rejected-{kind}-{r.id}",
                        "link_rejected",
                        "Focal Point",
                        r.task,
                        r.reviewed_at,
                        _name(r.reviewed_by),
                        r.review_note,
                        url=f"/tasks/{r.task_id}?act=link_rejected&tab=links",
                        link={"kind": kind, "id": r.id, "group_code": other.code if other else ""},
                    )
                )

    # Team Leader.
    led = roles.decide_group_ids(user)  # the groups they lead, and those they stand in for
    if led:
        ready = list(base.filter(work_group_id__in=led, status=S.READY))
        sub = _submissions([t.id for t in ready])
        for t in ready:
            at, by = sub.get(t.id, (t.updated_at, _name(t.updated_by)))
            items.append(_item(f"decide-{t.id}-{_ts(at)}", "decide", "Leader", t, at, by))
        for model, kind in ((TaskPartner, "partner"), (Contribution, "contribution")):
            group_field = "work_group_id__in" if model is TaskPartner else "to_group_id__in"
            rows = (
                model.objects.filter(**{group_field: led}, review=Decision.PENDING)
                .exclude(task__work_group_id__in=led)
                .exclude(task__status=S.IN_MASTER_PLAN)
                .select_related("task__work_group", "task__updated_by")
            )
            for r in rows:
                items.append(
                    _item(
                        f"review-{kind}-{r.id}",
                        "review_link",
                        "Leader",
                        r.task,
                        r.task.updated_at,
                        _name(r.task.updated_by),
                        r.need if model is TaskPartner else r.benefit,
                        url=f"/governance?tab=links&link={kind}-{r.id}",
                        link={"kind": kind, "id": r.id, "group_code": r.task.work_group.code},
                    )
                )

    # TMO Officer.
    if roles.TMO in roles.roles_of(user):
        for t in base.filter(status=S.LEADER_APPROVED):
            items.append(
                _item(
                    f"include-{t.id}-{_ts(t.approval_at)}" if t.approval_at else f"include-{t.id}",
                    "include",
                    "TMO",
                    t,
                    t.approval_at or t.updated_at,
                    _name(t.approval_by),
                    t.approval_note,
                )
            )

    # Most urgent first: work sent back, then decisions, then the rest; newest first within each.
    rank = {
        "returned_tmo": 0,
        "returned_leader": 0,
        "link_rejected": 1,
        "decide": 2,
        "include": 2,
        "review_link": 3,
        "complete": 4,
    }
    items.sort(key=lambda i: (rank[i["kind"]], -(i["at"].timestamp() if i["at"] else 0)))
    return items


def notifications_for(user) -> dict:
    state = NotificationState.objects.filter(user=user).first()
    seen = state.seen_at if state else None
    items = action_items(user)
    for i in items:
        i["new"] = bool(i["at"] and (seen is None or i["at"] > seen))
    return {"count": len(items), "new": sum(1 for i in items if i["new"]), "seen_at": seen, "items": items}


def mark_seen(user) -> None:
    NotificationState.objects.update_or_create(user=user, defaults={"seen_at": timezone.now()})
