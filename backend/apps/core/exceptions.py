"""Consistent JSON errors for the API, including database integrity errors."""

from django.db.models.deletion import ProtectedError, RestrictedError
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler


def api_exception_handler(exc, context):
    if isinstance(exc, (ProtectedError, RestrictedError)):
        count = len(getattr(exc, "protected_objects", []) or getattr(exc, "restricted_objects", []))
        return Response(
            {"detail": f"This value is still in use by {count} record(s). Change those records first."},
            status=status.HTTP_409_CONFLICT,
        )
    return exception_handler(exc, context)
