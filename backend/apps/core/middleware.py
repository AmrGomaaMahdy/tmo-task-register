"""
Security middleware.

SessionLifetimeMiddleware (OWASP A07): a session ends after SESSION_IDLE_MINUTES without a request
(Django's SESSION_COOKIE_AGE with SESSION_SAVE_EVERY_REQUEST) and, at the latest,
SESSION_ABSOLUTE_HOURS after sign-in, however active it is. The next API call then answers
"not_authenticated" and the web app shows the sign-in page.

SecurityHeadersMiddleware (OWASP A05: Security Misconfiguration): headers Django does not send by
itself, so they are present even where no nginx stands in front (e.g. the Render deployment):
- Permissions-Policy: no camera, microphone, location, payment or USB access;
- Cross-Origin-Resource-Policy: other sites cannot embed the API's responses;
- on API responses: a Content-Security-Policy that allows nothing (JSON is never a page), and
  Cache-Control: no-store, so register data and user details are not kept in browser or proxy caches.
The single-page app's own CSP is sent by nginx (frontend/docker/security-headers.conf) or by the
static site (render.yaml).
"""

import time

from django.conf import settings
from django.contrib.auth import logout

from .security import log_event

PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"


class SessionLifetimeMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        from apps.accounts.signals import SESSION_STARTED

        user = getattr(request, "user", None)
        if user is not None and user.is_authenticated:
            started = request.session.get(SESSION_STARTED)
            limit = settings.SESSION_ABSOLUTE_HOURS * 3600
            if started is None:
                request.session[SESSION_STARTED] = int(time.time())
            elif time.time() - started > limit:
                log_event("session_expired", request, user, reason="absolute_lifetime")
                logout(request)
        return self.get_response(request)


class SecurityHeadersMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response.headers.setdefault("Permissions-Policy", PERMISSIONS_POLICY)
        response.headers.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        path = request.path
        # The API documentation page (Swagger UI) is an HTML page with its own scripts, so it keeps
        # Django's defaults; every other API answer is data.
        if (path.startswith("/api/") and not path.startswith("/api/docs")) or path == "/healthz":
            response.headers.setdefault("Content-Security-Policy", API_CSP)
            response.headers["Cache-Control"] = "no-store"
            response.headers["Pragma"] = "no-cache"
        return response
