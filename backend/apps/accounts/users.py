"""
User access (administrators): GET/POST /api/auth/users/, PATCH /api/auth/users/{id}/,
POST …/{id}/reset-password/, POST …/{id}/unlock/, GET /api/auth/users/roles/.

Instead of the Django admin site: accounts, their contact details, whether they can sign in, and their
roles, both the programme roles (Admin, TMO Officer, Global Viewer) and one role per work group (Leader,
Focal Point, Member). A work group role goes through the group's member list, as in Reference data ›
Group members, so the member list, the roles and the group's leader always agree
(apps/masterdata/membership.py).

Guard rails: an administrator cannot take away their own Admin role or deactivate themselves, and the
last active administrator stays one.
"""

from __future__ import annotations

import secrets
import string

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import ProtectedError, Q
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.core import audit
from apps.masterdata.models import GroupMember, WorkGroup

from . import lockout, policy
from .roles import ADMIN, FIXED_ROLES, GROUP_SUFFIXES, is_admin, roles_of

User = get_user_model()
TYPES = {"leader": "Leader", "coordinator": "Focal Point", "member": "Member"}


def _name(u) -> str:
    return u.get_full_name() or u.get_username()


def temp_password() -> str:
    """A random password that meets the rules (length, mixed characters)."""
    n = max(14, policy.min_password_length() + 2)
    alphabet = string.ascii_letters + string.digits
    while True:
        pw = (
            "".join(secrets.choice(alphabet) for _ in range(n - 2))
            + secrets.choice("!#%+=?@")
            + secrets.choice(string.digits)
        )
        if any(c.islower() for c in pw) and any(c.isupper() for c in pw):
            return pw


def group_roles_of(user) -> list[dict]:
    rows = GroupMember.objects.filter(user=user).select_related("work_group").order_by("work_group__code")
    return [
        {"work_group": m.work_group_id, "code": m.work_group.code, "type": m.member_type, "member_id": m.id}
        for m in rows
    ]


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()
    fixed_roles = serializers.SerializerMethodField()
    group_roles = serializers.SerializerMethodField()
    password_changed_at = serializers.SerializerMethodField()
    must_change_password = serializers.SerializerMethodField()
    locked = serializers.SerializerMethodField()
    sso_only = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name", "full_name", "email", "is_active", "last_login",
                  "date_joined", "fixed_roles", "group_roles", "password_changed_at", "must_change_password",
                  "locked", "sso_only"]  # fmt: skip

    def get_full_name(self, obj) -> str:
        return obj.get_full_name()

    def get_fixed_roles(self, obj) -> list[str]:
        return [r for r in FIXED_ROLES if r in roles_of(obj)]

    def get_group_roles(self, obj) -> list[dict]:
        return group_roles_of(obj)

    def _sec(self, obj):
        sec = getattr(obj, "security", None)
        return sec

    def get_password_changed_at(self, obj):
        sec = self._sec(obj)
        return sec.password_changed_at if sec else None

    def get_must_change_password(self, obj) -> bool:
        sec = self._sec(obj)
        return bool(sec and sec.must_change_password)

    def get_locked(self, obj) -> bool:
        return lockout.locked_anywhere(obj.get_username())

    def get_sso_only(self, obj) -> bool:
        return not obj.has_usable_password()


class UserWriteSerializer(serializers.Serializer):
    username = serializers.RegexField(r"^[\w.@+-]+$", max_length=150, required=False)
    first_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
    email = serializers.EmailField(max_length=254, required=False, allow_blank=True)
    is_active = serializers.BooleanField(required=False)
    fixed_roles = serializers.ListField(child=serializers.ChoiceField(choices=FIXED_ROLES), required=False)
    # [{"work_group": id, "type": "leader" | "coordinator" | "member" | null}, ...]: only the groups listed change.
    group_roles = serializers.ListField(child=serializers.DictField(), required=False)
    password = serializers.CharField(max_length=128, required=False, allow_blank=True, trim_whitespace=False)

    def validate_username(self, value):
        qs = User.objects.filter(username__iexact=value)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("This user name is already used.")
        return value

    def validate_email(self, value):
        value = value.strip().lower()
        qs = User.objects.filter(email__iexact=value) if value else User.objects.none()
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("Another account already has this email address.")
        return value

    def validate_group_roles(self, value):
        out = []
        ids = set(WorkGroup.objects.values_list("id", flat=True))
        for item in value:
            wg, kind = item.get("work_group"), item.get("type")
            if wg not in ids:
                raise serializers.ValidationError("Unknown work group.")
            if kind not in (None, "", *TYPES):
                raise serializers.ValidationError("A group role is leader, coordinator, member or none.")
            out.append({"work_group": wg, "type": kind or None})
        return out


def set_group_type(user, wg: WorkGroup, kind: str | None) -> None:
    """Give the user one role in the group (through its member row), or none."""
    row = GroupMember.objects.filter(work_group=wg, user=user).first()
    if kind:
        if row is None:
            name = _name(user)
            taken = GroupMember.objects.filter(work_group=wg, name=name).first()
            if taken and taken.user_id is None:
                row = taken  # the person was already listed without an account: link them
            elif taken:
                name = f"{name} ({user.get_username()})"
        if row is None:
            GroupMember.objects.create(work_group=wg, user=user, name=name, email=user.email, member_type=kind)
        else:
            row.user, row.member_type = user, kind
            if user.email and not row.email:
                row.email = user.email
            row.save()
        return
    if row is not None:
        try:
            row.delete()
        except ProtectedError:  # owns activities: keep the person in the list, without the account
            row.user = None
            row.save()
    else:
        from apps.masterdata.membership import set_group_role

        set_group_role(user, wg, None)


class UserViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = UserSerializer

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not is_admin(request.user):
            raise PermissionDenied("Only administrators manage user access.")

    def get_queryset(self):
        qs = User.objects.select_related("security").prefetch_related("groups").order_by("username")
        q = (self.request.query_params.get("q") or "").strip()
        if q:
            qs = qs.filter(
                Q(username__icontains=q)
                | Q(first_name__icontains=q)
                | Q(last_name__icontains=q)
                | Q(email__icontains=q)
            )
        return qs

    def list(self, request, *args, **kwargs):
        # Everyone at once (a few hundred accounts at most); the page searches and filters as you type.
        return Response(UserSerializer(self.get_queryset(), many=True).data)

    def _apply(self, user, data, creating=False):
        me = self.request.user
        changes = {}
        for f in ("username", "first_name", "last_name", "email"):
            if f in data and data[f] != getattr(user, f):
                changes[f.replace("_", " ").capitalize()] = [getattr(user, f) or None, data[f] or None]
                setattr(user, f, data[f])
        if "is_active" in data and data["is_active"] != user.is_active:
            if not data["is_active"] and user == me:
                raise serializers.ValidationError({"is_active": "You cannot deactivate your own account."})
            changes["Can sign in"] = ["Yes" if user.is_active else "No", "Yes" if data["is_active"] else "No"]
            user.is_active = data["is_active"]
        user.save()
        # A new email also goes to the person's member rows, so the lists show the same address.
        if "email" in data and data["email"]:
            GroupMember.objects.filter(user=user).exclude(email=data["email"]).update(email=data["email"])
        if "fixed_roles" in data:
            want = set(data["fixed_roles"])
            have = {r for r in FIXED_ROLES if user.groups.filter(name=r).exists()}
            if user == me and ADMIN in have and ADMIN not in want:
                raise serializers.ValidationError({"fixed_roles": "You cannot take away your own Admin role."})
            for r in want - have:
                user.groups.add(Group.objects.get_or_create(name=r)[0])
            for r in have - want:
                user.groups.remove(Group.objects.get(name=r))
            if want != have:
                changes["Programme roles"] = [", ".join(sorted(have)) or None, ", ".join(sorted(want)) or None]
        if "group_roles" in data:
            groups = {g.id: g for g in WorkGroup.objects.filter(id__in=[i["work_group"] for i in data["group_roles"]])}
            current = {r["work_group"]: r["type"] for r in group_roles_of(user)}
            for item in data["group_roles"]:
                wg = groups[item["work_group"]]
                if current.get(wg.id) != item["type"]:
                    set_group_type(user, wg, item["type"])
                    changes[f"{wg.code} role"] = [TYPES.get(current.get(wg.id)), TYPES.get(item["type"])]
        for attr in ("_role_cache", "_lead_cache", "_team_cache", "_member_cache", "_delegate_cache"):
            user.__dict__.pop(attr, None)
        if not User.objects.filter(is_active=True).filter(Q(is_superuser=True) | Q(groups__name=ADMIN)).exists():
            raise serializers.ValidationError({"fixed_roles": "At least one active administrator must remain."})
        return changes

    @extend_schema(request=UserWriteSerializer, responses={201: UserSerializer})
    def create(self, request):
        s = UserWriteSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        data = s.validated_data
        if not data.get("username"):
            raise serializers.ValidationError({"username": "Enter a user name."})
        password = data.pop("password", "") or temp_password()
        user = User(username=data["username"])
        try:
            validate_password(password, user)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)}) from exc
        with transaction.atomic():
            user.set_password(password)
            changes = self._apply(user, {**data, "is_active": data.get("is_active", True)}, creating=True)
            policy.password_set(user, must_change=True)
            audit.record(request.user, "create", "User", user, f"User {user.username} created", label=user.username,
                         changes=changes)  # fmt: skip
        return Response({**UserSerializer(user).data, "temporary_password": password}, status=status.HTTP_201_CREATED)

    @extend_schema(request=UserWriteSerializer, responses={200: UserSerializer})
    def partial_update(self, request, pk=None):
        user = self.get_object()
        s = UserWriteSerializer(user, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        data = {k: v for k, v in s.validated_data.items() if k != "password"}
        with transaction.atomic():
            changes = self._apply(user, data)
            if changes:
                audit.record(request.user, "update", "User", user, f"User {user.username} changed",
                             label=user.username, changes=changes)  # fmt: skip
        return Response(UserSerializer(User.objects.get(pk=user.pk)).data)

    @extend_schema(request=None, responses={200: dict})
    @action(detail=True, methods=["post"], url_path="reset-password")
    def reset_password(self, request, pk=None):
        """A new temporary password, shown once; the person must change it at the next sign-in."""
        user = self.get_object()
        password = temp_password()
        user.set_password(password)
        user.save(update_fields=["password"])
        policy.password_set(user, must_change=True)
        lockout.unlock(user.get_username())
        audit.record(request.user, "update", "User", user, f"Password of {user.username} reset by an administrator",
                     label=user.username, changes={"Password": ["(hidden)", "temporary, must be changed"]})  # fmt: skip
        return Response({"temporary_password": password})

    @extend_schema(request=None, responses={200: UserSerializer})
    @action(detail=True, methods=["post"])
    def unlock(self, request, pk=None):
        user = self.get_object()
        lockout.unlock(user.get_username())
        audit.record(request.user, "update", "User", user, f"{user.username} unlocked", label=user.username)
        return Response(UserSerializer(user).data)

    @extend_schema(responses={200: dict})
    @action(detail=False, methods=["get"])
    def roles(self, request):
        """What can be given: the programme roles and the work groups (each with its three roles)."""
        groups = WorkGroup.objects.filter(is_active=True).order_by("code")
        return Response(
            {
                "fixed": [
                    {"name": ADMIN, "hint": "Everything, including users, settings, backups and system issues."},
                    {
                        "name": FIXED_ROLES[1],
                        "hint": "Reads every register, decides on the Master Plan, keeps the reference data.",
                    },
                    {
                        "name": FIXED_ROLES[2],
                        "hint": "Reads every register and the Master Plan (for example the committee).",
                    },
                ],
                "types": [{"value": k, "label": v} for k, v in TYPES.items()],
                "groups": [{"id": g.id, "code": g.code, "name": g.name, "leader_id": g.leader_id} for g in groups],
                "suffixes": list(GROUP_SUFFIXES),
            }
        )
