"""
Security middleware.

SessionLifetimeMiddleware (OWASP A07): the automatic sign-out set on the System settings page. A session
ends after so many minutes without a request and, at the latest, so many hours after sign-in, however
active it is; each rule has its own switch. The next API call then answers "not_authenticated" and the web
app shows the sign-in page. It also holds back a user who must change their password (expired, or set by
an administrator): until they do, only the sign-in, sign-out, "me" and password calls answer.

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

from django.contrib.auth import logout
from django.http import JsonResponse

from .security import log_event

PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()"
API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"


LAST_SEEN = "auth_last_seen"
# What a user who must change their password can still reach.
PASSWORD_GATE_OPEN = (
    "/api/auth/csrf/",
    "/api/auth/me/",
    "/api/auth/password/",
    "/api/auth/logout/",
    "/api/auth/login/",
    "/api/client-errors/",
)


class SessionLifetimeMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        from apps.accounts import policy
        from apps.accounts.signals import SESSION_STARTED

        user = getattr(request, "user", None)
        if user is not None and user.is_authenticated:
            s = policy.current()
            now = int(time.time())
            started = request.session.get(SESSION_STARTED)
            seen = request.session.get(LAST_SEEN)
            if started is None:
                request.session[SESSION_STARTED] = now
            elif s.session_limit_enabled and now - started > s.session_limit_hours * 3600:
                log_event("session_expired", request, user, reason="absolute_lifetime")
                logout(request)
                return self.get_response(request)
            if s.idle_timeout_enabled and seen is not None and now - seen > s.idle_timeout_minutes * 60:
                log_event("session_expired", request, user, reason="idle")
                logout(request)
                return self.get_response(request)
            request.session[LAST_SEEN] = now
            if request.path.startswith("/api/") and not request.path.startswith(PASSWORD_GATE_OPEN):
                status = policy.password_status(user)
                if status["required"]:
                    return JsonResponse(
                        {
                            "detail": "Change your password to continue.",
                            "code": "password_change_required",
                        },
                        status=403,
                    )
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
