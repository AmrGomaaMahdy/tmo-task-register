"""
The system settings (SecuritySettings), read often: every request checks the sign-out rules. They are
kept in memory for a few seconds per server worker; a change made on the System settings page takes
effect at once in the worker that saved it and within CACHE_SECONDS everywhere else.

Also the encryption of the SMTP password (Fernet, with a key derived from DJANGO_SECRET_KEY): changing
the secret key makes the stored password unreadable, and it must be entered again.
"""

from __future__ import annotations

import base64
import hashlib
import time
from datetime import timedelta

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.utils import timezone

CACHE_SECONDS = 10
_cache: dict = {"at": 0.0, "value": None}


def current():
    from .models import SecuritySettings

    now = time.monotonic()
    if _cache["value"] is None or now - _cache["at"] > CACHE_SECONDS:
        _cache["value"], _cache["at"] = SecuritySettings.current(), now
    return _cache["value"]


def forget() -> None:
    _cache["value"] = None


def _fernet() -> Fernet:
    key = hashlib.sha256(f"smtp-password:{settings.SECRET_KEY}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def encrypt(secret: str) -> str:
    return _fernet().encrypt(secret.encode()).decode() if secret else ""


def decrypt(token: str) -> str:
    if not token:
        return ""
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return ""


# ---- Passwords ----------------------------------------------------------------------------------


def min_password_length() -> int:
    """0 when the rule is off."""
    s = current()
    return s.password_min_length if s.password_length_enabled else 0


def password_status(user) -> dict:
    """
    {"required": bool, "reason": "reset" | "expired" | "", "expires_in_days": int | None} for the
    signed-in user. Accounts without a password of their own (Microsoft sign-in) are never asked.
    """
    if not user or not user.is_authenticated or not user.has_usable_password():
        return {"required": False, "reason": "", "expires_in_days": None}
    from .models import AccountSecurity

    sec = getattr(user, "_account_security", None) or AccountSecurity.of(user)
    user._account_security = sec
    if sec.must_change_password:
        return {"required": True, "reason": "reset", "expires_in_days": 0}
    s = current()
    if not s.password_expiry_enabled:
        return {"required": False, "reason": "", "expires_in_days": None}
    due = sec.password_changed_at + timedelta(days=s.password_expiry_days)
    left = (due - timezone.now()).days
    if timezone.now() >= due:
        return {"required": True, "reason": "expired", "expires_in_days": 0}
    return {"required": False, "reason": "", "expires_in_days": left}


def password_set(user, must_change: bool = False) -> None:
    """Record that the user's password was just set (by them, or by an administrator: must_change)."""
    from .models import AccountSecurity

    AccountSecurity.objects.update_or_create(
        user=user, defaults={"password_changed_at": timezone.now(), "must_change_password": must_change}
    )
    user.__dict__.pop("_account_security", None)
