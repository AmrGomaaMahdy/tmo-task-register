"""
Two-step sign-in with a code sent by email (Configuration → Security; off by default).

1. POST /api/auth/login/ with the user name and password. When the email code is on and the password is
   right, the user is NOT signed in yet: a 6-digit code is emailed and the pending sign-in is kept in the
   (still anonymous) session: who, the code's keyed hash, when it expires, how many wrong tries.
2. POST /api/auth/login/verify/ with the code finishes the sign-in. POST /api/auth/login/resend/ sends
   a new code (at most every RESEND_SECONDS, at most MAX_SENDS times).

The code itself is never stored, only an HMAC of it with the secret key. Each wrong code counts as a
failed sign-in for the account lockout; MAX_TRIES wrong codes end the pending sign-in.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time

from django.conf import settings
from django.contrib.auth import get_user_model

from . import mail, policy

KEY = "mfa_pending"
MAX_TRIES = 5
MAX_SENDS = 5
RESEND_SECONDS = 30


def enabled() -> bool:
    return policy.current().mfa_email_enabled


def mask(email: str) -> str:
    """a***@al-ayuni.com: enough for the person to recognise the address, not to learn it."""
    name, _, domain = email.partition("@")
    return f"{name[:1]}{'*' * max(2, len(name) - 1)}@{domain}" if domain else "***"


def _digest(code: str, nonce: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), f"{nonce}:{code}".encode(), hashlib.sha256).hexdigest()


def _send(user, minutes: int) -> tuple[str, str] | None:
    code = f"{secrets.randbelow(1_000_000):06d}"
    nonce = secrets.token_hex(8)
    ok = mail.send(
        user.email,
        "Your sign-in code",
        [
            f"Hello {user.get_full_name() or user.get_username()}, your code to sign in to the Task Register is:",
            f"It is valid for {minutes} minutes. If you did not try to sign in, change your password and tell IT.",
        ],
        [
            f"مرحبًا {user.get_full_name() or user.get_username()}، رمز الدخول إلى سجل المهام هو:",
            f"صالح لمدة {minutes} دقائق. إذا لم تحاول تسجيل الدخول فغيّر كلمة المرور وأبلغ تقنية المعلومات.",
        ],
        code=code,
    )
    return (_digest(code, nonce), nonce) if ok else None


def start(request, user) -> dict | None:
    """Email a code and keep the pending sign-in; None when the email could not be sent."""
    minutes = policy.current().mfa_code_minutes
    sent = _send(user, minutes)
    if sent is None:
        return None
    now = time.time()
    request.session[KEY] = {
        "uid": user.pk,
        "backend": getattr(user, "backend", ""),
        "digest": sent[0],
        "nonce": sent[1],
        "expires": now + minutes * 60,
        "tries": 0,
        "sends": 1,
        "sent_at": now,
    }
    return {"mfa_required": True, "email": mask(user.email), "minutes": minutes, "resend_after": RESEND_SECONDS}


def pending(request) -> dict | None:
    return request.session.get(KEY)


def user_of(p: dict):
    return get_user_model().objects.filter(pk=p["uid"], is_active=True).first()


def resend(request) -> tuple[dict | None, str]:
    p = pending(request)
    if not p:
        return None, "expired"
    if p["sends"] >= MAX_SENDS:
        return None, "too_many"
    wait = RESEND_SECONDS - (time.time() - p["sent_at"])
    if wait > 0:
        return {"resend_after": int(wait) + 1}, "wait"
    user = user_of(p)
    if user is None:
        return None, "expired"
    minutes = policy.current().mfa_code_minutes
    sent = _send(user, minutes)
    if sent is None:
        return None, "email_failed"
    now = time.time()
    p.update(digest=sent[0], nonce=sent[1], expires=now + minutes * 60, tries=0, sends=p["sends"] + 1, sent_at=now)
    request.session[KEY] = p
    return {"email": mask(user.email), "minutes": minutes, "resend_after": RESEND_SECONDS}, "sent"


def check(request, code: str) -> tuple[object | None, str]:
    """('user', 'ok') when the code is right; otherwise (None, reason) with reason expired/wrong/too_many."""
    p = pending(request)
    if not p or time.time() > p["expires"]:
        request.session.pop(KEY, None)
        return None, "expired"
    code = "".join(ch for ch in code if ch.isdigit())
    if len(code) == 6 and hmac.compare_digest(_digest(code, p["nonce"]), p["digest"]):
        user = user_of(p)
        request.session.pop(KEY, None)
        if user is None:
            return None, "expired"
        user.backend = p["backend"] or settings.AUTHENTICATION_BACKENDS[0]
        return user, "ok"
    p["tries"] += 1
    if p["tries"] >= MAX_TRIES:
        request.session.pop(KEY, None)
        return None, "too_many"
    request.session[KEY] = p
    return None, "wrong"
