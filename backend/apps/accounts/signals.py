"""Sign-in events: lockout counters, the absolute session start, and security log lines."""

import logging
import time

from django.contrib.admin.models import LogEntry
from django.contrib.auth.signals import user_logged_in, user_logged_out, user_login_failed
from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.core import audit
from apps.core.security import client_ip, log_event

from . import lockout

# Key in the session for the moment of sign-in; SessionLifetimeMiddleware ends the session after
# SESSION_ABSOLUTE_HOURS, however active it is (OWASP A07: session expiry).
SESSION_STARTED = "auth_started_at"


@receiver(user_logged_in)
def on_login(sender, request, user, **kwargs):
    if request is None:
        return
    lockout.reset(user.get_username(), client_ip(request))
    request.session[SESSION_STARTED] = int(time.time())
    log_event("login", request, user)


@receiver(user_login_failed)
def on_login_failed(sender, credentials, request=None, **kwargs):
    # Django masks the password in `credentials`; only the user name is used here.
    username = (credentials or {}).get("username", "")
    locked = lockout.register_failure(username, client_ip(request)) if request is not None else False
    log_event("login_failed", request, username=username, level=logging.WARNING)
    # Also in the audit trail, so "why can't this person sign in?" can be answered from one page.
    audit.record(
        None,
        "login_failed",
        "User",
        summary=f"Failed sign-in for {username[:60] or 'an empty user name'}"
        + (" (account now locked)" if locked else ""),
        label=username[:60],
        actor_name=username,
    )
    if locked:
        log_event("account_locked", request, username=username, level=logging.WARNING)


@receiver(user_logged_out)
def on_logout(sender, request, user, **kwargs):
    if request is not None and user is not None:
        log_event("logout", request, user)


@receiver(post_save, sender=LogEntry)
def on_admin_change(sender, instance: LogEntry, created, **kwargs):
    """Changes made in the Django admin site (users, roles) join the audit trail."""
    if not created:
        return
    verb = {1: "added", 2: "changed", 3: "deleted"}.get(instance.action_flag, "changed")
    model = instance.content_type.name if instance.content_type_id else "record"
    message = instance.get_change_message() or ""
    audit.record(
        instance.user,
        "admin",
        model.capitalize(),
        None,
        f"Admin site: {verb} {model} {instance.object_repr}"[:300],
        label=str(instance.object_repr)[:60],
        changes={"Admin change": [None, message]} if message else {},
    )
