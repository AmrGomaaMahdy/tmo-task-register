"""Consistent JSON errors for the API, including database integrity errors."""

import logging

from django.db.models.deletion import ProtectedError, RestrictedError
from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler

from .security import log_event


def api_exception_handler(exc, context):
    if isinstance(exc, (ProtectedError, RestrictedError)):
        count = len(getattr(exc, "protected_objects", []) or getattr(exc, "restricted_objects", []))
        return Response(
            {"detail": f"This value is still in use by {count} record(s). Change those records first."},
            status=status.HTTP_409_CONFLICT,
        )
    response = exception_handler(exc, context)
    request = context.get("request")
    if isinstance(exc, exceptions.NotAuthenticated) and response is not None:
        # A machine-readable reason, so the web app can tell an ended session from a refused action.
        response.data["code"] = "not_authenticated"
    elif isinstance(exc, exceptions.PermissionDenied) and response is not None:
        # OWASP A09: refused actions are logged, so probing for other groups' data shows up in monitoring.
        log_event("permission_denied", request, level=logging.WARNING, status=response.status_code)
    elif isinstance(exc, exceptions.Throttled):
        log_event("throttled", request, level=logging.WARNING)
    return response
