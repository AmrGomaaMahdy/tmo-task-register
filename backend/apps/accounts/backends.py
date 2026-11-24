"""Authentication backend that refuses locked accounts, for the API sign-in and the Django admin alike."""

from django.contrib.auth.backends import ModelBackend
from django.core.exceptions import PermissionDenied

from apps.core.security import client_ip

from . import lockout


class LockoutModelBackend(ModelBackend):
    """
    Django's user name and password check, preceded by the lockout check (OWASP A07).
    Raising PermissionDenied stops Django from trying any other backend, and fires user_login_failed.
    """

    def authenticate(self, request, username=None, password=None, **kwargs):
        if username and lockout.is_locked(username, client_ip(request)):
            raise PermissionDenied("locked")
        return super().authenticate(request, username=username, password=password, **kwargs)
