"""System settings: email, sign-out, passwords, each with its switch; and User access."""

import time
from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts import policy
from apps.accounts.models import AccountSecurity, SecuritySettings
from apps.accounts.signals import SESSION_STARTED
from apps.core.middleware import LAST_SEEN
from apps.masterdata.models import GroupMember, WorkGroup

from .conftest import PASSWORD

User = get_user_model()


def settings_row(**kw):
    SecuritySettings.objects.update_or_create(pk=1, defaults=kw)


def signed_in(username="ict.team"):
    c = APIClient()
    assert c.post("/api/auth/login/", {"username": username, "password": PASSWORD}).status_code == 200
    return c


def test_only_administrators_see_or_change_settings(client_for):
    assert client_for("tmo.officer").get("/api/auth/settings/").status_code == 403
    r = client_for("admin").get("/api/auth/settings/").json()
    assert r["password_length_enabled"] is True and r["password_min_length"] == 12
    assert r["idle_timeout_enabled"] is True and r["session_limit_enabled"] is True
    assert r["password_expiry_enabled"] is False and r["mfa_email_enabled"] is False
    assert "smtp_password" not in r and r["smtp_password_set"] is False


def test_smtp_password_is_stored_encrypted_and_never_returned(client_for):
    admin = client_for("admin")
    r = admin.patch(
        "/api/auth/settings/",
        {
            "email_enabled": True,
            "smtp_host": "smtp.office365.com",
            "smtp_user": "tmo@al-ayuni.example",
            "smtp_password": "S3cret!pass",
            "from_email": "Task Register <tmo@al-ayuni.example>",
        },
        format="json",
    )
    assert r.status_code == 200 and r.json()["smtp_password_set"] is True and r.json()["email_configured"] is True
    row = SecuritySettings.current()
    assert "S3cret" not in row.smtp_password_enc and policy.decrypt(row.smtp_password_enc) == "S3cret!pass"
    # An empty password keeps the stored one.
    admin.patch("/api/auth/settings/", {"smtp_port": 465, "smtp_security": "ssl", "smtp_password": ""}, format="json")
    assert policy.decrypt(SecuritySettings.current().smtp_password_enc) == "S3cret!pass"
    # Switched on without a server: refused.
    assert admin.patch("/api/auth/settings/", {"smtp_host": ""}, format="json").status_code == 400


def test_email_code_needs_outgoing_email(client_for, settings):
    settings.EMAIL_CONFIGURED = False
    admin = client_for("admin")
    assert admin.patch("/api/auth/settings/", {"mfa_email_enabled": True}, format="json").status_code == 400
    r = admin.patch(
        "/api/auth/settings/",
        {"email_enabled": True, "smtp_host": "smtp.example", "mfa_email_enabled": True},
        format="json",
    )
    assert r.status_code == 200 and r.json()["mfa_email_enabled"] is True
    # Email cannot be switched off while the code depends on it.
    assert admin.patch("/api/auth/settings/", {"email_enabled": False}, format="json").status_code == 400


def test_minimum_length_follows_the_switch(seeded):
    with pytest.raises(ValidationError):
        validate_password("Gold-27!x")  # 9 characters, under the default 12
    settings_row(password_min_length=8)
    validate_password("Gold-27!x")
    settings_row(password_min_length=16)
    with pytest.raises(ValidationError):
        validate_password("Desert-Gold-27!")
    settings_row(password_length_enabled=False)
    validate_password("Gold-27!x")


def test_idle_and_absolute_sign_out_follow_the_settings(seeded):
    c = signed_in()
    s = c.session
    s[LAST_SEEN] = int(time.time()) - 2 * 3600
    s.save()
    assert c.get("/api/auth/me/").status_code in (401, 403)  # 60 idle minutes by default

    settings_row(idle_timeout_enabled=False)
    c = signed_in()
    s = c.session
    s[LAST_SEEN] = int(time.time()) - 5 * 3600
    s.save()
    assert c.get("/api/auth/me/").status_code == 200

    settings_row(idle_timeout_enabled=False, session_limit_hours=24)
    s = c.session
    s[SESSION_STARTED] = int(time.time()) - 20 * 3600
    s.save()
    assert c.get("/api/auth/me/").status_code == 200  # 20 h < 24 h
    s = c.session
    s[SESSION_STARTED] = int(time.time()) - 25 * 3600
    s.save()
    assert c.get("/api/auth/me/").status_code in (401, 403)

    settings_row(idle_timeout_enabled=False, session_limit_enabled=False)
    c = signed_in()
    s = c.session
    s[SESSION_STARTED] = int(time.time()) - 6 * 24 * 3600
    s.save()
    assert c.get("/api/auth/me/").status_code == 200


def test_expired_password_must_be_changed_before_anything_else(seeded):
    settings_row(password_expiry_enabled=True, password_expiry_days=60)
    user = User.objects.get(username="ict.team")
    AccountSecurity.objects.update_or_create(
        user=user, defaults={"password_changed_at": timezone.now() - timedelta(days=61)}
    )
    c = signed_in()
    me = c.get("/api/auth/me/").json()
    assert me["password"]["required"] is True and me["password"]["reason"] == "expired"
    r = c.get("/api/tasks/")
    assert r.status_code == 403 and r.json()["code"] == "password_change_required"
    # Not the same password again.
    assert c.post("/api/auth/password/", {"current_password": PASSWORD, "new_password": PASSWORD}).status_code == 400
    assert (
        c.post("/api/auth/password/", {"current_password": PASSWORD, "new_password": "Brand-New-Pass-2027"}).status_code
        == 204
    )
    assert c.get("/api/tasks/").status_code == 200
    assert c.get("/api/auth/me/").json()["password"]["expires_in_days"] >= 59


def test_expiry_off_never_asks(seeded):
    user = User.objects.get(username="ict.team")
    AccountSecurity.objects.update_or_create(
        user=user, defaults={"password_changed_at": timezone.now() - timedelta(days=400)}
    )
    assert signed_in().get("/api/tasks/").status_code == 200


# ---- User access ----------------------------------------------------------------------------------


def test_create_a_user_with_roles_and_a_temporary_password(client_for):
    admin = client_for("admin")
    hr = WorkGroup.objects.get(code="HR")
    r = admin.post(
        "/api/auth/users/",
        {
            "username": "new.person",
            "first_name": "New",
            "last_name": "Person",
            "email": "new.person@al-ayuni.example",
            "fixed_roles": ["Global Viewer"],
            "group_roles": [{"work_group": hr.id, "type": "coordinator"}],
        },
        format="json",
    )
    assert r.status_code == 201, r.json()
    body = r.json()
    assert body["temporary_password"] and "Global Viewer" in body["fixed_roles"]
    assert body["group_roles"][0]["code"] == "HR" and body["group_roles"][0]["type"] == "coordinator"
    assert GroupMember.objects.filter(
        work_group=hr, user__username="new.person", email="new.person@al-ayuni.example"
    ).exists()
    c = APIClient()
    assert (
        c.post("/api/auth/login/", {"username": "new.person", "password": body["temporary_password"]}).status_code
        == 200
    )
    assert c.get("/api/auth/me/").json()["password"]["reason"] == "reset"
    assert c.get("/api/tasks/").status_code == 403
    me = c.get("/api/auth/me/").json()
    assert "HR Team Focal Point" in me["roles"]


def test_change_and_remove_group_roles_keep_the_member_list_in_step(client_for):
    admin = client_for("admin")
    u = User.objects.get(username="hr.member")
    hr = WorkGroup.objects.get(code="HR")
    r = admin.patch(
        f"/api/auth/users/{u.id}/", {"group_roles": [{"work_group": hr.id, "type": "coordinator"}]}, format="json"
    )
    assert r.status_code == 200 and u.groups.filter(name="HR Team Focal Point").exists()
    assert not u.groups.filter(name="HR Team Member").exists()
    admin.patch(f"/api/auth/users/{u.id}/", {"group_roles": [{"work_group": hr.id, "type": None}]}, format="json")
    assert not u.groups.filter(name__startswith="HR Team").exists()
    assert not GroupMember.objects.filter(user=u, work_group=hr).exists()


def test_guard_rails(client_for):
    admin = client_for("admin")
    me = User.objects.get(username="admin")
    assert admin.patch(f"/api/auth/users/{me.id}/", {"is_active": False}, format="json").status_code == 400
    assert admin.patch(f"/api/auth/users/{me.id}/", {"fixed_roles": []}, format="json").status_code == 400
    assert client_for("tmo.officer").get("/api/auth/users/").status_code == 403
    other = User.objects.get(username="ict.team")
    assert (
        admin.patch(f"/api/auth/users/{other.id}/", {"email": "admin@example.com"}, format="json").status_code == 400
    )  # taken


def test_reset_password_and_unlock(client_for):
    admin = client_for("admin")
    u = User.objects.get(username="fin.team")
    for _ in range(6):
        APIClient().post("/api/auth/login/", {"username": "fin.team", "password": "wrong-password"})
    assert APIClient().post("/api/auth/login/", {"username": "fin.team", "password": PASSWORD}).status_code == 429
    admin.post(f"/api/auth/users/{u.id}/unlock/")
    assert APIClient().post("/api/auth/login/", {"username": "fin.team", "password": PASSWORD}).status_code == 200
    temp = admin.post(f"/api/auth/users/{u.id}/reset-password/").json()["temporary_password"]
    c = APIClient()
    assert c.post("/api/auth/login/", {"username": "fin.team", "password": temp}).status_code == 200
    assert c.get("/api/auth/me/").json()["password"]["required"] is True
