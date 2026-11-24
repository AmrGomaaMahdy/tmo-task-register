from collections import defaultdict
from datetime import timedelta

from django.db.models import Prefetch
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.accounts import roles
from apps.core import audit
from apps.masterdata.models import Direction, LookupValue, WorkGroup

from . import visibility
from .auditing import activity_snapshot, task_snapshot
from .filters import ContributionFilter, PartnerFilter, TaskFilter
from .models import Activity, Contribution, Decision, Task, TaskPartner
from .notifications import mark_seen, notifications_for
from .serializers import (
    ActivitySerializer,
    ContributionLinkSerializer,
    DecisionSerializer,
    PartnerLinkSerializer,
    SharedTaskSerializer,
    TaskDirectorySerializer,
    TaskListSerializer,
    TaskSerializer,
    TransitionSerializer,
    contribution_data,
    partner_data,
    person,
)
from .services.checks import (
    Issue,
    activity_issues,
    check_task,
    contribution_issues,
    is_ok,
    links_out,
    partner_issues,
    summary,
)
from .services.workdays import working_days
from .workflow import task_workflow


def task_queryset():
    return Task.objects.select_related(
        "work_group", "direction", "workstream", "sub_objective", "owner_role", "updated_by"
    ).prefetch_related(
        Prefetch("partners", queryset=TaskPartner.objects.select_related("work_group", "their_task")),
        Prefetch(
            "activities",
            queryset=Activity.objects.select_related("task__work_group", "owner__work_group").prefetch_related(
                "predecessors__task"
            ),
        ),
        Prefetch("contributions", queryset=Contribution.objects.select_related("to_group", "their_task")),
    )


def link_row(kind, row, task, group, what, user) -> dict:
    """A partner row or a contribution as the reviewing group's leader sees it."""
    return {
        "kind": kind,
        "id": row.id,
        "task": task.id,
        "task_code": task.code,
        "task_title": task.title,
        "from_group": task.work_group.code,
        "group": group.code,
        "role": row.role.value if kind == "partner" and row.role_id else "",
        # The other group's task type: a Direct task naming us as partner, or an Enable / Support task.
        "owner_role": task.owner_role.value if task.owner_role_id else "",
        "what": what,
        "needed_when": row.needed_when.value if row.needed_when_id else "",
        "their_task_ref": row.their_task_ref,
        "planned_start": task.planned_start,
        "planned_finish": task.planned_finish,
        "review": row.review,
        "review_note": row.review_note,
        "review_date": row.review_date,
        "reviewed_by_name": person(row.reviewed_by),
        "reviewed_at": row.reviewed_at,
        "can_review": roles.can_review_link(user, group.id),
    }


class ReviewMixin:
    """POST …/<id>/review/: the leader of the group a link points to answers it."""

    review_group_field = "work_group_id"
    entity = "Link"

    @extend_schema(request=DecisionSerializer, responses={200: dict})
    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        row = self.get_object()
        if not roles.can_review_link(request.user, getattr(row, self.review_group_field)):
            raise PermissionDenied("Only the leader of the group this link points to can review it.")
        s = DecisionSerializer(data=request.data, context={"link": True})
        s.is_valid(raise_exception=True)
        before = {
            "Decision": row.get_review_display(),
            "Note": row.review_note or None,
            "Proposed date": audit.display(row.review_date),
        }
        row.review = s.validated_data["decision"]
        row.review_note = s.validated_data["note"]
        row.review_date = s.validated_data["proposed_date"] if row.review == Decision.TIMELINE else None
        row.reviewed_by = request.user
        row.reviewed_at = timezone.now()
        row.save(update_fields=["review", "review_note", "review_date", "reviewed_by", "reviewed_at"])
        after = {
            "Decision": row.get_review_display(),
            "Note": row.review_note or None,
            "Proposed date": audit.display(row.review_date),
        }
        audit.record(
            request.user,
            "review",
            self.entity,
            row.task,
            f"{row}: {row.get_review_display()}",
            changes=audit.diff(before, after),
        )
        return Response(self.get_serializer(row).data)


def plan_rows(qs, user) -> list:
    """Rows for the Master Plan and the timelines: dates, stage, links and activities of each task."""
    rows = []
    for t in qs:
        issues = check_task(t)
        rows.append(
            {
                "id": t.id,
                "code": t.code,
                "title": t.title,
                "status": t.status,
                "work_group": t.work_group_id,
                "work_group_code": t.work_group.code,
                "direction": t.direction_id,
                "direction_code": t.direction.code if t.direction else None,
                "direction_title": t.direction.title if t.direction else "",
                "workstream": t.workstream_id,
                "workstream_value": t.workstream.value if t.workstream_id else "",
                "owner_role": t.owner_role.value if t.owner_role_id else "",
                "partner_codes": [p.work_group.code for p in t.partners.all()],
                "planned_start": t.planned_start,
                "planned_finish": t.planned_finish,
                "duration_days": working_days(t.planned_start, t.planned_finish),
                "check_summary": summary(issues),
                "approval": t.approval,
                "approval_by_name": person(t.approval_by),
                "approval_at": t.approval_at,
                "can_include": "in_master_plan" in roles.allowed_transitions(user, t),
                "can_return": t.status in ("leader_approved", "in_master_plan")
                and "needs_completion" in roles.allowed_transitions(user, t),
                "can_release": t.status == "in_master_plan"
                and "needs_completion" in roles.allowed_transitions(user, t),
                "activities": [
                    {
                        "id": a.id,
                        "code": a.code,
                        "name": a.name,
                        "owner": a.owner_id,
                        "owner_name": a.owner.name if a.owner_id else "",
                        "start_date": a.start_date,
                        "finish_date": a.finish_date,
                        "duration_days": working_days(a.start_date, a.finish_date),
                        "predecessors": [p.code for p in a.predecessors.all()],
                    }
                    for a in t.activities.all()
                ],
                "waits_for": [p.their_task_ref or f"{p.work_group.code} (task no. missing)" for p in t.partners.all()],
            }
        )
    return rows


class TaskViewSet(viewsets.ModelViewSet):
    """
    Tasks. Administrators, the TMO and viewers read every register; a team reads its own register in full
    and sees other groups' tasks only where they are linked to its own (short form, see retrieve).
    """

    filterset_class = TaskFilter
    search_fields = ["code", "title", "description"]
    ordering_fields = ["code", "planned_start", "planned_finish", "updated_at", "title"]

    def get_queryset(self):
        return visibility.tasks(self.request.user, task_queryset())

    def retrieve(self, request, *args, **kwargs):
        try:
            return super().retrieve(request, *args, **kwargs)
        except Http404:
            # Not in the user's own register: show the shared part if the task is linked to their group.
            task = get_object_or_404(task_queryset(), pk=kwargs.get("pk"))
            if not visibility.is_shared_with(request.user, task):
                raise
            return Response(SharedTaskSerializer(task, context=self.get_serializer_context()).data)

    @extend_schema(
        parameters=[OpenApiParameter("work_group", int)], responses={200: TaskDirectorySerializer(many=True)}
    )
    @action(detail=False, methods=["get"], pagination_class=None)
    def directory(self, request):
        """Code and title of every task (optionally of one work group), to choose 'their task' for a link."""
        qs = Task.objects.select_related("work_group").order_by("code")
        if wg := request.query_params.get("work_group"):
            qs = qs.filter(work_group_id=wg)
        return Response(TaskDirectorySerializer(qs, many=True).data)

    def get_serializer_class(self):
        return TaskListSerializer if self.action == "list" else TaskSerializer

    @extend_schema(parameters=[OpenApiParameter("check", str, enum=["ok", "not_ok"])])
    def list(self, request, *args, **kwargs):
        qs = self.filter_queryset(self.get_queryset())
        wanted = request.query_params.get("check")
        if wanted in ("ok", "not_ok"):
            keep = wanted == "ok"
            qs = [t for t in qs if is_ok(check_task(t)) == keep]
        page = self.paginate_queryset(qs)
        serializer = self.get_serializer(page, many=True)
        return self.get_paginated_response(serializer.data)

    def create(self, request, *args, **kwargs):
        # Refuse users who cannot add tasks anywhere before looking at their data.
        if not (roles.is_admin(request.user) or roles.work_group_ids(request.user)):
            raise PermissionDenied("Only a work group's team or an administrator can add tasks.")
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        wg = serializer.validated_data["work_group"]
        if not roles.can_create_task(self.request.user, wg.id):
            raise PermissionDenied("You can add tasks only to your own work group's register.")
        task = serializer.save(created_by=self.request.user, updated_by=self.request.user)
        audit.record(
            self.request.user,
            "create",
            "Task",
            task,
            f"{task.code} added as {task.get_status_display()}",
            changes=audit.created(task_snapshot(task)),
        )

    def perform_update(self, serializer):
        if not roles.can_edit_task(self.request.user, serializer.instance):
            raise PermissionDenied("You cannot change this task.")
        before = task_snapshot(serializer.instance)
        task = serializer.save(updated_by=self.request.user)
        changes = audit.diff(before, task_snapshot(task))
        fields = ", ".join(list(changes)[:4]) + ("…" if len(changes) > 4 else "")
        audit.record(
            self.request.user,
            "update",
            "Task",
            task,
            f"{task.code} edited" + (f": {fields}" if fields else ""),
            changes=changes,
        )

    def perform_destroy(self, instance):
        if not roles.can_delete_task(self.request.user, instance):
            raise PermissionDenied(
                "The group's Focal Point or leader deletes a task while it is Draft or Needs completion."
            )
        code, group = instance.code, instance.work_group.code
        before = task_snapshot(instance)
        # The task's activities, partner rows and contributions are deleted with it (on_delete=CASCADE).
        before["Activities deleted"] = instance.activities.count() or None
        reason = " ".join(str(self.request.data.get("reason") or "").split())[:500]
        if reason:
            before["Reason"] = reason
        instance.delete()
        audit.record(
            self.request.user,
            "delete",
            "Task",
            None,
            f"{code} deleted",
            label=code,
            changes=audit.deleted(before),
            work_group=group,
        )

    @extend_schema(request=TransitionSerializer, responses={200: TaskSerializer})
    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None):
        """
        Move a task through the lifecycle. The group: Draft / Needs completion → Ready to include (and back
        to Draft to withdraw it). The TMO: Leader Approved → In Master Plan, or back to Needs completion with
        a reason; In Master Plan → Needs completion with a reason. The leader decides through `approval`.
        """
        task = self.get_object()
        s = TransitionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        target, note = s.validated_data["status"], s.validated_data["note"]
        if target not in roles.allowed_transitions(request.user, task):
            raise PermissionDenied("You cannot move this task to that status.")
        S = Task.Status
        fields = ["status", "updated_by", "updated_at"]
        changes = {}
        if target == S.IN_MASTER_PLAN:
            if task.approval != Decision.APPROVED and not roles.is_admin(request.user):
                raise ValidationError({"status": "The work group leader approves the task before the Master Plan."})
            task.status = S.READY  # check it as a Ready task
            if not is_ok(check_task(task)):
                raise ValidationError(
                    {"status": "The task's check is not OK. Fix it before including it in the Master Plan."}
                )
        # Sent back to the group by the TMO: the reason is required and shown on the task.
        tmo_return = target == S.NEEDS_COMPLETION and task.status in (S.LEADER_APPROVED, S.IN_MASTER_PLAN)
        if tmo_return:
            if not note:
                raise ValidationError({"note": "Write the reason, so the group knows what to complete."})
            task.tmo_note, task.tmo_by, task.tmo_at = note, request.user, timezone.now()
            fields += ["tmo_note", "tmo_by", "tmo_at"]
            changes["TMO note"] = [None, note]
        if target == S.IN_MASTER_PLAN:
            task.tmo_note, task.tmo_by, task.tmo_at = "", request.user, timezone.now()
            fields += ["tmo_note", "tmo_by", "tmo_at"]
        # Submitted again, or sent back: the leader decides again on the new version.
        if target == S.READY or tmo_return:
            if task.approval != Decision.PENDING:
                changes["Leader's decision"] = [task.get_approval_display(), "Waiting"]
            task.approval, task.approval_note, task.approval_by, task.approval_at = Decision.PENDING, "", None, None
            fields += ["approval", "approval_note", "approval_by", "approval_at"]
        before = Task.objects.get(pk=task.pk).get_status_display()
        task.status = target
        task.updated_by = request.user
        task.save(update_fields=fields)
        audit.record(
            request.user,
            "transition",
            "Task",
            task,
            f"{task.code}: {before} → {task.get_status_display()}" + (f" ({note})" if note else ""),
            changes={"Readiness status": [before, task.get_status_display()], **changes},
        )
        return Response(TaskSerializer(task, context=self.get_serializer_context()).data)

    @extend_schema(request=TaskSerializer, responses={200: dict})
    @action(detail=False, methods=["post"], url_path="check-draft")
    def check_draft(self, request):
        """Run the automatic check on unsaved form data (the live check in the task form)."""
        instance = None
        if request.data.get("id"):
            instance = get_object_or_404(self.get_queryset(), pk=request.data["id"])
        # Blank inputs are what the check reports on, so they are left out of validation.
        data = {k: v for k, v in request.data.items() if v not in ("", None) or k in ("partners", "contributions")}
        context = {**self.get_serializer_context(), "live_check": True}
        s = TaskSerializer(instance=instance, data=data, partial=True, context=context)
        if not s.is_valid():
            issues = [
                {
                    "field": field,
                    "label": field.replace("_", " ").capitalize(),
                    "message": str(msgs[0]),
                    "level": "error",
                }
                for field, msgs in s.errors.items()
                if isinstance(msgs, list) and msgs
            ]
            return Response({"checks": issues, "check_summary": None, "errors": s.errors})
        task, partners, contributions = s.build_unsaved()
        if not task.work_group_id:
            return Response({"checks": [], "check_summary": None})
        issues = check_task(task, partners, contributions)
        labels = {"planned_start": "Planned start", "planned_finish": "Planned finish"}
        for field, message in getattr(s, "live_problems", {}).items():
            issues.append(Issue(field, labels.get(field, field), str(message), "error"))
        return Response({"checks": [i.as_dict() for i in issues], "check_summary": summary(issues)})

    @extend_schema(parameters=[OpenApiParameter("work_group", int)], responses={200: dict})
    @action(detail=False, methods=["get"])
    def summary(self, request):
        """
        Figures for the Overview and Check pages: the counts of sheet 5 (Check) of the template.
        A team's figures cover its own register only.
        """
        qs = self.get_queryset()
        wg = request.query_params.get("work_group")
        if wg:
            qs = qs.filter(work_group_id=wg)
        tasks = list(qs)
        issues = {t.id: check_task(t) for t in tasks}
        by_status = defaultdict(int)
        for t in tasks:
            by_status[t.status] += 1
        ready = [t for t in tasks if t.status in ("ready", "leader_approved", "in_master_plan")]
        dirs = (
            Direction.objects.all()
            if roles.sees_all(request.user)
            else Direction.objects.filter(work_group__in=roles.view_group_ids(request.user))
        )
        if wg:
            dirs = dirs.filter(work_group_id=wg)
        problems = defaultdict(lambda: {"errors": 0, "warnings": 0})
        for lst in issues.values():
            for i in lst:
                problems[i.label]["errors" if i.level == "error" else "warnings"] += 1

        partner_rows = [p for t in tasks for p in t.partners.all()]
        partner_bad = sum(
            1 for t in tasks for p in t.partners.all() if partner_issues(partner_data(p), t.work_group_id)
        )
        helping = [t for t in tasks if links_out(t)]
        # One row per contribution; an Enable / Support task with none counts as one row to fill in.
        con_rows = [
            contribution_issues(c, t.work_group_id)
            for t in helping
            for c in ([contribution_data(x) for x in t.contributions.all()] or [None])
        ]
        acts = [a for t in tasks for a in t.activities.all()]
        acts_bad = sum(
            1 for t in tasks for a in t.activities.all() if activity_issues(a, t.planned_start, t.planned_finish)
        )
        subs = LookupValue.objects.filter(list_key="sub_objective")
        today = timezone.localdate()
        horizon = today + timedelta(days=60)
        soon = []
        for t in tasks:
            for when, what in ((t.planned_start, "Task starts"), (t.planned_finish, "Task finishes")):
                if when and today <= when <= horizon:
                    soon.append(
                        {
                            "task_id": t.id,
                            "code": t.code,
                            "title": t.title,
                            "status": t.status,
                            "what": what,
                            "date": when,
                        }
                    )
            for a in t.activities.all():
                if today <= a.finish_date <= horizon:
                    soon.append(
                        {
                            "task_id": t.id,
                            "code": t.code,
                            "title": t.title,
                            "status": t.status,
                            "what": f"{a.code[-3:]} · {a.name}",
                            "date": a.finish_date,
                        }
                    )
        soon.sort(key=lambda x: x["date"])
        return Response(
            {
                "total": len(tasks),
                "by_status": by_status,
                "with_sub_objective": sum(1 for t in tasks if t.sub_objective_id),
                "ready_ok": sum(1 for t in ready if is_ok(issues[t.id])),
                "ready_not_ok": sum(1 for t in ready if not is_ok(issues[t.id])),
                "needs_completion": by_status.get("needs_completion", 0),
                "readiness_not_set": by_status.get("draft", 0),
                "not_ok": sum(1 for t in tasks if not is_ok(issues[t.id])),
                "without_dates": sum(1 for t in tasks if not (t.planned_start and t.planned_finish)),
                "by_owner_role": [
                    {"id": r.id, "value": r.value, "count": sum(1 for t in tasks if t.owner_role_id == r.id)}
                    for r in LookupValue.objects.filter(list_key="owner_role")
                ],
                "contributions": len(con_rows),
                "contributions_not_complete": sum(1 for x in con_rows if x),
                "shared_with_partners": sum(1 for t in tasks if t.partners.all()),
                "partner_rows": len(partner_rows),
                "partner_rows_not_complete": partner_bad,
                "with_activities": sum(1 for t in tasks if t.activities.all()),
                "activities": len(acts),
                "activities_not_ok": acts_bad,
                "by_direction": [
                    {
                        "id": d.id,
                        "code": d.code,
                        "title": d.title,
                        "count": sum(1 for t in tasks if t.direction_id == d.id),
                    }
                    for d in dirs
                ],
                "by_workstream": [
                    {
                        "id": w.id,
                        "value": w.value,
                        "definition": w.definition,
                        "count": sum(1 for t in tasks if t.workstream_id == w.id),
                    }
                    for w in LookupValue.objects.filter(list_key="workstream")
                ],
                "sub_objectives": [
                    {"id": x.id, "value": x.value, "count": sum(1 for t in tasks if t.sub_objective_id == x.id)}
                    for x in subs
                ],
                "problems_by_field": sorted(
                    ({"label": k, **v} for k, v in problems.items()), key=lambda x: -(x["errors"] + x["warnings"])
                ),
                "coming_up": soon[:100],  # the Overview pages them
                "links_by_group": self._links_by_group(tasks, wg),
                "drill": self._drill(tasks, issues, ready, helping),
            }
        )

    @staticmethod
    def _links_by_group(tasks, wg):
        """
        For the Links page: per other work group, how many partner rows say what our tasks need from it
        and how many contributions our Enable / Support tasks deliver to it. Drill sets
        "need_from:<code>" and "deliver_to:<code>" hold the tasks behind each count.
        """
        need: dict[str, int] = defaultdict(int)
        deliver: dict[str, int] = defaultdict(int)
        for t in tasks:
            for p in t.partners.all():
                need[p.work_group.code] += 1
            if links_out(t):
                for c in t.contributions.all():
                    if c.to_group_id:
                        deliver[c.to_group.code] += 1
        groups = WorkGroup.objects.filter(is_active=True)
        if wg:
            groups = groups.exclude(pk=wg)
        return [
            {"id": g.id, "code": g.code, "name": g.name, "need": need[g.code], "deliver": deliver[g.code]}
            for g in groups
        ]

    @staticmethod
    def _drill(tasks, issues, ready, helping) -> dict:
        """
        The tasks behind every count, so a number on the Overview or Check page opens its list.
        "rows" holds each task once; "sets" maps a count to the ids of its tasks.
        """

        def first_problem(t) -> str:
            errors = [i for i in issues[t.id] if i.level == "error"] or issues[t.id]
            return f"{errors[0].label}: {errors[0].message}" if errors else ""

        def bad_partner(t) -> bool:
            return any(partner_issues(partner_data(p), t.work_group_id) for p in t.partners.all())

        def bad_contribution(t) -> bool:
            cons = [contribution_data(c) for c in t.contributions.all()] or [None]
            return any(contribution_issues(c, t.work_group_id) for c in cons)

        def ids(items) -> list[int]:
            return [t.id for t in items]

        sets: dict[str, list[int]] = {
            "total": ids(tasks),
            "ready_ok": ids(t for t in ready if is_ok(issues[t.id])),
            "ready_not_ok": ids(t for t in ready if not is_ok(issues[t.id])),
            "needs_completion": ids(t for t in tasks if t.status == "needs_completion"),
            "readiness_not_set": ids(t for t in tasks if t.status == "draft"),
            "not_ok": ids(t for t in tasks if not is_ok(issues[t.id])),
            "without_dates": ids(t for t in tasks if not (t.planned_start and t.planned_finish)),
            "with_sub_objective": ids(t for t in tasks if t.sub_objective_id),
            "shared_with_partners": ids(t for t in tasks if t.partners.all()),
            "partner_rows_not_complete": ids(t for t in tasks if bad_partner(t)),
            "contributions": ids(helping),
            "contributions_not_complete": ids(t for t in helping if bad_contribution(t)),
            "with_activities": ids(t for t in tasks if t.activities.all()),
            "activities_not_ok": ids(
                t
                for t in tasks
                if any(activity_issues(a, t.planned_start, t.planned_finish) for a in t.activities.all())
            ),
        }
        for t in tasks:
            sets.setdefault(f"status:{t.status}", []).append(t.id)
            for key, value in (
                ("owner_role", t.owner_role_id),
                ("direction", t.direction_id),
                ("workstream", t.workstream_id),
                ("sub_objective", t.sub_objective_id),
            ):
                if value:
                    sets.setdefault(f"{key}:{value}", []).append(t.id)
            for label in {i.label for i in issues[t.id]}:
                sets.setdefault(f"field:{label}", []).append(t.id)
            for code in dict.fromkeys(p.work_group.code for p in t.partners.all()):
                sets.setdefault(f"need_from:{code}", []).append(t.id)
            if links_out(t):
                for code in dict.fromkeys(c.to_group.code for c in t.contributions.all() if c.to_group_id):
                    sets.setdefault(f"deliver_to:{code}", []).append(t.id)
        rows = [
            {
                "id": t.id,
                "code": t.code,
                "title": t.title,
                "work_group_code": t.work_group.code,
                "status": t.status,
                "owner_role": t.owner_role.value if t.owner_role_id else "",
                "planned_start": t.planned_start,
                "planned_finish": t.planned_finish,
                "duration_days": working_days(t.planned_start, t.planned_finish),
                "check_summary": summary(issues[t.id]),
                "problem": first_problem(t),
                "partner_codes": [p.work_group.code for p in t.partners.all()],
                "activity_count": len(t.activities.all()),
            }
            for t in tasks
        ]
        return {"rows": rows, "sets": sets}

    @extend_schema(
        parameters=[OpenApiParameter("work_group", int), OpenApiParameter("all", bool)], responses={200: dict}
    )
    @extend_schema(responses={200: dict})
    @action(detail=False, methods=["get"])
    def timeline(self, request):
        """
        The register as a Gantt timeline: the tasks of the register list (same filters), with their dates,
        stage and activities. Teams get their own groups' tasks; the TMO, administrators and viewers all.
        """
        qs = self.filter_queryset(task_queryset())
        if not roles.sees_all(request.user):
            qs = qs.filter(work_group_id__in=roles.view_group_ids(request.user))
        return Response(plan_rows(qs, request.user))

    @action(detail=True, methods=["get"])
    def workflow(self, request, pk=None):
        """The task's way through the readiness flow: each step, who took it and when (the status timeline)."""
        return Response(task_workflow(self.get_object()))

    @extend_schema(request=DecisionSerializer, responses={200: TaskSerializer})
    @action(detail=True, methods=["post"])
    def approval(self, request, pk=None):
        """
        The work group leader decides on a task that is Ready to include: approve (→ Leader Approved, for the
        TMO), or reject / ask to clarify (→ Needs completion, back to the Focal Point, with the reason).
        """
        task = self.get_object()
        if task.status != Task.Status.READY:
            raise ValidationError({"decision": "The leader decides on tasks that are Ready to include."})
        if not roles.can_approve_task(request.user, task):
            raise PermissionDenied("Only the work group's leader decides on its tasks.")
        s = DecisionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        before = {
            "Decision": task.get_approval_display(),
            "Note": task.approval_note or None,
            "Readiness status": task.get_status_display(),
        }
        task.approval = s.validated_data["decision"]
        task.approval_note = s.validated_data["note"]
        task.approval_by = request.user
        task.approval_at = timezone.now()
        approved = task.approval == Decision.APPROVED
        task.status = Task.Status.LEADER_APPROVED if approved else Task.Status.NEEDS_COMPLETION
        task.updated_by = request.user
        task.save(
            update_fields=[
                "approval",
                "approval_note",
                "approval_by",
                "approval_at",
                "status",
                "updated_by",
                "updated_at",
            ]
        )
        after = {
            "Decision": task.get_approval_display(),
            "Note": task.approval_note or None,
            "Readiness status": task.get_status_display(),
        }
        audit.record(
            request.user,
            "approval",
            "Task",
            task,
            f"{task.code}: {task.get_approval_display()} → {task.get_status_display()}",
            changes=audit.diff(before, after),
        )
        return Response(TaskSerializer(task, context=self.get_serializer_context()).data)

    @extend_schema(parameters=[OpenApiParameter("work_group", int)], responses={200: dict})
    @action(detail=False, methods=["get"])
    def governance(self, request):
        """
        The leader's desk: the group's Direct tasks to approve, and every link other groups recorded with
        the group (what they need from it, what they deliver to it) to review. Leaders see the groups they
        lead; the TMO, administrators and viewers see all groups (only administrators may decide for them).
        """
        user = request.user
        if not roles.can_view_governance(user):
            raise PermissionDenied("The governance desk is for work group leaders, the TMO and administrators.")
        groups = WorkGroup.objects.filter(is_active=True)
        if not roles.sees_all(user):
            groups = groups.filter(id__in=roles.decide_group_ids(user))
        if wg := request.query_params.get("work_group"):
            groups = groups.filter(id=wg)
        ids = set(groups.values_list("id", flat=True))
        # The leader decides on the group's tasks that are Ready to include, whatever their role.
        tasks = task_queryset().filter(work_group_id__in=ids, status=Task.Status.READY)
        direct = [
            {
                "id": t.id,
                "code": t.code,
                "title": t.title,
                "work_group_code": t.work_group.code,
                "direction_code": t.direction.code if t.direction else "",
                "owner_role": t.owner_role.value if t.owner_role_id else "",
                "check_summary": summary(check_task(t)),
                "status": t.status,
                "planned_start": t.planned_start,
                "planned_finish": t.planned_finish,
                "approval": t.approval,
                "approval_note": t.approval_note,
                "approval_by_name": person(t.approval_by),
                "approval_at": t.approval_at,
                "can_decide": roles.can_approve_task(user, t),
                "can_remove": roles.can_delete_task(user, t),
            }
            for t in tasks
        ]
        links = []
        partners = (
            TaskPartner.objects.filter(work_group_id__in=ids)
            .exclude(task__work_group_id__in=ids)
            .select_related("task__work_group", "task__owner_role", "work_group", "role", "needed_when", "reviewed_by")
            .order_by("task__code", "slot")
        )
        for p in partners:
            links.append(link_row("partner", p, p.task, p.work_group, p.need, user))
        cons = (
            Contribution.objects.filter(to_group_id__in=ids)
            .exclude(task__work_group_id__in=ids)
            .select_related("task__work_group", "task__owner_role", "to_group", "needed_when", "reviewed_by")
            .order_by("task__code", "slot")
        )
        for c in cons:
            links.append(link_row("contribution", c, c.task, c.to_group, c.benefit, user))
        count = lambda rows, key: sum(1 for x in rows if x[key] == Decision.PENDING)  # noqa: E731
        return Response(
            {
                "groups": [
                    {"id": g.id, "code": g.code, "name": g.name, "leader": person(g.leader)}
                    for g in groups.select_related("leader")
                ],
                "direct": direct,
                "links": links,
                "pending": {"direct": count(direct, "approval"), "links": count(links, "review")},
            }
        )

    @action(detail=False, methods=["get"], url_path="master-plan")
    def master_plan(self, request):
        """
        Tasks the leader approved (for the TMO to decide) or in the Master Plan; with ?all=1 every task at
        any lifecycle stage (for the Gantt timeline grouped by lifecycle). Administrators, the TMO and viewers.
        """
        if not roles.can_view_master_plan(request.user):
            raise PermissionDenied("The Master Plan is available to the TMO, administrators and the committee.")
        qs = task_queryset()
        if request.query_params.get("all") not in ("1", "true", "True"):
            qs = qs.filter(status__in=["leader_approved", "in_master_plan"])
        wg = request.query_params.get("work_group")
        if wg:
            qs = qs.filter(work_group_id=wg)
        return Response(plan_rows(qs, request.user))


class TaskChildViewSet(viewsets.ModelViewSet):
    """Shared rules for records that belong to a task (activities)."""

    entity = "Record"

    def perform_create(self, serializer):
        obj = serializer.save()
        self._log("create", obj, "added", audit.created(activity_snapshot(obj)))

    def perform_update(self, serializer):
        if not roles.can_edit_task(self.request.user, serializer.instance.task):
            raise PermissionDenied("You cannot change this task.")
        before = activity_snapshot(serializer.instance)
        obj = serializer.save()
        self._log("update", obj, "updated", audit.diff(before, activity_snapshot(obj)))

    def perform_destroy(self, instance):
        if not roles.can_edit_task(self.request.user, instance.task):
            raise PermissionDenied("You cannot change this task.")
        task, code = instance.task, getattr(instance, "code", "")
        before = activity_snapshot(instance)
        instance.delete()
        audit.record(
            self.request.user,
            "delete",
            "Task",
            task,
            f"{task.code}: {self.entity.lower()} {code} removed".replace("  ", " "),
            changes=audit.deleted(before),
        )

    def _log(self, action, obj, verb, changes=None):
        code = getattr(obj, "code", "")
        audit.record(
            self.request.user,
            action,
            "Task",
            obj.task,
            f"{obj.task.code}: {self.entity.lower()} {code} {verb}".replace("  ", " "),
            changes=changes,
        )


class ActivityViewSet(TaskChildViewSet):
    serializer_class = ActivitySerializer
    filterset_fields = ["task", "task__work_group"]
    entity = "Activity"
    pagination_class = None

    def get_queryset(self):
        return visibility.activities(
            self.request.user,
            Activity.objects.select_related("task__work_group", "owner__work_group").prefetch_related(
                "predecessors__task"
            ),
        )


class PartnerViewSet(ReviewMixin, viewsets.ReadOnlyModelViewSet):
    """Partner rows: what each task needs from its partner groups. Edited in the task form."""

    serializer_class = PartnerLinkSerializer
    filterset_class = PartnerFilter
    review_group_field = "work_group_id"
    entity = "Partner row"

    def get_queryset(self):
        qs = TaskPartner.objects.select_related("task__work_group", "work_group", "their_task__work_group").order_by(
            "task__code", "slot"
        )
        return visibility.partners(self.request.user, qs)


class ContributionViewSet(ReviewMixin, viewsets.ReadOnlyModelViewSet):
    """Contribution rows: what Enable and Support tasks deliver to other groups. Edited in the task form."""

    serializer_class = ContributionLinkSerializer
    filterset_class = ContributionFilter
    review_group_field = "to_group_id"
    entity = "Contribution"

    def get_queryset(self):
        qs = Contribution.objects.select_related(
            "task__work_group", "task__owner_role", "to_group", "their_task__work_group"
        ).order_by("task__code", "slot")
        return visibility.contributions(self.request.user, qs)


__all__ = ["TaskViewSet", "ActivityViewSet", "PartnerViewSet", "ContributionViewSet"]


class NotificationViewSet(viewsets.ViewSet):
    """
    The action centre: what the signed-in person has to do now (see notifications.py). `POST seen/` records
    that the list was opened, so only items that arrive later are marked new.
    """

    def list(self, request):
        return Response(notifications_for(request.user))

    @action(detail=False, methods=["post"])
    def seen(self, request):
        mark_seen(request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)
