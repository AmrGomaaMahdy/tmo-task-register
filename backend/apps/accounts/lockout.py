"""
Account lockout after repeated failed sign-ins (OWASP A07: Identification and Authentication Failures).

Two counters live in the shared cache (the database cache, so every server worker sees the same counts):

* per user name and client address: LOGIN_LOCKOUT_ATTEMPTS failures lock that pair, which stops
  password guessing from one place without letting a stranger lock a colleague out everywhere;
* per user name from anywhere: 4 × LOGIN_LOCKOUT_ATTEMPTS failures lock the user name, which stops
  guessing spread over many addresses.

A lock lasts LOGIN_LOCKOUT_MINUTES and also covers the Django admin sign-in, because the check sits
in the authentication backend. The same rule applies to user names that do not exist, so the lock
message reveals nothing about which accounts exist. A successful sign-in clears the counters.
"""

import hashlib

from django.conf import settings
from django.core.cache import cache

USER_FACTOR = 4


def _key(kind: str, *parts: str) -> str:
    # Hashed so user names of any length or character set make safe cache keys.
    digest = hashlib.sha256("|".join(p.lower() for p in parts).encode()).hexdigest()[:40]
    return f"lockout:{kind}:{digest}"


def _limits() -> tuple[int, int]:
    return settings.LOGIN_LOCKOUT_ATTEMPTS, settings.LOGIN_LOCKOUT_MINUTES * 60


def is_locked(username: str, ip: str) -> bool:
    attempts, _ = _limits()
    if not username:
        return False
    pair = cache.get(_key("pair", username, ip), 0)
    user = cache.get(_key("user", username), 0)
    return pair >= attempts or user >= attempts * USER_FACTOR


def register_failure(username: str, ip: str) -> bool:
    """Count one failed sign-in; returns True when this failure locks the account."""
    _, seconds = _limits()
    if not username:
        return False
    for key in (_key("pair", username, ip), _key("user", username)):
        # add() starts the window on the first failure; incr() keeps its expiry.
        if not cache.add(key, 1, seconds):
            try:
                cache.incr(key)
            except ValueError:  # expired between add() and incr()
                cache.set(key, 1, seconds)
    return is_locked(username, ip)


def reset(username: str, ip: str) -> None:
    cache.delete_many([_key("pair", username, ip), _key("user", username)])
