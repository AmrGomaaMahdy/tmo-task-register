"""
Outgoing email: sign-in codes and delegation notices, in English and Arabic in one message.

Sending never breaks the action that triggered it, except where the email is the action itself (the
sign-in code): send() returns False on failure and records a system issue.
"""

import logging
from html import escape

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.core.mail.backends.base import BaseEmailBackend
from django.core.mail.backends.console import EmailBackend as ConsoleBackend
from django.core.mail.backends.smtp import EmailBackend as SmtpBackend

from . import policy

logger = logging.getLogger("apps.accounts.mail")


def configured() -> bool:
    """Can email leave the server? The System settings page's SMTP server, or EMAIL_HOST."""
    s = policy.current()
    return bool(s.email_enabled and s.smtp_host) or settings.EMAIL_CONFIGURED


def from_address() -> str:
    s = policy.current()
    return (s.from_email if s.email_enabled and s.from_email else "") or settings.DEFAULT_FROM_EMAIL


class ConfiguredEmailBackend(BaseEmailBackend):
    """
    Sends through the SMTP server set on the System settings page when it is switched on there, else
    through EMAIL_HOST from the environment, else prints the message to the server log.
    """

    def __init__(self, fail_silently=False, **kwargs):
        super().__init__(fail_silently=fail_silently)
        s = policy.current()
        if s.email_enabled and s.smtp_host:
            self.inner = SmtpBackend(
                host=s.smtp_host,
                port=s.smtp_port,
                username=s.smtp_user or None,
                password=policy.decrypt(s.smtp_password_enc) or None,
                use_tls=s.smtp_security == "starttls",
                use_ssl=s.smtp_security == "ssl",
                timeout=settings.EMAIL_TIMEOUT,
                fail_silently=fail_silently,
            )
        elif settings.EMAIL_HOST:
            self.inner = SmtpBackend(fail_silently=fail_silently)
        else:
            self.inner = ConsoleBackend(fail_silently=fail_silently)

    def send_messages(self, email_messages):
        return self.inner.send_messages(email_messages)


def _html(en: list[str], ar: list[str], code: str = "") -> str:
    big = (
        '<p style="font:700 30px/1.2 Consolas,monospace;letter-spacing:6px;color:#0b1e33;margin:18px 0">'
        f"{escape(code)}</p>"
        if code
        else ""
    )
    p = lambda lines, rtl: "".join(  # noqa: E731
        f'<p style="margin:0 0 10px;{"direction:rtl;text-align:right;" if rtl else ""}">{escape(t)}</p>' for t in lines
    )
    return (
        '<div style="font:15px/1.5 Segoe UI,Tahoma,Arial,sans-serif;color:#13202e;max-width:560px">'
        '<p style="font-weight:700;color:#1a64ac;margin:0 0 14px">Al-Ayuni · TMO Task Register</p>'
        f"{p(en[:1], False)}{big}{p(en[1:], False)}"
        '<hr style="border:0;border-top:1px solid #d4dce5;margin:18px 0">'
        f'<div dir="rtl">{p(ar[:1], True)}{big}{p(ar[1:], True)}</div>'
        "</div>"
    )


def send(to: str, subject: str, en: list[str], ar: list[str], code: str = "") -> bool:
    """Send one bilingual message; `code` is shown large in both halves (sign-in codes)."""
    if not to:
        return False
    text = (
        "\n".join(en[:1] + ([code] if code else []) + en[1:])
        + "\n\n"
        + "\n".join(ar[:1] + ([code] if code else []) + ar[1:])
    )
    msg = EmailMultiAlternatives(settings.EMAIL_SUBJECT_PREFIX + subject, text, from_address(), [to])
    msg.attach_alternative(_html(en, ar, code), "text/html")
    try:
        msg.send(fail_silently=False)
        return True
    except Exception:  # SMTP down, wrong credentials, refused address…
        logger.exception("Email to %s failed: %s", to, subject)
        return False


def app_link(path: str = "/") -> str:
    return f"{settings.APP_PUBLIC_URL}{path}" if settings.APP_PUBLIC_URL else ""
