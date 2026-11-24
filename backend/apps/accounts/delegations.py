"""
Delegates for absent leaders (1.24): GET/POST /api/auth/delegations/, POST …/{id}/cancel/,
GET …/candidates/?work_group=<id>.

A leader names, for their own group, one person of the group (any of its three roles) to decide in their
place between two dates. While it runs, the delegate sees the group's register, gets its approvals in the
action centre and on the Governance desk, and approves or rejects like the leader (roles.decide_group_ids).
One delegation at a time per group; the leader or an administrator can cancel it. The delegate is told
by email when email is set up.
"""

from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.core import audit
from apps.masterdata.models import WorkGroup

from . import mail
from .models import LeaderDelegation
from .roles import group_role_names, is_admin, led_group_ids

MAX_DAYS = 90
User = get_user_model()


def _name(u) -> str:
    return (u.get_full_name() or u.get_username()) if u else ""


def group_people(wg: WorkGroup):
    """Active users holding one of the group's roles (leader, Focal Point, member)."""
    return User.objects.filter(is_active=True, groups__name__in=group_role_names(wg.code)).distinct()


class DelegationSerializer(serializers.ModelSerializer):
    work_group_code = serializers.CharField(source="work_group.code", read_only=True)
    work_group_name = serializers.CharField(source="work_group.name", read_only=True)
    leader_name = serializers.SerializerMethodField()
    delegate_name = serializers.SerializerMethodField()
    created_by_name = serializers.SerializerMethodField()
    state = serializers.CharField(read_only=True)
    can_cancel = serializers.SerializerMethodField()

    class Meta:
        model = LeaderDelegation
        fields = [
            "id", "work_group", "work_group_code", "work_group_name", "leader", "leader_name", "delegate",
            "delegate_name", "starts_on", "ends_on", "note", "state", "created_at", "created_by_name",
            "cancelled_at", "can_cancel",
        ]  # fmt: skip
        read_only_fields = ["leader", "created_at", "cancelled_at"]

    def get_leader_name(self, obj) -> str:
        return _name(obj.leader)

    def get_delegate_name(self, obj) -> str:
        return _name(obj.delegate)

    def get_created_by_name(self, obj) -> str:
        return _name(obj.created_by)

    def get_can_cancel(self, obj) -> bool:
        user = self.context["request"].user
        return obj.state in ("active", "upcoming") and (is_admin(user) or obj.work_group_id in led_group_ids(user))

    def validate(self, attrs):
        user = self.context["request"].user
        wg: WorkGroup = attrs["work_group"]
        if not (is_admin(user) or wg.id in led_group_ids(user)):
            raise PermissionDenied("Only the group's leader (or an administrator) names its delegate.")
        leader = wg.leader if is_admin(user) and wg.id not in led_group_ids(user) else user
        if leader is None:
            raise serializers.ValidationError({"work_group": "This work group has no leader to stand in for."})
        delegate = attrs["delegate"]
        if delegate == leader:
            raise serializers.ValidationError({"delegate": "Choose someone other than the leader."})
        if not group_people(wg).filter(pk=delegate.pk).exists():
            raise serializers.ValidationError({"delegate": "The delegate must be an active member of the work group."})
        today = timezone.localdate()
        start, end = attrs["starts_on"], attrs["ends_on"]
        if start < today:
            raise serializers.ValidationError({"starts_on": "The first day cannot be in the past."})
        if end < start:
            raise serializers.ValidationError({"ends_on": "The last day must be on or after the first day."})
        if (end - start).days + 1 > MAX_DAYS:
            raise serializers.ValidationError({"ends_on": f"A delegation lasts at most {MAX_DAYS} days."})
        clash = LeaderDelegation.objects.filter(
            work_group=wg, cancelled_at__isnull=True, starts_on__lte=end, ends_on__gte=start
        ).first()
        if clash:
            raise serializers.ValidationError(
                {"starts_on": f"{_name(clash.delegate)} is already the delegate from {clash.starts_on:%d %b %Y} "
                 f"to {clash.ends_on:%d %b %Y}. Cancel that first."}
            )  # fmt: skip
        attrs["leader"] = leader
        attrs["note"] = " ".join(attrs.get("note", "").split())
        return attrs


def _notify(d: LeaderDelegation, cancelled: bool = False) -> None:
    period = f"{d.starts_on:%d %b %Y} – {d.ends_on:%d %b %Y}"
    link = mail.app_link("/governance")
    if cancelled:
        mail.send(
            d.delegate.email,
            f"Delegation for {d.work_group.code} cancelled",
            [f"{_name(d.leader)} cancelled your delegation for the {d.work_group.code} work group ({period})."],
            [f"ألغى {_name(d.leader)} تفويضك لمجموعة العمل {d.work_group.code} ({period})."],
        )
        return
    mail.send(
        d.delegate.email,
        f"You stand in for the {d.work_group.code} leader",
        [
            f"{_name(d.leader)} named you as delegate for the {d.work_group.code} work group, {period}.",
            "During this time you approve or reject the group's tasks and links in the leader's place: "
            "look for the bell in the Task Register, or open the Leader approvals page." + (f" {link}" if link else ""),
        ]
        + ([f"Note: {d.note}"] if d.note else []),
        [
            f"عيّنك {_name(d.leader)} مفوَّضًا عن قائد مجموعة العمل {d.work_group.code} خلال الفترة {period}.",
            "خلال هذه الفترة تعتمد أو ترفض مهام المجموعة وروابطها نيابةً عن القائد: تابع الجرس في سجل المهام "
            "أو افتح صفحة اعتمادات القائد." + (f" {link}" if link else ""),
        ]
        + ([f"ملاحظة: {d.note}"] if d.note else []),
    )


class DelegationViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    serializer_class = DelegationSerializer

    def get_queryset(self):
        user = self.request.user
        qs = LeaderDelegation.objects.select_related("work_group", "leader", "delegate", "created_by")
        if not is_admin(user):
            qs = qs.filter(Q(work_group_id__in=led_group_ids(user)) | Q(delegate=user))
        if wg := self.request.query_params.get("work_group"):
            qs = qs.filter(work_group_id=wg) if str(wg).isdigit() else qs.none()
        # Running and upcoming first, then the most recent of the rest.
        recent = timezone.localdate() - timedelta(days=60)
        return qs.filter(Q(cancelled_at__isnull=True, ends_on__gte=recent) | Q(created_at__date__gte=recent))

    def perform_create(self, serializer):
        d = serializer.save(created_by=self.request.user)
        audit.record(
            self.request.user, "create", "Delegation", d,
            f"{_name(d.delegate)} stands in for the {d.work_group.code} leader, {d.starts_on} to {d.ends_on}",
            label=d.work_group.code, work_group=d.work_group.code,
            changes={
                "Delegate": [None, _name(d.delegate)],
                "From": [None, str(d.starts_on)],
                "To": [None, str(d.ends_on)],
            },
        )  # fmt: skip
        _notify(d)

    @extend_schema(request=None, responses={200: DelegationSerializer})
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        d = self.get_object()
        if not (is_admin(request.user) or d.work_group_id in led_group_ids(request.user)):
            raise PermissionDenied("Only the group's leader (or an administrator) cancels its delegation.")
        if d.state not in ("active", "upcoming"):
            return Response({"detail": "This delegation has already ended."}, status=status.HTTP_400_BAD_REQUEST)
        d.cancelled_at, d.cancelled_by = timezone.now(), request.user
        d.save(update_fields=["cancelled_at", "cancelled_by"])
        audit.record(
            request.user, "update", "Delegation", d,
            f"Delegation of {_name(d.delegate)} for {d.work_group.code} cancelled",
            label=d.work_group.code, work_group=d.work_group.code, changes={"Status": ["Active", "Cancelled"]},
        )  # fmt: skip
        _notify(d, cancelled=True)
        return Response(self.get_serializer(d).data)

    @extend_schema(responses={200: dict})
    @action(detail=False, methods=["get"])
    def candidates(self, request):
        """People of the group who can be named (everyone with one of its roles, except its leader)."""
        wg = WorkGroup.objects.filter(pk=request.query_params.get("work_group") or 0).first()
        if wg is None or not (is_admin(request.user) or wg.id in led_group_ids(request.user)):
            raise PermissionDenied("Only the group's leader (or an administrator) names its delegate.")
        people = group_people(wg).exclude(pk=wg.leader_id).order_by("first_name", "last_name", "username")
        return Response([{"id": u.id, "name": _name(u), "has_email": bool(u.email)} for u in people])
