"""OWASP Top 10 controls: lockout, sessions, headers, logging, API docs and the Excel export."""

import logging
import time
from io import BytesIO

import pytest
from django.conf import settings
from django.core.cache import cache
from openpyxl import load_workbook
from rest_framework.test import APIClient

from apps.accounts.signals import SESSION_STARTED
from apps.register.models import Task

from .conftest import PASSWORD


@pytest.fixture
def seclog(caplog):
    """The security logger does not propagate to the root logger, so the capture handler is attached to it."""
    logger = logging.getLogger("security")
    logger.addHandler(caplog.handler)
    caplog.set_level(logging.INFO, logger="security")
    yield caplog
    logger.removeHandler(caplog.handler)


def login(client, username, password):
    return client.post("/api/auth/login/", {"username": username, "password": password})


def test_lockout_after_repeated_failures(seeded):
    cache.clear()
    c = APIClient()
    for _ in range(settings.LOGIN_LOCKOUT_ATTEMPTS):
        assert login(c, "ict.team", "wrong-password").status_code == 400
    # Locked: even the right password is refused, with a message that names no account.
    r = login(c, "ict.team", PASSWORD)
    assert r.status_code == 429 and r.data["code"] == "locked"
    # The same rule for a user name that does not exist: nothing reveals which accounts exist.
    for _ in range(settings.LOGIN_LOCKOUT_ATTEMPTS):
        login(c, "nobody.here", "wrong-password")
    assert login(c, "nobody.here", "x").status_code == 429
    # Another user is not affected.
    assert login(c, "hr.team", PASSWORD).status_code == 200
    cache.clear()
    assert login(APIClient(), "ict.team", PASSWORD).status_code == 200


def test_lockout_also_guards_the_admin_sign_in(seeded):
    cache.clear()
    from django.contrib.auth import authenticate
    from django.test import RequestFactory

    request = RequestFactory().post("/admin/login/")
    for _ in range(settings.LOGIN_LOCKOUT_ATTEMPTS):
        assert authenticate(request, username="admin", password="wrong") is None
    assert authenticate(request, username="admin", password=PASSWORD) is None
    cache.clear()
    assert authenticate(request, username="admin", password=PASSWORD) is not None


def test_success_resets_the_counter(seeded):
    cache.clear()
    c = APIClient()
    for _ in range(settings.LOGIN_LOCKOUT_ATTEMPTS - 1):
        login(c, "ict.team", "wrong-password")
    assert login(c, "ict.team", PASSWORD).status_code == 200
    c2 = APIClient()
    for _ in range(settings.LOGIN_LOCKOUT_ATTEMPTS - 1):
        login(c2, "ict.team", "wrong-password")
    assert login(c2, "ict.team", PASSWORD).status_code == 200


def test_security_events_are_logged_without_secrets(seeded, seclog):
    cache.clear()
    login(APIClient(), "ict.team\nevent=forged", "S3cret-wrong")
    login(APIClient(), "ict.team", PASSWORD)
    text = seclog.text
    assert "event=login_failed" in text and "event=login " in text + " "
    assert "S3cret-wrong" not in text and PASSWORD not in text
    # A crafted user name cannot start a new log line or add its own fields.
    assert "\nevent=forged" not in text


def test_refused_actions_are_logged(client_for, seclog):
    client_for("ict.team").get("/api/backup/export/")
    assert "event=permission_denied" in seclog.text and "user=ict.team" in seclog.text


def test_absolute_session_lifetime(client_for):
    c = APIClient()
    assert login(c, "ict.team", PASSWORD).status_code == 200
    assert c.get("/api/auth/me/").status_code == 200
    session = c.session
    session[SESSION_STARTED] = int(time.time()) - settings.SESSION_ABSOLUTE_HOURS * 3600 - 5
    session.save()
    r = c.get("/api/auth/me/")
    assert r.status_code == 403 and r.json()["code"] == "not_authenticated"


def test_session_cookie_settings():
    assert settings.SESSION_COOKIE_HTTPONLY and settings.SESSION_SAVE_EVERY_REQUEST
    # The sign-out rules are on the System settings page; the cookie only caps a session at 8 days.
    assert settings.SESSION_COOKIE_AGE == 8 * 24 * 3600 and settings.SESSION_EXPIRE_AT_BROWSER_CLOSE
    if settings.SESSION_COOKIE_SECURE:
        assert settings.SESSION_COOKIE_NAME.startswith("__Host-") and settings.CSRF_COOKIE_NAME.startswith("__Host-")


def test_api_headers(client_for):
    r = client_for("ict.team").get("/api/tasks/")
    assert r["Cache-Control"] == "no-store"
    assert r["Content-Security-Policy"].startswith("default-src 'none'")
    assert "camera=()" in r["Permissions-Policy"]
    assert r["X-Content-Type-Options"] == "nosniff" and r["X-Frame-Options"] == "DENY"
    assert r["Cross-Origin-Resource-Policy"] == "same-origin"


def test_api_docs_for_administrators_only(client_for):
    assert client_for("ict.team").get("/api/schema/").status_code == 403
    assert client_for("tmo.officer").get("/api/schema/").status_code == 403
    assert client_for("admin").get("/api/schema/").status_code == 200


def test_excel_export_never_writes_formulas(client_for):
    t = Task.objects.get(code="ICT-T030")
    Task.objects.filter(pk=t.pk).update(title='=HYPERLINK("http://evil.example","Click")')
    r = client_for("admin").get("/api/backup/export-excel/")
    wb = load_workbook(BytesIO(r.content))
    cells = [c for ws in wb.worksheets for row in ws.iter_rows() for c in row if isinstance(c.value, str)]
    hits = [c for c in cells if c.value.startswith("=HYPERLINK")]
    assert hits and all(c.data_type == "s" for c in hits)


def test_restore_accepts_json_files_only(client_for):
    from django.core.files.uploadedfile import SimpleUploadedFile

    bad = SimpleUploadedFile("backup.html", b"<script>alert(1)</script>", content_type="text/html")
    r = client_for("admin").post("/api/backup/restore/", {"file": bad}, format="multipart")
    assert r.status_code == 400 and ".json" in r.json()["detail"]


def test_password_policy(db):
    from django.contrib.auth.password_validation import validate_password
    from django.core.exceptions import ValidationError

    for weak in ("short1!", "password1234", "123456789012"):
        try:
            validate_password(weak)
        except ValidationError:
            continue
        raise AssertionError(f"{weak} was accepted")
    validate_password("Desert-Gold-2027!")
