"""
Turn the email code at sign-in on or off from the server, e.g. when outgoing email stops working and
nobody can sign in to change it in Configuration → Security:

    python manage.py signin_code off
"""

from django.core.management.base import BaseCommand

from apps.accounts.models import SecuritySettings


class Command(BaseCommand):
    help = "Turn the email code at sign-in on or off (Configuration → Security)."

    def add_arguments(self, parser):
        parser.add_argument("state", choices=["on", "off", "status"])

    def handle(self, *args, state, **opts):
        s = SecuritySettings.current()
        if state != "status":
            s.mfa_email_enabled = state == "on"
            s.save(update_fields=["mfa_email_enabled", "updated_at"])
        self.stdout.write(f"Email code at sign-in: {'on' if s.mfa_email_enabled else 'off'}")
