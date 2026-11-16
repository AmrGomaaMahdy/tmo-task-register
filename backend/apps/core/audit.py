"""Helper to write audit entries from views and services."""

from .models import AuditLog


def record(user, action: str, entity: str, obj=None, summary: str = "", label: str = "") -> None:
    AuditLog.objects.create(
        actor=user if getattr(user, "is_authenticated", False) else None,
        action=action,
        entity=entity,
        entity_id=str(getattr(obj, "pk", "") or ""),
        entity_label=label or str(getattr(obj, "code", "") or "")[:60],
        summary=summary[:300],
    )
