from django.conf import settings
from rest_framework.test import APIClient

from .conftest import PASSWORD


def test_api_requires_sign_in(seeded):
    assert APIClient().get("/api/tasks/").status_code == 403


def test_login_with_csrf_and_me(seeded):
    client = APIClient(enforce_csrf_checks=True)
    # Without the CSRF token the login is refused.
    assert client.post("/api/auth/login/", {"username": "ict.team", "password": PASSWORD}).status_code == 403
    client.get("/api/auth/csrf/")
    token = client.cookies[settings.CSRF_COOKIE_NAME].value
    r = client.post("/api/auth/login/", {"username": "ict.team", "password": PASSWORD}, HTTP_X_CSRFTOKEN=token)
    assert r.status_code == 200
    assert r.data["roles"] == ["ICT Team Coordinator"]
    assert [g["code"] for g in r.data["work_groups"]] == ["ICT"]
    assert client.get("/api/auth/me/").data["username"] == "ict.team"


def test_wrong_password_gives_generic_message(seeded):
    client = APIClient()
    a = client.post("/api/auth/login/", {"username": "ict.team", "password": "wrong"})
    b = client.post("/api/auth/login/", {"username": "nobody", "password": "wrong"})
    assert a.status_code == b.status_code == 400
    assert a.data == b.data


def test_health_endpoint(db):
    assert APIClient().get("/healthz").json() == {"status": "ok"}
