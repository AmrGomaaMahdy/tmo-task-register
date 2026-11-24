from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework import serializers

from apps.masterdata.models import WorkGroup

from .roles import (
    can_manage_master_data,
    can_view_audit,
    can_view_governance,
    can_view_master_plan,
    decide_group_ids,
    delegated_group_ids,
    is_admin,
    is_tmo,
    led_group_ids,
    member_group_ids,
    roles_of,
    sees_all,
    work_group_ids,
)

User = get_user_model()


class LoginSerializer(serializers.Serializer):
    # Length limits stop oversized input before it reaches the (deliberately slow) Argon2 password hash.
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(
        max_length=128, write_only=True, trim_whitespace=False, style={"input_type": "password"}
    )


class MeSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()
    roles = serializers.SerializerMethodField()
    work_groups = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()
    password = serializers.SerializerMethodField()
    view_groups = serializers.SerializerMethodField()
    date_range = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "full_name",
            "email",
            "roles",
            "work_groups",
            "view_groups",
            "permissions",
            "password",
            "date_range",
        ]

    def get_full_name(self, obj) -> str:
        return obj.get_full_name() or obj.get_username()

    def get_roles(self, obj) -> list[str]:
        return sorted(roles_of(obj))

    def get_work_groups(self, obj) -> list[dict]:
        """Work groups whose register the user maintains, from their team roles."""
        groups = WorkGroup.objects.filter(id__in=work_group_ids(obj)).order_by("code")
        led = led_group_ids(obj)
        return [{"id": wg.id, "code": wg.code, "name": wg.name, "leader": wg.id in led} for wg in groups]

    def get_view_groups(self, obj) -> list[dict]:
        """Every work group whose register the user reads in full, with the user's role in it."""
        led, edit, member = led_group_ids(obj), work_group_ids(obj), member_group_ids(obj)
        delegated = delegated_group_ids(obj)
        groups = WorkGroup.objects.filter(id__in=edit | member | delegated).order_by("code")

        def role(wg):
            if wg.id in led:
                return "leader"
            if wg.id in edit:
                return "coordinator"
            return "delegate" if wg.id in delegated else "member"

        return [{"id": wg.id, "code": wg.code, "name": wg.name, "role": role(wg)} for wg in groups]

    def get_password(self, obj) -> dict:
        """Must the password be changed now (expired, or set by an administrator)? And the length rule."""
        from . import policy

        return {**policy.password_status(obj), "min_length": policy.min_password_length()}

    def get_date_range(self, obj) -> dict:
        """The first and last date the register accepts, so the forms can say so before saving."""
        return {"min": settings.REGISTER_DATE_MIN, "max": settings.REGISTER_DATE_MAX}

    def get_permissions(self, obj) -> dict:
        return {
            "manage_master_data": can_manage_master_data(obj),
            "admin": is_admin(obj),
            "tmo": is_tmo(obj),
            "create_tasks": is_admin(obj) or bool(work_group_ids(obj)),
            "view_all": sees_all(obj),
            "master_plan": can_view_master_plan(obj),
            "governance": can_view_governance(obj),
            # The audit trail page (everything that happened) and the System issues page (errors).
            "audit": can_view_audit(obj),
            "system": is_admin(obj),
            "leader": bool(decide_group_ids(obj)),
            # Leads a group themselves (may name a delegate), as opposed to standing in for a leader.
            "lead_own": bool(led_group_ids(obj)),
        }


class PasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)
    new_password = serializers.CharField(max_length=128, write_only=True, trim_whitespace=False)
