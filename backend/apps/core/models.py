from django.conf import settings
from django.db import models


class AuditLog(models.Model):
    """
    An append-only record of who changed what, and when (the audit trail). Each entry keeps the field
    values before and after the change, and where the request came from, for tracking and troubleshooting.
    """

    class Action(models.TextChoices):
        CREATE = "create", "Created"
        UPDATE = "update", "Updated"
        DELETE = "delete", "Deleted"
        TRANSITION = "transition", "Status changed"
        APPROVAL = "approval", "Leader decision"
        REVIEW = "review", "Link review"
        REMOVE = "remove", "Removed by leader"
        LOGIN = "login", "Signed in"
        LOGOUT = "logout", "Signed out"
        LOGIN_FAILED = "login_failed", "Failed sign-in"
        EXPORT = "export", "Exported"
        RESTORE = "restore", "Restored"
        ADMIN = "admin", "Admin site change"

    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    # The user name at the time, kept even if the user is later renamed, deleted or restored from a backup.
    actor_name = models.CharField(max_length=150, blank=True)
    action = models.CharField(max_length=20, choices=Action.choices, db_index=True)
    entity = models.CharField(max_length=50, db_index=True)
    entity_id = models.CharField(max_length=50, blank=True)
    entity_label = models.CharField(max_length=60, blank=True)
    work_group = models.CharField(max_length=5, blank=True, db_index=True)
    summary = models.CharField(max_length=300)
    # {"Field": [before, after]}; on create only "after", on delete only "before".
    changes = models.JSONField(default=dict, blank=True)
    ip = models.CharField(max_length=45, blank=True)
    user_agent = models.CharField(max_length=250, blank=True)
    method = models.CharField(max_length=10, blank=True)
    path = models.CharField(max_length=250, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.created_at:%Y-%m-%d %H:%M} {self.actor} {self.summary}"


class SystemEvent(models.Model):
    """
    An error or warning for the administrators: server errors (with the traceback), errors in users'
    browsers, and security warnings (failed sign-ins, lockouts, refused requests, CSRF failures).
    Repeats of the same problem are counted on one row (same fingerprint) instead of filling the table.
    """

    class Level(models.TextChoices):
        ERROR = "error", "Error"
        WARNING = "warning", "Warning"

    class Source(models.TextChoices):
        SERVER = "server", "Server"
        BROWSER = "browser", "Browser"
        SECURITY = "security", "Security"

    level = models.CharField(max_length=10, choices=Level.choices, db_index=True)
    source = models.CharField(max_length=10, choices=Source.choices, db_index=True)
    kind = models.CharField(max_length=60)
    message = models.CharField(max_length=500)
    detail = models.TextField(blank=True)
    path = models.CharField(max_length=250, blank=True)
    method = models.CharField(max_length=10, blank=True)
    status_code = models.PositiveSmallIntegerField(null=True, blank=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    username = models.CharField(max_length=150, blank=True)
    ip = models.CharField(max_length=45, blank=True)
    user_agent = models.CharField(max_length=250, blank=True)
    fingerprint = models.CharField(max_length=40, db_index=True)
    count = models.PositiveIntegerField(default=1)
    first_seen = models.DateTimeField(auto_now_add=True)
    last_seen = models.DateTimeField(db_index=True)
    resolved = models.BooleanField(default=False, db_index=True)
    resolved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolution_note = models.CharField(max_length=500, blank=True)

    class Meta:
        ordering = ["-last_seen"]

    def __str__(self) -> str:
        return f"{self.get_level_display()} {self.kind}: {self.message[:60]}"
