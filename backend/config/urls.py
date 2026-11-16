"""Root URL configuration."""

from django.conf import settings
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.core.views import health

admin.site.site_header = "Task Register administration"
admin.site.site_title = "Task Register"

urlpatterns = [
    path("healthz", health, name="health"),
    path("admin/", admin.site.urls),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/", include("apps.masterdata.urls")),
    path("api/", include("apps.register.urls")),
    path("api/", include("apps.core.urls")),
    path("api/", include("apps.backup.urls")),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="api-docs"),
]

if settings.OIDC_ENABLED:
    urlpatterns.append(path("oidc/", include("mozilla_django_oidc.urls")))
