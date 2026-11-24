"""
Error pages that the web app can read: under /api/ every error is JSON, never Django's HTML pages.

Behind a proxy (Render forwards /api from the static site to the API), a refused security check or a host
that is not allowed would otherwise come back as an HTML page, which the app cannot read and shows as
"Unexpected token '<'". With these, the sign-in page shows the real reason instead.
The admin site and other pages keep Django's own HTML pages.
"""

import logging

from django.http import JsonResponse
from django.views import defaults
from django.views.csrf import csrf_failure as html_csrf_failure

logger = logging.getLogger("security")


def _is_api(request) -> bool:
    return request.path.startswith("/api/")


def _origin(request) -> str:
    # Header values are written to the log, so drop line breaks and keep them short.
    return str(request.META.get("HTTP_ORIGIN", "none")).replace("\n", " ")[:120]


def csrf_failure(request, reason="", template_name=None):
    """CSRF_FAILURE_VIEW: the security check of a sign-in or a change was refused."""
    logger.warning("event=csrf_failed path=%s origin=%s reason=%s", request.path, _origin(request), reason)
    if not _is_api(request):
        return html_csrf_failure(request, reason=reason)
    hint = ""
    if "Origin checking failed" in reason:
        hint = (
            f" The address in the browser ({_origin(request)}) is not in DJANGO_CSRF_TRUSTED_ORIGINS"
            " of the API: add it exactly, with https:// and without a trailing slash."
        )
    elif "CSRF cookie not set" in reason:
        hint = " The browser did not send the security cookie: reload the page and sign in again."
    elif "Referer" in reason:
        hint = " The request arrived without the page address (Referer): check the proxy in front of the API."
    return JsonResponse(
        {"detail": f"The security check refused the request ({reason}).{hint}", "code": "csrf_failed"}, status=403
    )


def bad_request(request, exception=None):
    """handler400, also used for a host not in DJANGO_ALLOWED_HOSTS."""
    if not _is_api(request):
        return defaults.bad_request(request, exception)
    detail = "The server refused the request (400)."
    if exception is not None and exception.__class__.__name__ == "DisallowedHost":
        detail = (
            "The API does not accept requests for this address. Add the address you use to DJANGO_ALLOWED_HOSTS "
            "of the API (without https://)."
        )
        logger.warning("event=disallowed_host path=%s", request.path)
    return JsonResponse({"detail": detail, "code": "bad_request"}, status=400)


def permission_denied(request, exception=None):
    if not _is_api(request):
        return defaults.permission_denied(request, exception)
    return JsonResponse({"detail": "You do not have permission to do this.", "code": "permission_denied"}, status=403)


def page_not_found(request, exception=None):
    if not _is_api(request):
        return defaults.page_not_found(request, exception)
    return JsonResponse({"detail": "This address does not exist on the API.", "code": "not_found"}, status=404)


def server_error(request):
    if not _is_api(request):
        return defaults.server_error(request)
    return JsonResponse(
        {"detail": "The server had a problem. It has been recorded; try again in a moment.", "code": "server_error"},
        status=500,
    )
