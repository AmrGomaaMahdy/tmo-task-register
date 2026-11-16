from collections import defaultdict
from datetime import timedelta

from django.db.models import Prefetch
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.accounts import roles
from apps.core import audit
from apps.masterdata.models import Direction, LookupValue, WorkGroup

from . import visibility
from .filters import ContributionFilter, PartnerFilter, TaskFilter
from .models import Activity, Contribution, Task, TaskPartner
from .serializers import (
    ActivitySerializer,
    ContributionLinkSerializer,
    PartnerLinkSerializer,
    SharedTaskSerializer,
    TaskDirectorySerializer,
    TaskListSerializer,
    TaskSerializer,
    TransitionSerializer,
    contribution_data,
    partner_data,
)
from .services.checks import (
    activity_issues,
    check_task,
    contribution_issues,
    is_ok,
    links_out,
    partner_issues,
    summary,
)
from .services.workdays import working_days


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


class TaskViewSet(viewsets.ModelViewSet):
    """
    Tasks. Administrators, the TMO and viewers read every register; a team reads its own register in full
    and sees other groups' tasks only where they are linked to its own (short form, see retrieve).
    """

    filterset_class = TaskFilter
    search_fields = ["code", "title"]
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
        audit.record(self.request.user, "create", "Task", task, f"{task.code} added as {task.get_status_display()}")

    def perform_update(self, serializer):
        if not roles.can_edit_task(self.request.user, serializer.instance):
            raise PermissionDenied("You cannot change this task.")
        task = serializer.save(updated_by=self.request.user)
        audit.record(self.request.user, "update", "Task", task, f"{task.code} edited")

    def perform_destroy(self, instance):
        if not roles.can_delete_task(self.request.user, instance):
            raise PermissionDenied("Only the group lead can delete a task, and not once it is in the Master Plan.")
        code = instance.code
        instance.delete()
        audit.record(self.request.user, "delete", "Task", None, f"{code} deleted", label=code)

    @extend_schema(request=TransitionSerializer, responses={200: TaskSerializer})
    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None):
        """Move a task through the lifecycle: draft → needs completion → ready → in Master Plan."""
        task = self.get_object()
        s = TransitionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        target = s.validated_data["status"]
        if target not in roles.allowed_transitions(request.user, task):
            raise PermissionDenied("You cannot move this task to that status.")
        if target == Task.Status.IN_MASTER_PLAN:
            task.status = Task.Status.READY  # check it as a Ready task
            if not is_ok(check_task(task)):
                raise ValidationError(
                    {"status": "The task's check is not OK. Fix it before including it in the Master Plan."}
                )
        before = task.get_status_display()
        task.status = target
        task.updated_by = request.user
        task.save(update_fields=["status", "updated_by", "updated_at"])
        audit.record(request.user, "transition", "Task", task, f"{task.code}: {before} → {task.get_status_display()}")
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
        s = TaskSerializer(instance=instance, data=data, partial=True, context=self.get_serializer_context())
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
        ready = [t for t in tasks if t.status in ("ready", "in_master_plan")]
        dirs = (
            Direction.objects.all()
            if roles.sees_all(request.user)
            else Direction.objects.filter(work_group__in=roles.work_group_ids(request.user))
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
                "coming_up": soon[:10],
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
    @action(detail=False, methods=["get"], url_path="master-plan")
    def master_plan(self, request):
        """
        Tasks that are Ready or in the Master Plan; with ?all=1 every task at any lifecycle stage (for the
        Gantt timeline grouped by lifecycle). Administrators, the TMO and viewers only.
        """
        if not roles.can_view_master_plan(request.user):
            raise PermissionDenied("The Master Plan is available to the TMO, administrators and the committee.")
        qs = task_queryset()
        if request.query_params.get("all") not in ("1", "true", "True"):
            qs = qs.filter(status__in=["ready", "in_master_plan"])
        wg = request.query_params.get("work_group")
        if wg:
            qs = qs.filter(work_group_id=wg)
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
                    "can_include": "in_master_plan" in roles.allowed_transitions(request.user, t),
                    "can_release": t.status == "in_master_plan"
                    and "ready" in roles.allowed_transitions(request.user, t),
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
                    "waits_for": [
                        p.their_task_ref or f"{p.work_group.code} (task no. missing)" for p in t.partners.all()
                    ],
                }
            )
        return Response(rows)


class TaskChildViewSet(viewsets.ModelViewSet):
    """Shared rules for records that belong to a task (activities)."""

    entity = "Record"

    def perform_create(self, serializer):
        obj = serializer.save()
        self._log("create", obj, "added")

    def perform_update(self, serializer):
        if not roles.can_edit_task(self.request.user, serializer.instance.task):
            raise PermissionDenied("You cannot change this task.")
        obj = serializer.save()
        self._log("update", obj, "updated")

    def perform_destroy(self, instance):
        if not roles.can_edit_task(self.request.user, instance.task):
            raise PermissionDenied("You cannot change this task.")
        task = instance.task
        instance.delete()
        audit.record(self.request.user, "delete", "Task", task, f"{task.code}: {self.entity.lower()} removed")

    def _log(self, action, obj, verb):
        audit.record(self.request.user, action, "Task", obj.task, f"{obj.task.code}: {self.entity.lower()} {verb}")


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


class PartnerViewSet(viewsets.ReadOnlyModelViewSet):
    """Partner rows: what each task needs from its partner groups. Edited in the task form."""

    serializer_class = PartnerLinkSerializer
    filterset_class = PartnerFilter

    def get_queryset(self):
        qs = TaskPartner.objects.select_related("task__work_group", "work_group", "their_task__work_group").order_by(
            "task__code", "slot"
        )
        return visibility.partners(self.request.user, qs)


class ContributionViewSet(viewsets.ReadOnlyModelViewSet):
    """Contribution rows: what Enable and Support tasks deliver to other groups. Edited in the task form."""

    serializer_class = ContributionLinkSerializer
    filterset_class = ContributionFilter

    def get_queryset(self):
        qs = Contribution.objects.select_related(
            "task__work_group", "task__owner_role", "to_group", "their_task__work_group"
        ).order_by("task__code", "slot")
        return visibility.contributions(self.request.user, qs)


__all__ = ["TaskViewSet", "ActivityViewSet", "PartnerViewSet", "ContributionViewSet"]
