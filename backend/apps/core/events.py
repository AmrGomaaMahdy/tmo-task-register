"""
System events: errors and warnings stored for the administrators' "System issues" page.

A logging handler copies these log records into the SystemEvent table:
- server errors (logger "django.request" at ERROR, i.e. every 500), with the exception and its traceback;
- security warnings (loggers "security" and "django.security"): failed sign-ins, lockouts, refused
  requests, rate limits, CSRF failures, requests for an unknown host name;
- errors in users' browsers, reported by the web app (see SystemEventViewSet.report).

The same problem is counted on one row: records with the same fingerprint (source, kind, message and
path, with numbers removed) add to the count of the newest open row seen in the last 24 hours.
Storing an event never breaks the request that caused it: any failure here is swallowed.
"""

from __future__ import annotations

import hashlib
import logging
import random
import re
import threading
import traceback
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

_local = threading.local()

SECURITY_TEXT = {
    "login_failed": "Failed sign-in",
    "account_locked": "Account locked after repeated failed sign-ins",
    "login_refused_locked": "Sign-in refused: account locked",
    "permission_denied": "Request refused: no permission",
    "throttled": "Too many requests (rate limit)",
    "session_expired": "Session ended by the time limit",
}


def _norm(text: str) -> str:
    """Numbers and ids removed, so /api/tasks/12/ and /api/tasks/13/ count as the same problem."""
    return re.sub(r"\d+", "#", text or "")[:300]


def fingerprint(source: str, kind: str, message: str, path: str) -> str:
    raw = "|".join((source, kind, _norm(message), _norm(path)))
    return hashlib.sha1(raw.encode()).hexdigest()  # noqa: S324 - a grouping key, not security


def store(
    *,
    level: str,
    source: str,
    kind: str,
    message: str,
    detail: str = "",
    request=None,
    status_code: int | None = None,
    path: str = "",
    username: str = "",
) -> None:
    """Save one event, or count it on the open row of the same problem. Never raises."""
    if getattr(_local, "busy", False):  # an error while storing an event must not loop
        return
    _local.busy = True
    try:
        from .models import SystemEvent
        from .security import client_ip

        user = getattr(request, "user", None)
        signed_in = getattr(user, "is_authenticated", False)
        path = (path or getattr(request, "path", "") or "")[:250]
        now = timezone.now()
        fp = fingerprint(source, kind, message, path)
        values = {
            "detail": detail[:20000],
            "method": (getattr(request, "method", "") or "")[:10],
            "status_code": status_code,
            "user": user if signed_in else None,
            "username": (user.get_username() if signed_in else username)[:150],
            "ip": client_ip(request) if request is not None else "",
            "user_agent": (request.META.get("HTTP_USER_AGENT", "") if request is not None else "")[:250],
            "last_seen": now,
        }
        open_row = (
            SystemEvent.objects.filter(fingerprint=fp, resolved=False, last_seen__gte=now - timedelta(hours=24))
            .order_by("-last_seen")
            .first()
        )
        if open_row:
            for k, v in values.items():
                setattr(open_row, k, v)
            open_row.count += 1
            open_row.save()
        else:
            SystemEvent.objects.create(
                level=level, source=source, kind=kind[:60], message=message[:500], path=path, fingerprint=fp, **values
            )
        if random.random() < 0.02:  # noqa: S311 - occasional clean-up, not security
            purge()
    except Exception:  # noqa: BLE001, S110 - storing an event must never break the request
        pass
    finally:
        _local.busy = False


def purge() -> int:
    """Delete events older than SYSTEM_EVENT_RETENTION_DAYS."""
    from .models import SystemEvent

    cutoff = timezone.now() - timedelta(days=settings.SYSTEM_EVENT_RETENTION_DAYS)
    deleted, _ = SystemEvent.objects.filter(last_seen__lt=cutoff).delete()
    return deleted


class DatabaseEventHandler(logging.Handler):
    """Logging handler that stores server errors and security warnings as SystemEvent rows."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            request = getattr(record, "request", None)
            if record.name == "security":
                event = getattr(record, "event", "security")
                fields = getattr(record, "fields", {}) or {}
                text = SECURITY_TEXT.get(event, event.replace("_", " ").capitalize())
                who = fields.get("user") or "-"
                store(
                    level="warning",
                    source="security",
                    kind=event,
                    message=f"{text}: {who}" if who != "-" else text,
                    detail=record.getMessage(),
                    request=request,
                    status_code=fields.get("status"),
                    path=str(fields.get("path", "") if fields.get("path") != "-" else ""),
                    username="" if who == "-" else str(who),
                )
            elif record.name.startswith("django.security"):
                store(
                    level="warning",
                    source="security",
                    kind=record.name.removeprefix("django.security.") or "django.security",
                    message=record.getMessage()[:500],
                    request=request,
                    status_code=getattr(record, "status_code", None),
                )
            elif record.levelno >= logging.ERROR:
                exc = record.exc_info[1] if record.exc_info else None
                kind = type(exc).__name__ if exc else record.name
                message = f"{type(exc).__name__}: {exc}" if exc else record.getMessage()
                detail = (
                    "".join(traceback.format_exception(*record.exc_info)) if record.exc_info else record.getMessage()
                )
                store(
                    level="error",
                    source="server",
                    kind=kind,
                    message=message[:500],
                    detail=detail,
                    request=request if hasattr(request, "META") else None,
                    status_code=getattr(record, "status_code", None),
                )
        except Exception:  # noqa: BLE001
            self.handleError(record)
