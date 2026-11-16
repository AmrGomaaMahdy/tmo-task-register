from django.apps import AppConfig


class MasterdataConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.masterdata"
    verbose_name = "Master data"

    def ready(self) -> None:
        from . import signals  # noqa: F401
