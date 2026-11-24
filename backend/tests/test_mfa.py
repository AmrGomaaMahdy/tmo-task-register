"""The email code at sign-in (Configuration → Security): off by default, then two steps."""

import re

import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from rest_framework.test import APIClient

from apps.accounts.models import SecuritySettings

from .conftest import PASSWORD


@pytest.fixture
def mfa_on(seeded, settings):
    settings.EMAIL_CONFIGURED = True
    SecuritySettings.objects.update_or_create(pk=1, defaults={"mfa_email_enabled": True})


def login(client, username="ict.team", password=PASSWORD):
    return client.post("/api/auth/login/", {"username": username, "password": password})


def code_from_outbox():
    return re.search(r"\b(\d{6})\b", mail.outbox[-1].body).group(1)


def test_off_by_default_signs_in_with_the_password_only(seeded):
    assert SecuritySettings.current().mfa_email_enabled is False
    r = login(APIClient())
    assert r.status_code == 200 and r.json()["username"] == "ict.team"
    assert mail.outbox == []


def test_with_the_code_on_the_password_alone_does_not_sign_in(mfa_on):
    c = APIClient()
    r = login(c)
    assert r.status_code == 200 and r.json()["mfa_required"] is True
    assert r.json()["email"].startswith("i") and "@example.com" in r.json()["email"]
    assert c.get("/api/auth/me/").status_code in (401, 403)
    assert len(mail.outbox) == 1 and "ict.team@example.com" in mail.outbox[0].to
    assert (
        c.post(
            "/api/auth/login/verify/", {"code": "000000" if code_from_outbox() != "000000" else "111111"}
        ).status_code
        == 400
    )
    r = c.post("/api/auth/login/verify/", {"code": code_from_outbox()})
    assert r.status_code == 200 and r.json()["username"] == "ict.team"
    assert c.get("/api/auth/me/").status_code == 200
    # The code works once.
    assert c.post("/api/auth/login/verify/", {"code": code_from_outbox()}).json()["code"] == "expired"


def test_five_wrong_codes_end_the_attempt(mfa_on):
    c = APIClient()
    login(c)
    right = code_from_outbox()
    wrong = "123456" if right != "123456" else "654321"
    results = [c.post("/api/auth/login/verify/", {"code": wrong}).json()["code"] for _ in range(5)]
    assert results[-1] == "too_many"
    assert c.post("/api/auth/login/verify/", {"code": right}).json()["code"] == "expired"


def test_resend_waits_then_sends_a_new_code(mfa_on, monkeypatch):
    c = APIClient()
    login(c)
    assert c.post("/api/auth/login/resend/").status_code == 429
    import apps.accounts.mfa as mfa

    monkeypatch.setattr(mfa, "RESEND_SECONDS", 0)
    assert c.post("/api/auth/login/resend/").status_code == 200
    assert len(mail.outbox) == 2
    assert c.post("/api/auth/login/verify/", {"code": code_from_outbox()}).status_code == 200


def test_an_account_without_email_is_told_why(mfa_on):
    get_user_model().objects.filter(username="ict.team").update(email="")
    r = login(APIClient())
    assert r.status_code == 400 and r.json()["code"] == "no_email"


def test_a_wrong_password_never_sends_a_code(mfa_on):
    assert login(APIClient(), password="wrong-password").status_code == 400
    assert mail.outbox == []


def test_only_administrators_switch_it_and_only_with_email_set_up(client_for, settings):
    assert (
        client_for("ict.team").patch("/api/auth/security/", {"mfa_email_enabled": True}, format="json").status_code
        == 403
    )
    admin = client_for("admin")
    settings.EMAIL_CONFIGURED = False
    r = admin.patch("/api/auth/security/", {"mfa_email_enabled": True}, format="json")
    assert r.status_code == 400 and SecuritySettings.current().mfa_email_enabled is False
    settings.EMAIL_CONFIGURED = True
    r = admin.patch("/api/auth/security/", {"mfa_email_enabled": True, "mfa_code_minutes": 5}, format="json")
    assert r.status_code == 200 and r.json()["mfa_email_enabled"] is True and r.json()["mfa_code_minutes"] == 5
    assert APIClient().get("/api/auth/csrf/").json()["mfa_email"] is True


def test_a_member_email_reaches_the_sign_in_account(seeded):
    from apps.masterdata.models import GroupMember

    m = GroupMember.objects.filter(user__username="rakan.alauni").first()
    m.email = "rakan@al-ayuni.example"
    m.save()
    assert get_user_model().objects.get(username="rakan.alauni").email == "rakan@al-ayuni.example"
