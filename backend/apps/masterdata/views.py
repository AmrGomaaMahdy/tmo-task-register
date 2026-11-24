from django.contrib.auth import get_user_model
from django.db.models import Count
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.accounts import roles
from apps.core import audit
from apps.register.models import Activity, Contribution, Task, TaskPartner

from .models import Direction, GroupMember, LookupValue, WorkGroup
from .permissions import MasterDataPermission, MemberPermission
from .serializers import DirectionSerializer, GroupMemberSerializer, LookupValueSerializer, WorkGroupSerializer

# Which task fields point to each list, used to count how often a value is used.
LOOKUP_USAGE = {
    "workstream": [("task", "workstream")],
    "sub_objective": [("task", "sub_objective")],
    "owner_role": [("task", "owner_role")],
    "partner_role": [("partner", "role")],
    "needed": [("partner", "needed_when"), ("contribution", "needed_when")],
}
MODELS = {"task": Task, "activity": Activity, "partner": TaskPartner, "contribution": Contribution}


class AuditedModelViewSet(viewsets.ModelViewSet):
    """Configuration changes go to the audit trail with their field values before and after."""

    entity = "masterdata"

    def perform_create(self, serializer):
        obj = serializer.save()
        audit.record(
            self.request.user,
            "create",
            self.entity,
            obj,
            f"{self.entity}: added {obj}",
            label=str(obj)[:60],
            changes=audit.created(audit.snapshot(obj)),
        )

    def perform_update(self, serializer):
        before = audit.snapshot(serializer.instance)
        obj = serializer.save()
        audit.record(
            self.request.user,
            "update",
            self.entity,
            obj,
            f"{self.entity}: updated {obj}",
            label=str(obj)[:60],
            changes=audit.diff(before, audit.snapshot(obj)),
        )

    def perform_destroy(self, instance):
        label = str(instance)
        before = audit.snapshot(instance)
        instance.delete()
        audit.record(
            self.request.user,
            "delete",
            self.entity,
            None,
            f"{self.entity}: deleted {label}",
            label=label[:60],
            changes=audit.deleted(before),
        )


class WorkGroupViewSet(AuditedModelViewSet):
    serializer_class = WorkGroupSerializer
    permission_classes = [MasterDataPermission]
    pagination_class = None
    search_fields = ["code", "name"]
    entity = "Work group"

    def get_queryset(self):
        return (
            WorkGroup.objects.select_related("leader")
            .annotate(task_count=Count("tasks", distinct=True))
            .order_by("code")
        )

    @action(detail=False, methods=["get"], url_path="leader-candidates")
    def leader_candidates(self, request):
        """Active users who can be named a work group leader, with the teams they belong to."""
        if not roles.can_manage_master_data(request.user):
            raise PermissionDenied("Only administrators and the TMO choose work group leaders.")
        users = get_user_model().objects.filter(is_active=True).prefetch_related("groups").order_by("username")
        out = []
        for u in users:
            teams = sorted(
                {g.name.rsplit(" Team ", 1)[0] for g in u.groups.all() if g.name.endswith(roles.GROUP_SUFFIXES)}
            )
            out.append({"id": u.id, "username": u.username, "name": u.get_full_name() or u.username, "teams": teams})
        return Response(out)


class DirectionViewSet(AuditedModelViewSet):
    serializer_class = DirectionSerializer
    permission_classes = [MasterDataPermission]
    pagination_class = None
    filterset_fields = ["work_group"]
    search_fields = ["code", "title", "meaning"]
    entity = "Direction"

    def get_queryset(self):
        return (
            Direction.objects.select_related("work_group")
            .annotate(task_count=Count("tasks", distinct=True))
            .order_by("work_group__code", "code")
        )


class GroupMemberViewSet(AuditedModelViewSet):
    """People of each work group. Activity owners are picked from the members of the task's group."""

    serializer_class = GroupMemberSerializer
    permission_classes = [MemberPermission]
    pagination_class = None
    filterset_fields = ["work_group"]
    search_fields = ["name", "email", "job_title"]
    entity = "Group member"

    def get_queryset(self):
        # Meta.ordering is not applied to queries with an aggregate, so the order is explicit.
        qs = (
            GroupMember.objects.select_related("work_group", "user")
            .annotate(activity_count=Count("activities"))
            .order_by("work_group__code", "name")
        )
        user = self.request.user
        # Teams see the members of their own groups only: those are the people they can assign.
        return qs if roles.sees_all(user) else qs.filter(work_group__in=roles.view_group_ids(user))


class LookupValueViewSet(AuditedModelViewSet):
    serializer_class = LookupValueSerializer
    permission_classes = [MasterDataPermission]
    pagination_class = None
    filterset_fields = ["list_key", "work_group"]
    search_fields = ["value", "definition"]
    entity = "List value"

    def get_queryset(self):
        return LookupValue.objects.select_related("work_group")

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        usage = self._usage_counts()
        for row in response.data:
            row["usage"] = usage.get(row["id"], 0)
        return response

    @staticmethod
    def _usage_counts() -> dict[int, int]:
        counts: dict[int, int] = {}
        for refs in LOOKUP_USAGE.values():
            for model_key, field in refs:
                rows = (
                    MODELS[model_key]
                    .objects.exclude(**{f"{field}__isnull": True})
                    .values(field)
                    .annotate(n=Count("id"))
                )
                for r in rows:
                    counts[r[field]] = counts.get(r[field], 0) + r["n"]
        return counts

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.is_core:
            return Response(
                {"detail": "The automatic check relies on this value. Rename it instead of deleting it."},
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)


__all__ = ["WorkGroupViewSet", "DirectionViewSet", "GroupMemberViewSet", "LookupValueViewSet"]
