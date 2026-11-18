import pytest
from django.core.management import call_command
from rest_framework.test import APIClient

PASSWORD = "Test#Password2026"


@pytest.fixture(autouse=True)
def _fast_hashing(settings):
    settings.PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
    settings.REST_FRAMEWORK = {**settings.REST_FRAMEWORK, "DEFAULT_THROTTLE_CLASSES": []}


@pytest.fixture
def seeded(db, monkeypatch, _fast_hashing):
    monkeypatch.setenv("DEMO_USER_PASSWORD", PASSWORD)
    # The tests are written against the first part of the sample (the 20 prototype tasks);
    # tests/test_demo_sample.py loads the whole sample.
    call_command("seed_demo", "--core-only", verbosity=0)


@pytest.fixture
def client_for(seeded):
    from django.contrib.auth import get_user_model

    def make(username: str) -> APIClient:
        client = APIClient()
        client.force_authenticate(get_user_model().objects.get(username=username))
        return client

    return make
