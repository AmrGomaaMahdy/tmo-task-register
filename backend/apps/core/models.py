from django.conf import settings
from django.db import models


class AuditLog(models.Model):
    """An append-only record of who changed what, and when."""

    class Action(models.TextChoices):
        CREATE = "create", "Created"
        UPDATE = "update", "Updated"
        DELETE = "delete", "Deleted"
        TRANSITION = "transition", "Status changed"
        LOGIN = "login", "Signed in"
        EXPORT = "export", "Exported"
        RESTORE = "restore", "Restored"

    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    action = models.CharField(max_length=20, choices=Action.choices)
    entity = models.CharField(max_length=50)
    entity_id = models.CharField(max_length=50, blank=True)
    entity_label = models.CharField(max_length=60, blank=True)
    summary = models.CharField(max_length=300)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.created_at:%Y-%m-%d %H:%M} {self.actor} {self.summary}"
