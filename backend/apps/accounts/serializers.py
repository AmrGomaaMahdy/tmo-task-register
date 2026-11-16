from django.contrib.auth import get_user_model
from rest_framework import serializers

from apps.masterdata.models import WorkGroup

from .roles import can_manage_master_data, can_view_master_plan, is_admin, is_tmo, roles_of, sees_all, work_group_ids

User = get_user_model()


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(max_length=128, write_only=True, style={"input_type": "password"})


class MeSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()
    roles = serializers.SerializerMethodField()
    work_groups = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "full_name", "email", "roles", "work_groups", "permissions"]

    def get_full_name(self, obj) -> str:
        return obj.get_full_name() or obj.get_username()

    def get_roles(self, obj) -> list[str]:
        return sorted(roles_of(obj))

    def get_work_groups(self, obj) -> list[dict]:
        """Work groups whose register the user maintains, from their team roles."""
        groups = WorkGroup.objects.filter(id__in=work_group_ids(obj)).order_by("code")
        return [{"id": wg.id, "code": wg.code, "name": wg.name} for wg in groups]

    def get_permissions(self, obj) -> dict:
        return {
            "manage_master_data": can_manage_master_data(obj),
            "admin": is_admin(obj),
            "tmo": is_tmo(obj),
            "create_tasks": is_admin(obj) or bool(work_group_ids(obj)),
            "view_all": sees_all(obj),
            "master_plan": can_view_master_plan(obj),
        }
