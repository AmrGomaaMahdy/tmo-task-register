from django.apps import AppConfig


class AccountsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.accounts"
    verbose_name = "Accounts and roles"

    def ready(self):
        # Connects the sign-in signal handlers (lockout counters and security log).
        from . import signals  # noqa: F401
