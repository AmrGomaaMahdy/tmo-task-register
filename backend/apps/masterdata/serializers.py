import re

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
        if user and not roles.sees_all(user) and self._group_id(obj) not in roles.view_group_ids(user):
            data["task_count"] = None
        return data


class WorkGroupSerializer(HideOtherGroupsCountMixin, serializers.ModelSerializer):
    task_count = serializers.IntegerField(read_only=True, allow_null=True)

    leader_name = serializers.SerializerMethodField()

    class Meta:
        model = WorkGroup
        fields = ["id", "code", "name", "mission", "weight", "is_active", "task_count", "leader", "leader_name"]

    def get_leader_name(self, obj) -> str:
        return (obj.leader.get_full_name() or obj.leader.get_username()) if obj.leader_id else ""

    def validate_leader(self, value):
        if value is not None and not value.is_active:
            raise serializers.ValidationError("Pick an active user as the leader.")
        return value

    def validate_mission(self, value: str) -> str:
        return " ".join((value or "").split())

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


PHONE = re.compile(r"^\+?[0-9][0-9 ()\-]{5,28}$")


class GroupMemberSerializer(serializers.ModelSerializer):
    work_group_code = serializers.CharField(source="work_group.code", read_only=True)
    activity_count = serializers.IntegerField(read_only=True, default=0)
    member_type_label = serializers.CharField(source="get_member_type_display", read_only=True)
    # The linked sign-in account, shown by its user name. Only Admins and the TMO link or unlink accounts.
    username = serializers.CharField(source="user.username", read_only=True, default="")

    class Meta:
        model = GroupMember
        fields = [
            "id",
            "name",
            "work_group",
            "work_group_code",
            "job_title",
            "email",
            "phone",
            "member_type",
            "member_type_label",
            "user",
            "username",
            "is_active",
            "activity_count",
        ]
        validators = []  # the name-per-group rule is checked in validate() with a readable message

    def validate(self, attrs):
        wg = attrs.get("work_group") or getattr(self.instance, "work_group", None)
        name = attrs.get("name") or getattr(self.instance, "name", "")
        others = GroupMember.objects.filter(work_group=wg, name__iexact=name)
        if self.instance:
            others = others.exclude(pk=self.instance.pk)
        if wg and others.exists():
            raise serializers.ValidationError({"name": f"{name} is already a member of {wg.code}."})
        user = self.context["request"].user
        manager = roles.can_manage_master_data(user)
        linking = "user" in attrs and attrs["user"] != getattr(self.instance, "user", None)
        if linking and not manager:
            raise serializers.ValidationError({"user": "Only Admins and the TMO link sign-in accounts."})
        new_type = attrs.get("member_type")
        to_leader = (
            new_type == GroupMember.MemberType.LEADER and getattr(self.instance, "member_type", None) != new_type
        )
        if to_leader and not manager:
            raise serializers.ValidationError({"member_type": "Only Admins and the TMO choose the group's leader."})
        return attrs

    def validate_user(self, value):
        if value is not None and not value.is_active:
            raise serializers.ValidationError("Pick an active user account.")
        return value

    def validate_name(self, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise serializers.ValidationError("The name cannot be empty.")
        return value

    def validate_job_title(self, value: str) -> str:
        return " ".join((value or "").split())

    def validate_email(self, value: str) -> str:
        """
        Optional; compared without regard to capitals. The same person may be a member of several groups
        with the same address, but two different people cannot share one.
        """
        value = (value or "").strip().lower()
        if value:
            name = " ".join((self.initial_data.get("name") or getattr(self.instance, "name", "")).split())
            others = GroupMember.objects.filter(email__iexact=value).exclude(name__iexact=name)
            if self.instance:
                others = others.exclude(pk=self.instance.pk)
            if others.exists():
                raise serializers.ValidationError("Another member already has this email address.")
        return value

    def validate_phone(self, value: str) -> str:
        """Optional; digits with an optional leading +, spaces, dashes or brackets, e.g. +966 11 234 5678."""
        value = " ".join((value or "").split())
        if value and not PHONE.match(value):
            raise serializers.ValidationError("Write the phone number with digits, e.g. +966 11 234 5678.")
        return value


class LookupValueSerializer(serializers.ModelSerializer):
    is_core = serializers.BooleanField(read_only=True)
    usage = serializers.IntegerField(read_only=True)

    class Meta:
        model = LookupValue
        fields = [
            "id",
            "list_key",
            "value",
            "definition",
            "sort_order",
            "semantic",
            "is_core",
            "usage",
            "work_group",
            "work_group_code",
        ]
        read_only_fields = ["semantic"]

    work_group_code = serializers.CharField(source="work_group.code", read_only=True, default="")

    def validate_value(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("The value cannot be empty.")
        return value

    def validate(self, attrs):
        if self.instance and "list_key" in attrs and attrs["list_key"] != self.instance.list_key:
            raise serializers.ValidationError({"list_key": "A value cannot move to another list."})
        key = attrs.get("list_key") or getattr(self.instance, "list_key", None)
        if attrs.get("work_group") is not None and key != LookupValue.ListKey.SUB_OBJECTIVE:
            raise serializers.ValidationError({"work_group": "Only sub-objectives belong to a work group."})
        return attrs
