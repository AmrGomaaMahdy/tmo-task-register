"""The minimum password length from the System settings page (Passwords → Minimum length)."""

from django.core.exceptions import ValidationError

from . import policy


class ConfiguredMinimumLengthValidator:
    """Like Django's MinimumLengthValidator, with the length (or no rule) taken from the settings."""

    def validate(self, password, user=None):
        n = policy.min_password_length()
        if n and len(password) < n:
            raise ValidationError(
                f"This password is too short. It must contain at least {n} characters.",
                code="password_too_short",
                params={"min_length": n},
            )

    def get_help_text(self):
        n = policy.min_password_length()
        return f"Your password must contain at least {n} characters." if n else ""
