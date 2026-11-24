import logging

from django.conf import settings
from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, serializers, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core import audit
from apps.core.security import client_ip, log_event

from . import lockout, mail, mfa, policy
from .models import SecuritySettings
from .roles import is_admin
from .serializers import LoginSerializer, MeSerializer, PasswordChangeSerializer


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfView(APIView):
    """Sets the CSRF cookie and reports which sign-in methods are available."""

    permission_classes = [permissions.AllowAny]

    @extend_schema(responses={200: dict})
    def get(self, request):
        return Response(
            {
                "oidc_enabled": settings.OIDC_ENABLED,
                "authenticated": request.user.is_authenticated,
                # The sign-in page says a code will follow by email.
                "mfa_email": mfa.enabled(),
            }
        )


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
        # Two-step sign-in (Configuration → Security): the password was right; now a code goes by email.
        if mfa.enabled():
            if not user.email:
                log_event("login_mfa_no_email", request, username=username)
                return Response(
                    {
                        "detail": "Your account has no email address for the sign-in code. "
                        "Ask an administrator to add it.",
                        "code": "no_email",
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            info = mfa.start(request, user)
            if info is None:
                return Response(
                    {
                        "detail": "The sign-in code could not be sent. Try again in a few minutes.",
                        "code": "email_failed",
                    },
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
            log_event("login_mfa_code_sent", request, username=username)
            return Response(info)
        return _sign_in(request, user)


def _sign_in(request, user) -> Response:
    # login() gives the session a new key, so a session id planted before sign-in is useless
    # (session fixation, OWASP A07).
    login(request, user)
    audit.record(user, "login", "User", user, f"{user.get_username()} signed in", label=user.get_username())
    return Response(MeSerializer(user).data)


MFA_MESSAGES = {
    "expired": "The code has expired. Sign in again to get a new one.",
    "wrong": "The code is not right. Check the latest email and try again.",
    "too_many": "Too many wrong codes. Sign in again to get a new one.",
    "email_failed": "The sign-in code could not be sent. Try again in a few minutes.",
}


class CodeSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=12)


@method_decorator(csrf_protect, name="dispatch")
class LoginVerifyView(APIView):
    """Second step of the sign-in: the code from the email."""

    permission_classes = [permissions.AllowAny]
    # Its own budget, so the second step does not halve the sign-ins an office behind one address can make.
    throttle_scope = "login_code"

    @extend_schema(request=CodeSerializer, responses={200: MeSerializer})
    def post(self, request):
        s = CodeSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        p = mfa.pending(request)
        user, result = mfa.check(request, s.validated_data["code"])
        if user is not None:
            return _sign_in(request, user)
        if p and result in ("wrong", "too_many"):
            pending_user = mfa.user_of(p)
            name = pending_user.get_username() if pending_user else ""
            lockout.register_failure(name, client_ip(request))
            log_event("login_mfa_code_wrong", request, username=name)
        return Response({"detail": MFA_MESSAGES[result], "code": result}, status=status.HTTP_400_BAD_REQUEST)


@method_decorator(csrf_protect, name="dispatch")
class LoginResendView(APIView):
    """Send a new sign-in code (not more often than every 30 seconds)."""

    permission_classes = [permissions.AllowAny]
    throttle_scope = "login_code"

    @extend_schema(request=None, responses={200: dict})
    def post(self, request):
        info, result = mfa.resend(request)
        if result == "sent":
            return Response(info)
        if result == "wait":
            return Response(
                {"detail": "Wait a few seconds before asking for a new code.", "code": "wait", **info},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        return Response(
            {"detail": MFA_MESSAGES.get(result, MFA_MESSAGES["expired"]), "code": result},
            status=status.HTTP_400_BAD_REQUEST,
        )


LABELS = {
    "email_enabled": "Outgoing email (own SMTP server)",
    "smtp_host": "SMTP server",
    "smtp_port": "SMTP port",
    "smtp_security": "SMTP security",
    "smtp_user": "SMTP user",
    "from_email": "Sender address",
    "mfa_email_enabled": "Email code at sign-in",
    "mfa_code_minutes": "Code valid (minutes)",
    "password_expiry_enabled": "Password expiry",
    "password_expiry_days": "Password expires after (days)",
    "password_length_enabled": "Minimum password length",
    "password_min_length": "Minimum length (characters)",
    "idle_timeout_enabled": "Sign out after inactivity",
    "idle_timeout_minutes": "Inactivity limit (minutes)",
    "session_limit_enabled": "Maximum session length",
    "session_limit_hours": "Session length (hours)",
}


class SystemSettingsSerializer(serializers.ModelSerializer):
    """The System settings page. The SMTP password is write-only: an empty value keeps the stored one."""

    smtp_password = serializers.CharField(write_only=True, required=False, allow_blank=True, max_length=200)
    smtp_password_clear = serializers.BooleanField(write_only=True, required=False, default=False)
    smtp_password_set = serializers.SerializerMethodField()
    email_configured = serializers.SerializerMethodField()
    env_email = serializers.SerializerMethodField()
    effective_from = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()
    users_without_email = serializers.SerializerMethodField()
    mfa_code_minutes = serializers.IntegerField(min_value=3, max_value=30, required=False)
    password_expiry_days = serializers.IntegerField(min_value=7, max_value=730, required=False)
    password_min_length = serializers.IntegerField(min_value=6, max_value=64, required=False)
    idle_timeout_minutes = serializers.IntegerField(min_value=5, max_value=1440, required=False)
    session_limit_hours = serializers.IntegerField(min_value=1, max_value=168, required=False)
    smtp_port = serializers.IntegerField(min_value=1, max_value=65535, required=False)

    class Meta:
        model = SecuritySettings
        fields = [*LABELS, "smtp_password", "smtp_password_clear", "smtp_password_set", "email_configured",
                  "env_email", "effective_from", "updated_at", "updated_by_name", "users_without_email"]  # fmt: skip
        read_only_fields = ["updated_at"]

    def get_smtp_password_set(self, obj) -> bool:
        return bool(obj.smtp_password_enc)

    def get_email_configured(self, obj) -> bool:
        return bool(obj.email_enabled and obj.smtp_host) or settings.EMAIL_CONFIGURED

    def get_env_email(self, obj) -> dict:
        """The server's own email settings (environment), used when the page's SMTP server is off."""
        return {"host": settings.EMAIL_HOST, "from": settings.DEFAULT_FROM_EMAIL} if settings.EMAIL_HOST else {}

    def get_effective_from(self, obj) -> str:
        return (obj.from_email if obj.email_enabled and obj.from_email else "") or settings.DEFAULT_FROM_EMAIL

    def get_users_without_email(self, obj) -> list[str]:
        """Active accounts that could not receive a code: they could not sign in with it on."""
        from django.contrib.auth import get_user_model

        users = get_user_model().objects.filter(is_active=True, email="").order_by("username")
        return list(users.values_list("username", flat=True)[:50])

    def get_updated_by_name(self, obj) -> str:
        u = obj.updated_by
        return (u.get_full_name() or u.get_username()) if u else ""

    def validate_from_email(self, value):
        value = value.strip()
        if value:
            from email.utils import parseaddr

            from django.core.validators import validate_email

            try:
                validate_email(parseaddr(value)[1])
            except DjangoValidationError as exc:
                raise serializers.ValidationError(
                    "Enter an email address, e.g. Task Register <no-reply@al-ayuni.com>."
                ) from exc
        return value

    def validate(self, attrs):
        obj = self.instance
        get = lambda k: attrs.get(k, getattr(obj, k))  # noqa: E731
        own = bool(get("email_enabled") and (get("smtp_host") or "").strip())
        if get("email_enabled") and not (get("smtp_host") or "").strip():
            raise serializers.ValidationError({"smtp_host": "Enter the SMTP server to switch outgoing email on."})
        if get("mfa_email_enabled") and not (own or settings.EMAIL_CONFIGURED):
            field = "mfa_email_enabled" if "mfa_email_enabled" in attrs else "email_enabled"
            raise serializers.ValidationError(
                {field: "The email code at sign-in needs outgoing email. Set up the SMTP server first, "
                 "or turn the email code off."}
            )  # fmt: skip
        return attrs

    def update(self, instance, validated):
        secret = validated.pop("smtp_password", "")
        if validated.pop("smtp_password_clear", False):
            instance.smtp_password_enc = ""
        elif secret:
            instance.smtp_password_enc = policy.encrypt(secret)
        if "smtp_host" in validated:
            validated["smtp_host"] = validated["smtp_host"].strip()
        return super().update(instance, validated)


class SystemSettingsView(APIView):
    """System settings (administrators): email, sign-in code, passwords, automatic sign-out."""

    def _check(self, request):
        if not is_admin(request.user):
            raise PermissionDenied("Only administrators change the system settings.")

    @extend_schema(responses={200: SystemSettingsSerializer})
    def get(self, request):
        self._check(request)
        return Response(SystemSettingsSerializer(SecuritySettings.current()).data)

    @extend_schema(request=SystemSettingsSerializer, responses={200: SystemSettingsSerializer})
    def patch(self, request):
        self._check(request)
        obj = SecuritySettings.current()
        before = {k: getattr(obj, k) for k in LABELS}
        had_secret = obj.smtp_password_enc
        s = SystemSettingsSerializer(obj, data=request.data, partial=True)
        s.is_valid(raise_exception=True)
        obj = s.save(updated_by=request.user)
        policy.forget()
        show = lambda v: ("On" if v else "Off") if isinstance(v, bool) else v  # noqa: E731
        changes = {LABELS[k]: [show(v), show(getattr(obj, k))] for k, v in before.items() if v != getattr(obj, k)}
        if had_secret != obj.smtp_password_enc:
            changes["SMTP password"] = ["(hidden)", "changed" if obj.smtp_password_enc else "removed"]
        if changes:
            audit.record(
                request.user, "update", "System settings", obj, "System settings changed", label="Settings",
                changes=changes,
            )  # fmt: skip
            log_event("system_settings_changed", request, fields=",".join(changes))
        return Response(SystemSettingsSerializer(obj).data)


class SecurityTestEmailView(APIView):
    """Sends a test message (to the administrator, or to the address given), to check the email set-up."""

    @extend_schema(request=None, responses={200: dict})
    def post(self, request):
        if not is_admin(request.user):
            raise PermissionDenied("Only administrators change the system settings.")
        to = (request.data.get("to") or request.user.email or "").strip()
        if not to:
            return Response(
                {"detail": "Add an email address to your own account first."}, status=status.HTTP_400_BAD_REQUEST
            )
        from django.core.validators import validate_email

        try:
            validate_email(to)
        except DjangoValidationError:
            return Response({"detail": "Enter a valid email address."}, status=status.HTTP_400_BAD_REQUEST)
        ok = mail.send(
            to,
            "Test message",
            ["This is a test message from the TMO Task Register. Email works."],
            ["هذه رسالة تجريبية من سجل المهام. البريد الإلكتروني يعمل."],
        )
        if not ok:
            return Response(
                {"detail": "The message could not be sent. Check the server, port, security, user and password."},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response({"sent_to": to})


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
        if user.check_password(s.validated_data["new_password"]):
            return Response(
                {"new_password": ["Choose a password different from the current one."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.set_password(s.validated_data["new_password"])
        user.save(update_fields=["password"])
        policy.password_set(user)
        update_session_auth_hash(request, user)  # stay signed in here; other sessions must sign in again
        audit.record(
            user, "update", "User", user, f"{user.get_username()} changed their password", label=user.get_username()
        )
        log_event("password_changed", request)
        return Response(status=status.HTTP_204_NO_CONTENT)
