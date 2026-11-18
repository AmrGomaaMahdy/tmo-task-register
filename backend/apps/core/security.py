"""
Security event logging (OWASP A09: Security Logging and Monitoring Failures).

Security events go to the "security" logger as one line each, in a key=value form that log tools can
parse: sign-ins, failed sign-ins, lockouts, sign-outs, ended sessions, refused requests, backups and
restores. The audit log (apps.core.audit) records business changes for people to read; this log is
for monitoring and alerting, and never contains passwords, session keys or tokens.
"""

import logging

from django.conf import settings

logger = logging.getLogger("security")


def client_ip(request) -> str:
    """
    The client's address. Behind a trusted reverse proxy (nginx in Docker, Render's edge), the proxy's own
    address is in REMOTE_ADDR, so the client is read from X-Forwarded-For, counting DJANGO_NUM_PROXIES
    trusted hops from the right. Without trusted proxies the header is ignored, because anyone can send it.
    """
    if request is None:
        return "-"
    hops = settings.REST_FRAMEWORK.get("NUM_PROXIES") or 0
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if hops and forwarded:
        chain = [part.strip() for part in forwarded.split(",") if part.strip()]
        if chain:
            return chain[-min(hops, len(chain))]
    return request.META.get("REMOTE_ADDR", "-") or "-"


def _clean(value) -> str:
    """One token per value: no spaces or line breaks, so a crafted user name cannot forge log lines."""
    text = str(value if value is not None else "-")
    text = text.replace("\r", " ").replace("\n", " ").replace("=", ":")
    return "_".join(text.split())[:120] or "-"


def log_event(event: str, request=None, user=None, level: int = logging.INFO, **fields) -> None:
    """Write one security event, e.g. log_event("login_failed", request, username="x")."""
    who = user if user is not None else getattr(request, "user", None)
    name = who.get_username() if getattr(who, "is_authenticated", False) else fields.pop("username", "-")
    parts = {
        "event": event,
        "user": name,
        "ip": client_ip(request),
        "method": getattr(request, "method", "-"),
        "path": getattr(request, "path", "-"),
        **fields,
    }
    # The request and fields travel with the record, so the System issues handler can store them.
    logger.log(
        level,
        " ".join(f"{k}={_clean(v)}" for k, v in parts.items()),
        extra={"event": event, "request": request, "fields": parts},
    )
