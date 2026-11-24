from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import AuditLogViewSet, ClientErrorView, SystemEventViewSet

router = DefaultRouter()
router.register("audit", AuditLogViewSet, basename="audit")
router.register("system-events", SystemEventViewSet, basename="system-event")
urlpatterns = [path("client-errors/", ClientErrorView.as_view(), name="client-errors"), *router.urls]
