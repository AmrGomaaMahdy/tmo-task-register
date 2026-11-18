"""Shared API permissions."""

from rest_framework import permissions

from apps.accounts.roles import is_admin


class IsAdministrator(permissions.BasePermission):
    """Administrators only (the API description, OWASP A01: least privilege)."""

    message = "Only administrators can do this."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and is_admin(request.user))
