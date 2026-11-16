"""
Django settings for the Task Register.

Every environment-specific or secret value comes from environment variables
(see the repository's .env.example). Defaults are safe for production:
DEBUG is off and secure cookies are on unless explicitly relaxed.
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

APP_VERSION = "1.10.0"

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
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
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

# --- Passwords ------------------------------------------------------------
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

AUTHENTICATION_BACKENDS = ["django.contrib.auth.backends.ModelBackend"]

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

# --- Security -------------------------------------------------------------
_secure = env("DJANGO_SECURE_COOKIES")
SESSION_COOKIE_SECURE = _secure
CSRF_COOKIE_SECURE = _secure
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = False  # the React app reads it to send the X-CSRFToken header
SESSION_COOKIE_AGE = 8 * 60 * 60  # 8 hours
SESSION_EXPIRE_AT_BROWSER_CLOSE = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_SSL_REDIRECT = env("DJANGO_SECURE_SSL_REDIRECT")
SECURE_HSTS_SECONDS = env("DJANGO_HSTS_SECONDS")
SECURE_HSTS_INCLUDE_SUBDOMAINS = SECURE_HSTS_SECONDS > 0
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"
X_FRAME_OPTIONS = "DENY"
DATA_UPLOAD_MAX_MEMORY_SIZE = 2 * 1024 * 1024
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
    "DEFAULT_THROTTLE_RATES": {"anon": "60/min", "user": "1200/min", "login": "10/min"},
    "EXCEPTION_HANDLER": "apps.core.exceptions.api_exception_handler",
}
SPECTACULAR_SETTINGS = {
    "TITLE": "Task Register API",
    "DESCRIPTION": "API of the Al-Ayuni TMO Task Register.",
    "VERSION": APP_VERSION,
    "SERVE_PERMISSIONS": ["rest_framework.permissions.IsAuthenticated"],
}

# --- Caching (used by throttling) ----------------------------------------
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

# --- Logging --------------------------------------------------------------
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"plain": {"format": "%(asctime)s %(levelname)s %(name)s %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "plain"}},
    "root": {"handlers": ["console"], "level": env("DJANGO_LOG_LEVEL")},
    "loggers": {"django.security": {"handlers": ["console"], "level": "WARNING", "propagate": False}},
}
