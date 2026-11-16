"""Restore points: a full backup kept automatically before every restore, so a restore can be undone."""

from django.db import models

KEEP = 5


class RestorePoint(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.CharField(max_length=150, blank=True)
    reason = models.CharField(max_length=300)
    counts = models.JSONField(default=dict)
    document = models.TextField(help_text="The backup document (JSON), as the backup download would hold it.")

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"{self.created_at:%Y-%m-%d %H:%M} – {self.reason}"
