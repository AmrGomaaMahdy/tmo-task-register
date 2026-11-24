from rest_framework import serializers

from .models import AuditLog, SystemEvent


class AuditLogSerializer(serializers.ModelSerializer):
    actor = serializers.SerializerMethodField()
    action_label = serializers.CharField(source="get_action_display", read_only=True)

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "actor",
            "actor_name",
            "action",
            "action_label",
            "entity",
            "entity_id",
            "entity_label",
            "work_group",
            "summary",
            "changes",
            "ip",
            "user_agent",
            "method",
            "path",
            "created_at",
        ]

    def get_actor(self, obj) -> str:
        if obj.actor:
            return obj.actor.get_full_name() or obj.actor.get_username()
        return obj.actor_name or "System"


class SystemEventSerializer(serializers.ModelSerializer):
    level_label = serializers.CharField(source="get_level_display", read_only=True)
    source_label = serializers.CharField(source="get_source_display", read_only=True)
    resolved_by_name = serializers.SerializerMethodField()

    class Meta:
        model = SystemEvent
        fields = [
            "id",
            "level",
            "level_label",
            "source",
            "source_label",
            "kind",
            "message",
            "detail",
            "path",
            "method",
            "status_code",
            "username",
            "ip",
            "user_agent",
            "count",
            "first_seen",
            "last_seen",
            "resolved",
            "resolved_by_name",
            "resolved_at",
            "resolution_note",
        ]

    def get_resolved_by_name(self, obj) -> str:
        u = obj.resolved_by
        return (u.get_full_name() or u.get_username()) if u else ""


class ClientErrorSerializer(serializers.Serializer):
    """An error in the user's browser, as the web app reports it. Sizes are capped."""

    message = serializers.CharField(max_length=500)
    stack = serializers.CharField(max_length=6000, required=False, allow_blank=True, default="")
    url = serializers.CharField(max_length=250, required=False, allow_blank=True, default="")
    where = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")


class ResolveSerializer(serializers.Serializer):
    note = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")
