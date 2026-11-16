from rest_framework import serializers

from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    actor = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = ["id", "actor", "action", "entity", "entity_id", "entity_label", "summary", "created_at"]

    def get_actor(self, obj) -> str:
        if not obj.actor:
            return "System"
        return obj.actor.get_full_name() or obj.actor.get_username()
