import logging

from django.conf import settings
from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core import audit
from apps.core.security import client_ip, log_event

from . import lockout
from .serializers import LoginSerializer, MeSerializer, PasswordChangeSerializer


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(APIView):
    """Sets the CSRF cookie and reports which sign-in methods are available."""

    permission_classes = [permissions.AllowAny]

    @extend_schema(responses={200: dict})
    def get(self, request):
        return Response({"oidc_enabled": settings.OIDC_ENABLED, "authenticated": request.user.is_authenticated})


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = "login"

    @extend_schema(request=LoginSerializer, responses={200: MeSerializer})
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        username = serializer.validated_data["username"]
        # OWASP A07: too many failed attempts lock the user name for a while. The message is the same
        # for existing and unknown user names, so it does not reveal which accounts exist.
        if lockout.is_locked(username, client_ip(request)):
            log_event("login_refused_locked", request, username=username)
            minutes = settings.LOGIN_LOCKOUT_MINUTES
            return Response(
                {"detail": f"Too many failed sign-ins. Wait {minutes} minutes, then try again.", "code": "locked"},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        user = authenticate(request, **serializer.validated_data)
        if user is None or not user.is_active:
            # Same message for unknown user and wrong password, so accounts can't be probed.
            return Response({"detail": "The user name or password is incorrect."}, status=status.HTTP_400_BAD_REQUEST)
        # login() gives the session a new key, so a session id planted before sign-in is useless
        # (session fixation, OWASP A07).
        login(request, user)
        audit.record(user, "login", "User", user, f"{user.get_username()} signed in", label=user.get_username())
        return Response(MeSerializer(user).data)


class LogoutView(APIView):
    @extend_schema(request=None, responses={204: None})
    def post(self, request):
        # Logout is a POST with the CSRF token, so another site cannot sign the user out.
        if request.user.is_authenticated:
            name = request.user.get_username()
            audit.record(request.user, "logout", "User", request.user, f"{name} signed out", label=name)
        logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    @extend_schema(responses={200: MeSerializer})
    def get(self, request):
        return Response(MeSerializer(request.user).data)


@method_decorator(csrf_protect, name="dispatch")
class PasswordView(APIView):
    """
    A signed-in user changes their own password: the current one is required, the new one must pass the
    password rules (at least 12 characters, not common, not all digits, not like the user name). Other
    sessions keep working only on this browser (the session is renewed); the change is in the audit trail.
    """

    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = "login"

    @extend_schema(request=PasswordChangeSerializer, responses={204: None})
    def post(self, request):
        s = PasswordChangeSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = request.user
        if not user.has_usable_password() or not user.check_password(s.validated_data["current_password"]):
            log_event("password_change_failed", request, level=logging.WARNING)
            return Response(
                {"current_password": ["The current password is not correct."]}, status=status.HTTP_400_BAD_REQUEST
            )
        try:
            validate_password(s.validated_data["new_password"], user)
        except DjangoValidationError as exc:
            return Response({"new_password": list(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)
        user.set_password(s.validated_data["new_password"])
        user.save(update_fields=["password"])
        update_session_auth_hash(request, user)  # stay signed in here; other sessions must sign in again
        audit.record(
            user, "update", "User", user, f"{user.get_username()} changed their password", label=user.get_username()
        )
        log_event("password_changed", request)
        return Response(status=status.HTTP_204_NO_CONTENT)
