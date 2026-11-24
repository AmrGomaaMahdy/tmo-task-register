from django.urls import path
from rest_framework.routers import DefaultRouter

from .delegations import DelegationViewSet
from .users import UserViewSet
from .views import (
    CsrfView,
    LoginResendView,
    LoginVerifyView,
    LoginView,
    LogoutView,
    MeView,
    PasswordView,
    SecurityTestEmailView,
    SystemSettingsView,
)

router = DefaultRouter()
router.register("delegations", DelegationViewSet, basename="delegation")
router.register("users", UserViewSet, basename="user")

urlpatterns = [
    path("csrf/", CsrfView.as_view(), name="auth-csrf"),
    path("login/", LoginView.as_view(), name="auth-login"),
    path("login/verify/", LoginVerifyView.as_view(), name="auth-login-verify"),
    path("login/resend/", LoginResendView.as_view(), name="auth-login-resend"),
    path("settings/", SystemSettingsView.as_view(), name="auth-settings"),
    path("security/", SystemSettingsView.as_view(), name="auth-security"),  # the 1.24 name
    path("settings/test-email/", SecurityTestEmailView.as_view(), name="auth-settings-test"),
    path("security/test-email/", SecurityTestEmailView.as_view(), name="auth-security-test"),
    path("logout/", LogoutView.as_view(), name="auth-logout"),
    path("me/", MeView.as_view(), name="auth-me"),
    path("password/", PasswordView.as_view(), name="auth-password"),
] + router.urls
