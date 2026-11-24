"""
Two read-only pages built on the register (1.27):

* GET /api/tmo-desk/ — the TMO Action Center: every task its work group leader approved, waiting for the
  TMO to include it in the Master Plan or send it back, and the TMO's decisions of the last 30 days.
  TMO Officers and administrators.
* GET /api/reports/dependencies/[?work_group=<id>] — for the management board too: who depends on whom
  (every link between two work groups and its review), the links still open, and the decisions of the last
  30 days (leaders on tasks and links, the TMO on tasks).
* GET /api/reports/board-summary/[?work_group=<id>] — the management report: one summary of every
  register for the board, which the page saves as a PDF. POST …/exported/ records the download in the
  audit trail. Administrators, the TMO and Global Viewers (everyone who reads every register).
"""

from __future__ import annotations

from collections import defaultdict
from datetime import timedelta

from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts import roles
from apps.core import audit
from apps.masterdata.models import WorkGroup

from .models import Contribution, Decision, Task, TaskPartner
from .serializers import person
from .services.checks import check_task, is_ok
from .services.workdays import working_days
from .views import plan_rows, task_queryset

S = Task.Status
STAGES = [S.DRAFT, S.NEEDS_COMPLETION, S.READY, S.LEADER_APPROVED, S.IN_MASTER_PLAN]
DECIDED_DAYS = 30


def _days_since(when) -> int | None:
    if not when:
        return None
    return max(0, (timezone.localdate() - timezone.localtime(when).date()).days)


class TmoDeskView(APIView):
    @extend_schema(parameters=[OpenApiParameter("work_group", int)], responses={200: dict})
    def get(self, request):
        user = request.user
        if not (roles.is_tmo(user) or roles.is_admin(user)):
            raise PermissionDenied("The TMO Action Center is for TMO Officers and administrators.")
        qs = task_queryset().filter(status=S.LEADER_APPROVED)
        wg = request.query_params.get("work_group")
        if wg and str(wg).isdigit():
            qs = qs.filter(work_group_id=wg)
        rows = plan_rows(qs.select_related("approval_by"), user)
        for r in rows:
            r["waiting_days"] = _days_since(r["approval_at"])
        # Longest waiting first.
        rows.sort(key=lambda r: (-(r["waiting_days"] or 0), r["code"]))

        since = timezone.now() - timedelta(days=DECIDED_DAYS)
        decided_qs = Task.objects.select_related("work_group", "tmo_by").filter(tmo_at__gte=since)
        if wg and str(wg).isdigit():
            decided_qs = decided_qs.filter(work_group_id=wg)
        decided = [
            {
                "id": t.id,
                "code": t.code,
                "title": t.title,
                "work_group_code": t.work_group.code,
                # A reason is written only when the TMO sends a task back.
                "outcome": "returned" if t.tmo_note else "included",
                "note": t.tmo_note,
                "by": person(t.tmo_by),
                "at": t.tmo_at,
                "status": t.status,
            }
            for t in decided_qs.order_by("-tmo_at")[:50]
        ]
        return Response({"waiting": rows, "decided": decided, "decided_days": DECIDED_DAYS})


def _progress(tasks, today):
    """The share of the planned work due by today, weighted by working days (as on the Master Plan page)."""
    total = done = 0.0
    for t in tasks:
        if not (t.planned_start and t.planned_finish):
            continue
        w = working_days(t.planned_start, t.planned_finish) or 1
        total += w
        if today >= t.planned_start:
            d = working_days(t.planned_start, min(today, t.planned_finish)) or 0
            done += min(1.0, d / w) * w
    return round(done / total * 100) if total else 0


class BoardSummaryView(APIView):
    @extend_schema(parameters=[OpenApiParameter("work_group", int)], responses={200: dict})
    def get(self, request):
        if not roles.sees_all(request.user):
            raise PermissionDenied("The management report is for administrators, the TMO and Global Viewers.")
        today = timezone.localdate()
        groups = list(WorkGroup.objects.select_related("leader").order_by("code"))
        wg = request.query_params.get("work_group")
        scope = None
        qs = task_queryset().select_related("approval_by")
        if wg and str(wg).isdigit():
            scope = next((g for g in groups if g.id == int(wg)), None)
            qs = qs.filter(work_group_id=wg)
            groups = [scope] if scope else []
        tasks = list(qs)
        ok = {t.id: is_ok(check_task(t)) for t in tasks}
        by_status = {s.value: 0 for s in STAGES}
        for t in tasks:
            by_status[t.status] = by_status.get(t.status, 0) + 1
        included = [t for t in tasks if t.status == S.IN_MASTER_PLAN]
        dated = [t for t in included if t.planned_start and t.planned_finish]

        # Links with other groups: partner rows and contributions of these tasks.
        ids = [t.id for t in tasks]
        link_rows = list(TaskPartner.objects.filter(task_id__in=ids).values_list("review", flat=True)) + list(
            Contribution.objects.filter(task_id__in=ids).values_list("review", flat=True)
        )
        links = {
            "total": len(link_rows),
            "approved": sum(1 for r in link_rows if r == Decision.APPROVED),
            "pending": sum(1 for r in link_rows if r == Decision.PENDING),
            "rejected": sum(1 for r in link_rows if r == Decision.REJECTED),
        }

        per_group = defaultdict(list)
        for t in tasks:
            per_group[t.work_group_id].append(t)
        group_rows = []
        for g in groups:
            mine = per_group.get(g.id, [])
            counts = {s.value: sum(1 for t in mine if t.status == s) for s in STAGES}
            group_rows.append(
                {
                    "code": g.code,
                    "name": g.name,
                    "leader": person(g.leader),
                    "total": len(mine),
                    "by_status": counts,
                    "not_ok": sum(1 for t in mine if not ok[t.id]),
                    "ready_pct": round(
                        sum(1 for t in mine if t.status in (S.LEADER_APPROVED, S.IN_MASTER_PLAN)) / len(mine) * 100
                    )
                    if mine
                    else 0,
                    "progress": _progress([t for t in mine if t.status == S.IN_MASTER_PLAN], today),
                }
            )

        def brief(t, why: str, days: int | None = None) -> dict:
            return {"id": t.id, "code": t.code, "title": t.title, "group": t.work_group.code, "why": why, "days": days}

        attention = []
        for t in sorted(
            (t for t in tasks if t.status == S.LEADER_APPROVED), key=lambda t: t.approval_at or timezone.now()
        ):
            attention.append(brief(t, "waiting_tmo", _days_since(t.approval_at)))
        for t in sorted(
            (t for t in tasks if t.status == S.READY and t.approval == Decision.PENDING), key=lambda t: t.updated_at
        ):
            attention.append(brief(t, "waiting_leader", _days_since(t.updated_at)))
        for t in included:
            if not ok[t.id]:
                attention.append(brief(t, "plan_not_ok"))
        for t in included:
            if t.planned_finish and t.planned_finish < today:
                attention.append(brief(t, "past_finish", (today - t.planned_finish).days))

        horizon = today + timedelta(days=30)
        upcoming = []
        for t in included:
            if t.planned_finish and today <= t.planned_finish <= horizon:
                upcoming.append({"date": t.planned_finish, "what": "task", "code": t.code, "title": t.title})
            for a in t.activities.all():
                if today <= a.finish_date <= horizon:
                    upcoming.append({"date": a.finish_date, "what": "activity", "code": a.code, "title": a.name})
        upcoming.sort(key=lambda x: (x["date"], x["code"]))

        return Response(
            {
                "generated_at": timezone.now(),
                "prepared_by": person(request.user),
                "scope": {"code": scope.code, "name": scope.name} if scope else None,
                "totals": {
                    "tasks": len(tasks),
                    "groups": len(groups),
                    "by_status": by_status,
                    "ok": sum(1 for t in tasks if ok[t.id]),
                    "not_ok": sum(1 for t in tasks if not ok[t.id]),
                    "without_dates": sum(1 for t in tasks if not (t.planned_start and t.planned_finish)),
                },
                "plan": {
                    "included": len(included),
                    "waiting_tmo": by_status.get(S.LEADER_APPROVED, 0),
                    "progress": _progress(included, today),
                    "running": sum(1 for t in dated if t.planned_start <= today <= t.planned_finish),
                    "first_start": min((t.planned_start for t in dated), default=None),
                    "last_finish": max((t.planned_finish for t in dated), default=None),
                    "activities": sum(len(t.activities.all()) for t in included),
                },
                "links": links,
                "groups": group_rows,
                "attention": attention[:12],
                "attention_total": len(attention),
                "upcoming": upcoming[:10],
                "upcoming_total": len(upcoming),
            }
        )


class BoardSummaryExportedView(APIView):
    """The page saved the report as a PDF: one line in the audit trail."""

    @extend_schema(request=None, responses={204: None})
    def post(self, request):
        if not roles.sees_all(request.user):
            raise PermissionDenied("The management report is for administrators, the TMO and Global Viewers.")
        scope = str(request.data.get("scope") or "All work groups")[:40]
        report = " ".join(str(request.data.get("report") or "Board summary").split())[:60]
        audit.record(request.user, "export", "Report", None, f"Management board: {report} saved as PDF ({scope})")
        return Response(status=204)


class DependenciesView(APIView):
    @extend_schema(parameters=[OpenApiParameter("work_group", int)], responses={200: dict})
    def get(self, request):
        if not roles.sees_all(request.user):
            raise PermissionDenied("The management board is for administrators, the TMO and Global Viewers.")
        wg = request.query_params.get("work_group")
        wg = int(wg) if wg and str(wg).isdigit() else None
        groups = list(WorkGroup.objects.order_by("code").values("id", "code", "name"))
        code = {g["id"]: g["code"] for g in groups}
        names = {g["id"]: g["name"] for g in groups}

        # Every link: the task's group (from) and the other group (to). Partner rows: what the task needs from
        # the other group; contributions: what the task delivers to it.
        links = []
        for p in TaskPartner.objects.select_related("task", "task__work_group", "work_group"):
            links.append(("needs", p, p.task, p.work_group_id, p.need))
        for c in Contribution.objects.select_related("task", "task__work_group").filter(to_group__isnull=False):
            links.append(("delivers", c, c.task, c.to_group_id, c.benefit))
        if wg:
            links = [x for x in links if wg in (x[2].work_group_id, x[3])]

        cells = defaultdict(lambda: {"total": 0, "approved": 0, "pending": 0, "rejected": 0})
        for _kind, row, task, other, _what in links:
            cell = cells[(task.work_group_id, other)]
            cell["total"] += 1
            if row.review in ("approved", "pending", "rejected"):
                cell[row.review] += 1
        involved = sorted({a for a, _ in cells} | {b for _, b in cells}, key=lambda i: code.get(i, ""))
        if wg and wg not in involved:
            involved = [wg, *involved]
        matrix = [
            {"from": code[a], "to": code[b], **cells[(a, b)]} for a in involved for b in involved if (a, b) in cells
        ]

        today = timezone.localdate()
        open_links = []
        for kind, row, task, other, what in links:
            if row.review in ("approved",):
                continue
            open_links.append(
                {
                    "kind": kind,
                    "task": task.code,
                    "title": task.title,
                    "from": task.work_group.code,
                    "to": code.get(other, ""),
                    "what": what,
                    "review": row.review,
                    "note": row.review_note,
                    "days": (today - timezone.localtime(task.updated_at).date()).days,
                }
            )
        order = {"rejected": 0, "pending": 1}
        open_links.sort(key=lambda x: (order.get(x["review"], 2), -x["days"], x["task"]))

        since = timezone.now() - timedelta(days=DECIDED_DAYS)
        tasks = Task.objects.select_related("work_group", "approval_by", "tmo_by")
        if wg:
            tasks = tasks.filter(work_group_id=wg)
        decisions = []
        for t in tasks.filter(approval_at__gte=since).exclude(approval=Decision.PENDING):
            decisions.append(
                {"at": t.approval_at, "who": person(t.approval_by), "role": "leader", "subject": "task",
                 "code": t.code, "title": t.title, "group": t.work_group.code,
                 "decision": "approved" if t.approval == Decision.APPROVED else "rejected", "note": t.approval_note}
            )  # fmt: skip
        for t in tasks.filter(tmo_at__gte=since):
            decisions.append(
                {"at": t.tmo_at, "who": person(t.tmo_by), "role": "tmo", "subject": "task", "code": t.code,
                 "title": t.title, "group": t.work_group.code,
                 "decision": "returned" if t.tmo_note else "included", "note": t.tmo_note}
            )  # fmt: skip
        for _kind, row, task, other, what in links:
            if row.reviewed_at and row.reviewed_at >= since and row.review != Decision.PENDING:
                decisions.append(
                    {"at": row.reviewed_at, "who": person(row.reviewed_by), "role": "leader", "subject": "link",
                     "code": task.code, "title": what or task.title, "group": code.get(other, ""),
                     "decision": "approved" if row.review == Decision.APPROVED else "rejected", "note": row.review_note}
                )  # fmt: skip
        decisions.sort(key=lambda d: d["at"], reverse=True)

        totals = {
            "links": len(links),
            "approved": sum(1 for x in links if x[1].review == Decision.APPROVED),
            "pending": sum(1 for x in links if x[1].review == Decision.PENDING),
            "rejected": sum(1 for x in links if x[1].review == Decision.REJECTED),
            "groups": len(involved),
        }
        return Response(
            {
                "generated_at": timezone.now(),
                "prepared_by": person(request.user),
                "scope": next(({"code": g["code"], "name": g["name"]} for g in groups if g["id"] == wg), None),
                "groups": [{"code": code[i], "name": names[i]} for i in involved],
                "matrix": matrix,
                "totals": totals,
                "open_links": open_links[:60],
                "open_total": len(open_links),
                "decisions": decisions[:60],
                "decisions_total": len(decisions),
                "decided_days": DECIDED_DAYS,
            }
        )
