"""
Audit trail: write entries from views and services, with what changed and where the request came from.

    before = audit.snapshot(task)              # readable field values before the change
    ... change and save ...
    audit.record(user, "update", "Task", task, "ICT-T030 edited", changes=audit.diff(before, audit.snapshot(task)))

The current request (address, browser, method and path) is picked up from RequestContextMiddleware, so
call sites do not pass it around.
"""

from __future__ import annotations

import json
from contextvars import ContextVar
from datetime import date, datetime

from django.db import models
from django.utils import timezone

from .models import AuditLog

_current_request: ContextVar = ContextVar("audit_request", default=None)
MAX_VALUE = 500
# Bookkeeping fields that change on every save and say nothing to a reader.
SKIP = {"id", "created_at", "updated_at", "created_by", "updated_by", "password", "last_login", "approval_at"}


class RequestContextMiddleware:
    """Keeps the current request for audit entries and system events written during it."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = _current_request.set(request)
        try:
            return self.get_response(request)
        finally:
            _current_request.reset(token)


def current_request():
    return _current_request.get()


def display(value) -> str | None:
    """A field value as a reader sees it: codes for linked records, ISO dates, Yes / No."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, datetime):
        return timezone.localtime(value).strftime("%Y-%m-%d %H:%M")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, models.Model):
        text = getattr(value, "code", None) or getattr(value, "value", None) or str(value)
        return str(text)[:MAX_VALUE]
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)[:MAX_VALUE]
    return str(value)[:MAX_VALUE]


def snapshot(obj, fields: list[str] | None = None) -> dict[str, str | None]:
    """Readable values of a record's own fields, keyed by the field's label."""
    if obj is None:
        return {}
    out: dict[str, str | None] = {}
    for f in obj._meta.concrete_fields:
        if f.name in SKIP or (fields is not None and f.name not in fields):
            continue
        label = str(f.verbose_name).capitalize()
        if f.choices:
            value = getattr(obj, f"get_{f.name}_display")() if getattr(obj, f.attname) not in (None, "") else None
        elif f.is_relation:
            value = getattr(obj, f.name) if getattr(obj, f.attname) is not None else None
        else:
            value = getattr(obj, f.name)
        out[label] = display(value)
    return out


def diff(before: dict, after: dict) -> dict[str, list]:
    """{label: [before, after]} for every value that differs."""
    keys = list(before) + [k for k in after if k not in before]
    return {k: [before.get(k), after.get(k)] for k in keys if before.get(k) != after.get(k)}


def created(after: dict) -> dict[str, list]:
    return {k: [None, v] for k, v in after.items() if v is not None}


def deleted(before: dict) -> dict[str, list]:
    return {k: [v, None] for k, v in before.items() if v is not None}


def _work_group(obj) -> str:
    for path in ("work_group", "task.work_group"):
        target = obj
        for part in path.split("."):
            target = getattr(target, part, None)
        if target is not None and getattr(target, "code", None):
            return str(target.code)[:5]
    return ""


def record(
    user,
    action: str,
    entity: str,
    obj=None,
    summary: str = "",
    label: str = "",
    changes: dict | None = None,
    actor_name: str = "",
    work_group: str = "",
) -> AuditLog:
    from .security import client_ip

    request = current_request()
    signed_in = getattr(user, "is_authenticated", False)
    return AuditLog.objects.create(
        actor=user if signed_in else None,
        actor_name=(user.get_username() if signed_in else actor_name)[:150],
        action=action,
        entity=entity,
        entity_id=str(getattr(obj, "pk", "") or ""),
        entity_label=label or str(getattr(obj, "code", "") or "")[:60],
        work_group=work_group or (_work_group(obj) if obj is not None else ""),
        summary=summary[:300],
        changes=changes or {},
        ip=client_ip(request) if request is not None else "",
        user_agent=(request.META.get("HTTP_USER_AGENT", "") if request is not None else "")[:250],
        method=getattr(request, "method", "") or "",
        path=(getattr(request, "path", "") or "")[:250],
    )
