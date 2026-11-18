"""Administrator-only backup endpoints: download a full backup, an Excel copy, and restore."""

import json

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import permissions, serializers, status
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.roles import is_admin
from apps.core import audit
from apps.core.security import log_event

from . import excel, services
from .models import RestorePoint

CONFIRM_PHRASE = "RESTORE"


class IsAdministrator(permissions.BasePermission):
    message = "Only administrators can back up or restore the application data."

    def has_permission(self, request, view):
        return is_admin(request.user)


def _attachment(content: bytes, content_type: str, filename: str) -> HttpResponse:
    response = HttpResponse(content, content_type=content_type)
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    response["Cache-Control"] = "no-store"
    return response


class ExportBackupView(APIView):
    """Download every record (users, roles, configuration, registers, links, audit log) as one JSON file."""

    permission_classes = [IsAdministrator]

    @extend_schema(responses={(200, "application/json"): bytes})
    def get(self, request):
        # Recorded first, so the backup includes the entry for its own download.
        audit.record(request.user, "export", "backup", summary="Downloaded a full backup")
        # A full backup holds every user's password hash: each download is a security event (OWASP A09).
        log_event("backup_export", request)
        doc = services.build_backup(request.user)
        return _attachment(
            json.dumps(doc, ensure_ascii=False, indent=1).encode(), "application/json", services.backup_filename()
        )


class ExportExcelView(APIView):
    """Download a readable Excel copy of the data (one sheet per table). Not used for restore."""

    permission_classes = [IsAdministrator]

    @extend_schema(responses={(200, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"): bytes})
    def get(self, request):
        log_event("excel_export", request)
        content = excel.build_workbook()
        audit.record(request.user, "export", "backup", summary="Downloaded the Excel export")
        return _attachment(
            content,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            services.backup_filename("task-register-export", "xlsx"),
        )


class RestoreSerializer(serializers.Serializer):
    file = serializers.FileField()
    dry_run = serializers.BooleanField(default=True)
    confirm = serializers.CharField(required=False, allow_blank=True, default="")


class RestoreBackupView(APIView):
    """Check a backup file (dry_run=true, the default) or replace all data with it (dry_run=false + confirm)."""

    permission_classes = [IsAdministrator]
    parser_classes = [MultiPartParser]

    @extend_schema(request={"multipart/form-data": RestoreSerializer})
    def post(self, request):
        form = RestoreSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        upload = form.validated_data["file"]
        # OWASP A04 / A08: only a JSON file of bounded size is read; the content is parsed as data (no code),
        # its checksum and table list are verified, and nothing changes before an explicit confirmation.
        if not upload.name.lower().endswith(".json"):
            return Response({"detail": "Choose a backup file (.json)."}, status=status.HTTP_400_BAD_REQUEST)
        if upload.size > services.MAX_BACKUP_BYTES:
            return Response({"detail": "The file is larger than 50 MB."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            inspection = services.inspect_backup(upload.read())
        except services.BackupError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        if form.validated_data["dry_run"]:
            return Response({"restored": False, **inspection.summary})

        if form.validated_data["confirm"] != CONFIRM_PHRASE:
            return Response(
                {"detail": f"Type {CONFIRM_PHRASE} to confirm that all current data will be replaced."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        actor = request.user.username
        when = services.describe_time(inspection.summary["created_at"])
        point = services.create_restore_point(f"Before restoring the backup of {when}", request.user)
        services.restore_backup(inspection)
        log_event("backup_restore", request, records=sum(inspection.counts.values()))
        # The restoring user may not exist (or may differ) in the restored data, so the entry has no actor link.
        audit.record(
            None,
            "restore",
            "backup",
            summary=f"{actor} restored the backup of {services.describe_time(inspection.summary['created_at'])} "
            f"({sum(inspection.counts.values())} records)",
        )
        return Response({"restored": True, "restore_point": point.id, **inspection.summary})


def _point_row(p: RestorePoint) -> dict:
    return {
        "id": p.id,
        "created_at": p.created_at,
        "created_by": p.created_by,
        "reason": p.reason,
        "counts": p.counts,
    }


class RestorePointListView(APIView):
    """Restore points kept automatically before every restore (the last five)."""

    permission_classes = [IsAdministrator]

    @extend_schema(responses={200: dict})
    def get(self, request):
        return Response([_point_row(p) for p in RestorePoint.objects.defer("document")])


class RestorePointDownloadView(APIView):
    permission_classes = [IsAdministrator]

    @extend_schema(responses={(200, "application/json"): bytes})
    def get(self, request, pk: int):
        point = get_object_or_404(RestorePoint, pk=pk)
        audit.record(
            request.user,
            "export",
            "backup",
            summary=f"Downloaded the restore point of {point.created_at:%Y-%m-%d %H:%M}",
        )
        return _attachment(
            point.document.encode(),
            "application/json",
            f"task-register-restore-point-{point.created_at:%Y%m%d-%H%M}.json",
        )


class RestorePointRestoreSerializer(serializers.Serializer):
    confirm = serializers.CharField(required=False, allow_blank=True, default="")


class RestorePointRestoreView(APIView):
    """Go back to a restore point. A new restore point of the current data is kept first."""

    permission_classes = [IsAdministrator]

    @extend_schema(request=RestorePointRestoreSerializer)
    def post(self, request, pk: int):
        point = get_object_or_404(RestorePoint, pk=pk)
        form = RestorePointRestoreSerializer(data=request.data)
        form.is_valid(raise_exception=True)
        if form.validated_data["confirm"] != CONFIRM_PHRASE:
            return Response(
                {"detail": f"Type {CONFIRM_PHRASE} to confirm that all current data will be replaced."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            inspection = services.inspect_backup(point.document.encode())
        except services.BackupError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        actor = request.user.username
        label = f"{point.created_at:%Y-%m-%d %H:%M}"
        new_point = services.create_restore_point(f"Before going back to the restore point of {label}", request.user)
        services.restore_backup(inspection)
        audit.record(None, "restore", "backup", summary=f"{actor} went back to the restore point of {label}")
        return Response({"restored": True, "restore_point": new_point.id, **inspection.summary})
