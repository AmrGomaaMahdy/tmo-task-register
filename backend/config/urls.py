"""Root URL configuration."""

from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.core.views import health

admin.site.site_header = "Task Register administration"
admin.site.site_title = "Task Register"

# Under /api/ errors are JSON, never HTML pages (see apps/core/errors.py).
handler400 = "apps.core.errors.bad_request"
handler403 = "apps.core.errors.permission_denied"
handler404 = "apps.core.errors.page_not_found"
handler500 = "apps.core.errors.server_error"

urlpatterns = [
    path("healthz", health, name="health"),
    path("admin/", admin.site.urls),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/", include("apps.masterdata.urls")),
    path("api/", include("apps.register.urls")),
    path("api/", include("apps.core.urls")),
    path("api/", include("apps.backup.urls")),
]

# The OpenAPI description and its browsable page: Administrators only (SPECTACULAR_SETTINGS), and they can
# be switched off completely with API_DOCS_ENABLED=false.
if settings.API_DOCS_ENABLED:
    urlpatterns += [
        path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
        path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="api-docs"),
    ]

if settings.OIDC_ENABLED:
    urlpatterns.append(path("oidc/", include("mozilla_django_oidc.urls")))
