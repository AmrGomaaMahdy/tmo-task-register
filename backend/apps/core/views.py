from django.db import connection
from django.http import JsonResponse
from django.views.decorators.http import require_GET
from rest_framework import mixins, viewsets

from apps.accounts.roles import can_view_audit

from .models import AuditLog
from .serializers import AuditLogSerializer


@require_GET
def health(request):
    """Liveness and database check used by Docker and load balancers."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except Exception:  # pragma: no cover - reported as unhealthy
        return JsonResponse({"status": "error"}, status=503)
    return JsonResponse({"status": "ok"})


class AuditLogViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    """Recent changes. Group roles see changes to their group's tasks; TMO and admins see all."""

    serializer_class = AuditLogSerializer
    filterset_fields = ["entity", "entity_id", "action"]

    queryset = AuditLog.objects.none()  # lets the OpenAPI generator find the model

    def get_queryset(self):
        qs = AuditLog.objects.select_related("actor")
        if getattr(self, "swagger_fake_view", False):
            return qs.none()
        if can_view_audit(self.request.user):
            return qs
        return qs.filter(actor=self.request.user)
