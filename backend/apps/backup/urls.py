from django.urls import path

from .views import (
    ExportBackupView,
    ExportExcelView,
    RestoreBackupView,
    RestorePointDownloadView,
    RestorePointListView,
    RestorePointRestoreView,
)

urlpatterns = [
    path("backup/export/", ExportBackupView.as_view(), name="backup-export"),
    path("backup/export-excel/", ExportExcelView.as_view(), name="backup-export-excel"),
    path("backup/restore/", RestoreBackupView.as_view(), name="backup-restore"),
    path("backup/restore-points/", RestorePointListView.as_view(), name="restore-points"),
    path("backup/restore-points/<int:pk>/download/", RestorePointDownloadView.as_view(), name="restore-point-download"),
    path("backup/restore-points/<int:pk>/restore/", RestorePointRestoreView.as_view(), name="restore-point-restore"),
]
