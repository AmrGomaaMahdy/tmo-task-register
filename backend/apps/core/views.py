import csv
import io
from datetime import timedelta

from django.db import connection
from django.db.models import Q
from django.http import HttpResponse, JsonResponse
from django.utils import timezone
from django.views.decorators.http import require_GET
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.roles import can_view_audit, view_group_ids
from apps.backup.excel import FORMULA_START
from apps.masterdata.models import WorkGroup

from . import events
from .filters import AuditLogFilter, SystemEventFilter
from .models import AuditLog, SystemEvent
from .permissions import IsAdministrator
from .serializers import AuditLogSerializer, ClientErrorSerializer, ResolveSerializer, SystemEventSerializer


@require_GET
def health(request):
    """Liveness and database check used by Docker and load balancers."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
    except Exception:  # pragma: no cover - reported as unhealthy
        return JsonResponse({"status": "error"}, status=503)
    return JsonResponse({"status": "ok"})


class AuditLogViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """
    The audit trail. Administrators, the TMO and the committee see every entry; anyone else sees only
    what they did themselves. Filters: actor, action, entity, entity_id, work_group, date_from, date_to, q.
    """

    serializer_class = AuditLogSerializer
    filterset_class = AuditLogFilter
    ordering_fields = ["created_at", "action", "entity", "actor_name"]
    queryset = AuditLog.objects.none()  # lets the OpenAPI generator find the model

    def get_queryset(self):
        qs = AuditLog.objects.select_related("actor")
        if getattr(self, "swagger_fake_view", False):
            return qs.none()
        user = self.request.user
        if can_view_audit(user):
            return qs
        # Others see what they did, and what happened to their own work groups' tasks (for example a
        # leader of another group removing a link from one of them).
        codes = list(WorkGroup.objects.filter(id__in=view_group_ids(user)).values_list("code", flat=True))
        return qs.filter(Q(actor=user) | Q(work_group__in=codes))

    @extend_schema(responses={200: dict})
    @action(detail=False, methods=["get"])
    def facets(self, request):
        """The values the filters offer: people, actions, record types and work groups in the trail."""
        qs = self.get_queryset()
        actors = qs.exclude(actor_name="").values_list("actor_name", flat=True).distinct().order_by("actor_name")
        return Response(
            {
                "actors": list(actors[:500]),
                "actions": [{"value": v, "label": label} for v, label in AuditLog.Action.choices],
                "entities": sorted(set(qs.values_list("entity", flat=True).distinct())),
                "work_groups": sorted(set(qs.exclude(work_group="").values_list("work_group", flat=True).distinct())),
            }
        )

    @extend_schema(responses={(200, "text/csv"): bytes})
    @action(detail=False, methods=["get"])
    def export(self, request):
        """The filtered trail as a CSV file (up to 20,000 entries), for reports and investigations."""
        rows = self.filter_queryset(self.get_queryset())[:20000]
        buf = io.StringIO()
        out = csv.writer(buf)
        out.writerow(
            [
                "Time",
                "User",
                "Action",
                "Record type",
                "Record",
                "Work group",
                "Summary",
                "Changes",
                "Address",
                "Request",
                "Browser",
            ]
        )

        def cell(value) -> str:
            # OWASP A03: a cell starting with = + - @ would run as a formula when the file opens in Excel.
            text = "" if value is None else str(value)
            return "'" + text if text.startswith(FORMULA_START) else text

        for e in rows:
            changes = "; ".join(
                f"{k}: {v[0] if v[0] is not None else '—'} → {v[1] if v[1] is not None else '—'}"
                for k, v in (e.changes or {}).items()
            )
            out.writerow(
                [
                    cell(x)
                    for x in (
                        timezone.localtime(e.created_at).strftime("%Y-%m-%d %H:%M:%S"),
                        e.actor_name or "System",
                        e.get_action_display(),
                        e.entity,
                        e.entity_label,
                        e.work_group,
                        e.summary,
                        changes,
                        e.ip,
                        f"{e.method} {e.path}".strip(),
                        e.user_agent,
                    )
                ]
            )
        response = HttpResponse("\ufeff" + buf.getvalue(), content_type="text/csv; charset=utf-8")
        stamp = timezone.localtime().strftime("%Y%m%d-%H%M")
        response["Content-Disposition"] = f'attachment; filename="audit-trail-{stamp}.csv"'
        return response


class SystemEventViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Errors and warnings for the administrators (the System issues page)."""

    serializer_class = SystemEventSerializer
    permission_classes = [IsAdministrator]
    filterset_class = SystemEventFilter
    ordering_fields = ["last_seen", "count", "level"]
    queryset = SystemEvent.objects.select_related("resolved_by")

    @extend_schema(responses={200: dict})
    @action(detail=False, methods=["get"])
    def summary(self, request):
        day = timezone.now() - timedelta(hours=24)
        qs = SystemEvent.objects
        return Response(
            {
                "open_errors": qs.filter(level="error", resolved=False).count(),
                "open_warnings": qs.filter(level="warning", resolved=False).count(),
                "errors_24h": sum(qs.filter(level="error", last_seen__gte=day).values_list("count", flat=True)),
                "failed_signins_24h": sum(
                    qs.filter(kind="login_failed", last_seen__gte=day).values_list("count", flat=True)
                ),
                "browser_open": qs.filter(source="browser", resolved=False).count(),
                "retention_days": events.settings.SYSTEM_EVENT_RETENTION_DAYS,
            }
        )

    @extend_schema(request=ResolveSerializer, responses={200: SystemEventSerializer})
    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        event = self.get_object()
        s = ResolveSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        event.resolved, event.resolved_by, event.resolved_at = True, request.user, timezone.now()
        event.resolution_note = s.validated_data["note"]
        event.save(update_fields=["resolved", "resolved_by", "resolved_at", "resolution_note"])
        return Response(self.get_serializer(event).data)

    @extend_schema(request=None, responses={200: SystemEventSerializer})
    @action(detail=True, methods=["post"])
    def reopen(self, request, pk=None):
        event = self.get_object()
        event.resolved, event.resolved_by, event.resolved_at = False, None, None
        event.save(update_fields=["resolved", "resolved_by", "resolved_at"])
        return Response(self.get_serializer(event).data)

    @extend_schema(request=ResolveSerializer, responses={200: dict})
    @action(detail=False, methods=["post"], url_path="resolve-all")
    def resolve_all(self, request):
        """Resolve every open event that matches the current filters (e.g. all failed sign-ins)."""
        s = ResolveSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        qs = self.filter_queryset(self.get_queryset()).filter(resolved=False)
        n = qs.update(
            resolved=True,
            resolved_by=request.user,
            resolved_at=timezone.now(),
            resolution_note=s.validated_data["note"],
        )
        return Response({"resolved": n})


class ClientErrorView(APIView):
    """
    The web app reports an error that happened in a user's browser (a page that failed to draw, a
    script error). Signed-in users only, at most 30 an hour each; the text is stored, never run.
    """

    permission_classes = [permissions.IsAuthenticated]
    throttle_scope = "client_errors"

    @extend_schema(request=ClientErrorSerializer, responses={204: None})
    def post(self, request):
        s = ClientErrorSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        detail = "\n".join(x for x in (f"Where: {d['where']}" if d["where"] else "", d["stack"]) if x)
        events.store(
            level="error",
            source="browser",
            kind="browser_error",
            message=d["message"],
            detail=detail,
            request=request,
            path=d["url"] or request.path,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
