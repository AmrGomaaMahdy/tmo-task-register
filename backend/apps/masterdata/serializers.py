from rest_framework import serializers

from apps.accounts import roles

from .models import Direction, GroupMember, LookupValue, WorkGroup


class HideOtherGroupsCountMixin:
    """Teams see task counts only for their own work groups (other registers are not theirs to see)."""

    def _group_id(self, obj) -> int:
        return obj.id if isinstance(obj, WorkGroup) else obj.work_group_id

    def to_representation(self, obj):
        data = super().to_representation(obj)
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user and not roles.sees_all(user) and self._group_id(obj) not in roles.work_group_ids(user):
            data["task_count"] = None
        return data


class WorkGroupSerializer(HideOtherGroupsCountMixin, serializers.ModelSerializer):
    task_count = serializers.IntegerField(read_only=True, allow_null=True)

    class Meta:
        model = WorkGroup
        fields = ["id", "code", "name", "is_active", "task_count"]

    def validate_code(self, value: str) -> str:
        value = value.strip().upper()
        if self.instance and self.instance.code != value and self.instance.tasks.exists():
            raise serializers.ValidationError("The code starts existing task IDs and cannot change.")
        return value


class DirectionSerializer(HideOtherGroupsCountMixin, serializers.ModelSerializer):
    work_group_code = serializers.CharField(source="work_group.code", read_only=True)
    task_count = serializers.IntegerField(read_only=True, allow_null=True)

    class Meta:
        model = Direction
        fields = ["id", "code", "work_group", "work_group_code", "title", "meaning", "task_count"]
        read_only_fields = ["code"]

    def validate_work_group(self, value):
        if self.instance and self.instance.work_group_id != value.id:
            raise serializers.ValidationError("A direction cannot move to another work group.")
        return value


class GroupMemberSerializer(serializers.ModelSerializer):
    work_group_code = serializers.CharField(source="work_group.code", read_only=True)
    activity_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = GroupMember
        fields = ["id", "name", "work_group", "work_group_code", "is_active", "activity_count"]

    def validate_name(self, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise serializers.ValidationError("The name cannot be empty.")
        return value


class LookupValueSerializer(serializers.ModelSerializer):
    is_core = serializers.BooleanField(read_only=True)
    usage = serializers.IntegerField(read_only=True)

    class Meta:
        model = LookupValue
        fields = ["id", "list_key", "value", "definition", "sort_order", "semantic", "is_core", "usage"]
        read_only_fields = ["semantic"]

    def validate_value(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("The value cannot be empty.")
        return value

    def validate(self, attrs):
        if self.instance and "list_key" in attrs and attrs["list_key"] != self.instance.list_key:
            raise serializers.ValidationError({"list_key": "A value cannot move to another list."})
        return attrs
