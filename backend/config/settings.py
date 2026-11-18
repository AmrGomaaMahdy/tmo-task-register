"""
Django settings for the Task Register.

Every environment-specific or secret value comes from environment variables
(see the repository's .env.example). Defaults are safe for production:
DEBUG is off and secure cookies are on unless explicitly relaxed.

Security notes reference the OWASP Top 10 (2021) category each setting addresses; SECURITY.md
lists every control.
"""

import os
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
    DJANGO_ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
    DJANGO_CSRF_TRUSTED_ORIGINS=(list, []),
    DJANGO_SECURE_COOKIES=(bool, True),
    DJANGO_SECURE_SSL_REDIRECT=(bool, False),
    DJANGO_HSTS_SECONDS=(int, 0),
    DJANGO_HSTS_PRELOAD=(bool, False),
    DJANGO_NUM_PROXIES=(int, 0),
    LOGIN_LOCKOUT_ATTEMPTS=(int, 5),
    LOGIN_LOCKOUT_MINUTES=(int, 15),
    SESSION_IDLE_MINUTES=(int, 60),
    SESSION_ABSOLUTE_HOURS=(int, 10),
    API_DOCS_ENABLED=(bool, True),
    SYSTEM_EVENT_RETENTION_DAYS=(int, 90),
    DJANGO_LOG_LEVEL=(str, "INFO"),
    OIDC_ENABLED=(bool, False),
)

DEBUG = env("DJANGO_DEBUG")
SECRET_KEY = env("DJANGO_SECRET_KEY", default="insecure-dev-key-only" if DEBUG else None)
if not SECRET_KEY:
    raise RuntimeError("DJANGO_SECRET_KEY must be set when DEBUG is off.")

ALLOWED_HOSTS = env("DJANGO_ALLOWED_HOSTS")
# Render gives each web service its public host name at run time (e.g. task-register-api.onrender.com).
if render_host := env("RENDER_EXTERNAL_HOSTNAME", default=""):
    ALLOWED_HOSTS.append(render_host)
CSRF_TRUSTED_ORIGINS = env("DJANGO_CSRF_TRUSTED_ORIGINS")

APP_VERSION = "1.18.0"

# Every planned date in the register (tasks, activities, proposed dates) must fall in this range.
REGISTER_DATE_MIN = env.str("REGISTER_DATE_MIN", default="2024-01-01")
REGISTER_DATE_MAX = env.str("REGISTER_DATE_MAX", default="2035-12-31")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "django_filters",
    "drf_spectacular",
    "apps.core",
    "apps.accounts",
    "apps.masterdata",
    "apps.register",
    "apps.backup",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "apps.core.middleware.SecurityHeadersMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "apps.core.audit.RequestContextMiddleware",
    "apps.core.middleware.SessionLifetimeMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# --- Database -------------------------------------------------------------
# Either DATABASE_URL, or the separate DB_* variables (used by Docker Compose). The separate variables
# take the password exactly as written, so special characters (@ : / # % ?) need no URL-encoding.
if env("DATABASE_URL", default=""):
    DATABASES = {"default": env.db("DATABASE_URL")}
elif env("DB_HOST", default=""):
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "HOST": env("DB_HOST"),
            "PORT": env("DB_PORT", default="5432"),
            "NAME": env("DB_NAME", default="task_register"),
            "USER": env("DB_USER", default="task_register"),
            # Read directly: django-environ would treat a password starting with "$" as a variable reference.
            "PASSWORD": os.environ.get("DB_PASSWORD", ""),
            "OPTIONS": {"sslmode": env("DB_SSLMODE", default="prefer")},
        }
    }
else:
    DATABASES = {"default": env.db("DATABASE_URL", default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}")}
DATABASES["default"]["CONN_MAX_AGE"] = env.int("DB_CONN_MAX_AGE", default=60)
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Passwords (OWASP A02 / A07) ------------------------------------------
# Argon2id, a memory-hard hash; PBKDF2 stays only to read older hashes, which are upgraded at next sign-in.
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 12}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# The model backend with account lockout (apps/accounts/lockout.py): it also guards the Django admin sign-in.
AUTHENTICATION_BACKENDS = ["apps.accounts.backends.LockoutModelBackend"]
LOGIN_LOCKOUT_ATTEMPTS = env("LOGIN_LOCKOUT_ATTEMPTS")
LOGIN_LOCKOUT_MINUTES = env("LOGIN_LOCKOUT_MINUTES")

# --- Optional sign-in with Microsoft Entra ID (OpenID Connect) -----------
OIDC_ENABLED = env("OIDC_ENABLED")
if OIDC_ENABLED:
    INSTALLED_APPS.append("mozilla_django_oidc")
    AUTHENTICATION_BACKENDS.insert(0, "apps.accounts.oidc.EntraIDBackend")
    _tenant = env("OIDC_TENANT_ID")
    OIDC_RP_CLIENT_ID = env("OIDC_CLIENT_ID")
    OIDC_RP_CLIENT_SECRET = env("OIDC_CLIENT_SECRET")
    OIDC_RP_SIGN_ALGO = "RS256"
    OIDC_RP_SCOPES = "openid email profile"
    _base = f"https://login.microsoftonline.com/{_tenant}"
    OIDC_OP_AUTHORIZATION_ENDPOINT = f"{_base}/oauth2/v2.0/authorize"
    OIDC_OP_TOKEN_ENDPOINT = f"{_base}/oauth2/v2.0/token"
    OIDC_OP_USER_ENDPOINT = "https://graph.microsoft.com/oidc/userinfo"
    OIDC_OP_JWKS_ENDPOINT = f"{_base}/discovery/v2.0/keys"
    LOGIN_REDIRECT_URL = "/"
    LOGOUT_REDIRECT_URL = "/login"

# --- Internationalisation -------------------------------------------------
LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Riyadh"
USE_I18N = True
USE_TZ = True

# --- Static files (Django admin only; the React app is served by Nginx) ---
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

# --- Security (OWASP A02 Cryptographic Failures, A05 Misconfiguration, A07 Authentication) ---
_secure = env("DJANGO_SECURE_COOKIES")
SESSION_COOKIE_SECURE = _secure
CSRF_COOKIE_SECURE = _secure
# On HTTPS the cookies get the "__Host-" prefix: browsers then accept them only when Secure, for the
# whole site and with no Domain, so a neighbouring sub-domain cannot set or overwrite them.
SESSION_COOKIE_NAME = "__Host-sessionid" if _secure else "sessionid"
CSRF_COOKIE_NAME = "__Host-csrftoken" if _secure else "csrftoken"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = False  # the React app reads it to send the X-CSRFToken header
# A session ends after SESSION_IDLE_MINUTES without activity (the cookie age is renewed on every request)
# and at the latest SESSION_ABSOLUTE_HOURS after sign-in (apps/core/middleware.py), or when the browser closes.
SESSION_IDLE_MINUTES = env("SESSION_IDLE_MINUTES")
SESSION_ABSOLUTE_HOURS = env("SESSION_ABSOLUTE_HOURS")
SESSION_COOKIE_AGE = SESSION_IDLE_MINUTES * 60
SESSION_SAVE_EVERY_REQUEST = True
SESSION_EXPIRE_AT_BROWSER_CLOSE = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env("DJANGO_SECURE_SSL_REDIRECT")
SECURE_HSTS_SECONDS = env("DJANGO_HSTS_SECONDS")
SECURE_HSTS_INCLUDE_SUBDOMAINS = SECURE_HSTS_SECONDS > 0
SECURE_HSTS_PRELOAD = env("DJANGO_HSTS_PRELOAD") and SECURE_HSTS_SECONDS >= 31536000
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
# Request size limits (OWASP A04): ordinary requests up to 2 MB; only the restore upload is larger.
DATA_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024
DATA_UPLOAD_MAX_NUMBER_FIELDS = 2000
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024  # larger backup uploads go to a temporary file

# --- REST framework -------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.StandardPagination",
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
        "rest_framework.throttling.ScopedRateThrottle",
    ],
    # Rate limits (OWASP A04 / A07). Behind a reverse proxy set DJANGO_NUM_PROXIES (1 for the Docker
    # nginx) so limits count each client, not the proxy's single address.
    "DEFAULT_THROTTLE_RATES": {"anon": "60/min", "user": "1200/min", "login": "10/min", "client_errors": "30/hour"},
    "NUM_PROXIES": env("DJANGO_NUM_PROXIES") or None,
    "EXCEPTION_HANDLER": "apps.core.exceptions.api_exception_handler",
}
SPECTACULAR_SETTINGS = {
    "TITLE": "Task Register API",
    "DESCRIPTION": "API of the Al-Ayuni TMO Task Register.",
    "VERSION": APP_VERSION,
    # The API description lists every endpoint and field: only Administrators may read it (OWASP A01).
    "SERVE_PERMISSIONS": ["apps.core.permissions.IsAdministrator"],
}

# --- Caching (rate limits and sign-in lockout) ----------------------------
# A table in the database (created by migration core 0003), so every server worker shares the same
# counts; a per-process memory cache would let each worker grant its own attempts.
CACHES = {"default": {"BACKEND": "django.core.cache.backends.db.DatabaseCache", "LOCATION": "app_cache"}}
API_DOCS_ENABLED = env("API_DOCS_ENABLED")

# --- Logging --------------------------------------------------------------
# Everything goes to the console (the platform's log). In addition, server errors and security warnings
# are stored for the administrators' System issues page (apps/core/events.py), kept for
# SYSTEM_EVENT_RETENTION_DAYS days.
SYSTEM_EVENT_RETENTION_DAYS = env("SYSTEM_EVENT_RETENTION_DAYS")
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"plain": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"}},
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "plain"},
        "events_errors": {"class": "apps.core.events.DatabaseEventHandler", "level": "ERROR"},
        "events_security": {"class": "apps.core.events.DatabaseEventHandler", "level": "WARNING"},
    },
    "root": {"handlers": ["console", "events_errors"], "level": env("DJANGO_LOG_LEVEL")},
    "loggers": {
        "django.security": {"handlers": ["console", "events_security"], "level": "WARNING", "propagate": False},
        # Sign-ins, failed sign-ins, lockouts, refused requests, backups (apps/core/security.py, OWASP A09).
        "security": {"handlers": ["console", "events_security"], "level": "INFO", "propagate": False},
    },
}
