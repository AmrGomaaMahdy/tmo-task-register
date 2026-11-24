"""Under /api/ every error is JSON, so the web app can show the reason (no "Unexpected token '<'")."""

from django.test import Client

from .conftest import PASSWORD


def test_refused_csrf_check_is_json_with_the_reason(seeded):
    c = Client(enforce_csrf_checks=True)
    r = c.post("/api/auth/login/", {"username": "admin", "password": PASSWORD}, content_type="application/json")
    assert r.status_code == 403 and r["Content-Type"].startswith("application/json")
    assert r.json()["code"] == "csrf_failed" and "CSRF cookie not set" in r.json()["detail"]


def test_untrusted_origin_names_the_setting(seeded, settings):
    settings.CSRF_TRUSTED_ORIGINS = ["https://task-register.onrender.com"]
    c = Client(enforce_csrf_checks=True)

    r0 = c.get("/api/auth/csrf/")
    assert r0.status_code == 200, r0.content
    token = c.cookies[settings.CSRF_COOKIE_NAME].value
    r = c.post(
        "/api/auth/login/",
        {"username": "admin", "password": PASSWORD},
        content_type="application/json",
        HTTP_X_CSRFTOKEN=token,
        HTTP_ORIGIN="https://task-register-elty.onrender.com",
    )
    assert r.status_code == 403 and "DJANGO_CSRF_TRUSTED_ORIGINS" in r.json()["detail"]
    settings.CSRF_TRUSTED_ORIGINS = ["https://task-register-elty.onrender.com"]
    ok = c.post(
        "/api/auth/login/",
        {"username": "admin", "password": PASSWORD},
        content_type="application/json",
        HTTP_X_CSRFTOKEN=token,
        HTTP_ORIGIN="https://task-register-elty.onrender.com",
    )
    assert ok.status_code == 200, ok.content


def test_host_not_allowed_is_json(db, settings):
    settings.ALLOWED_HOSTS = ["task-register-api.onrender.com"]
    settings.DEBUG = False
    r = Client().get("/api/auth/csrf/", HTTP_HOST="task-register-elty.onrender.com")
    assert r.status_code == 400 and "DJANGO_ALLOWED_HOSTS" in r.json()["detail"]


def test_unknown_api_address_is_json_but_pages_stay_html(db, settings):
    settings.DEBUG = False
    r = Client().get("/api/no-such-thing/")
    assert r.status_code == 404 and r.json()["code"] == "not_found"
    assert not Client().get("/no-such-page/")["Content-Type"].startswith("application/json")
