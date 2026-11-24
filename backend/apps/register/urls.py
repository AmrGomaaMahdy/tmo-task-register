from django.urls import path
from rest_framework.routers import DefaultRouter

from .reports import BoardSummaryExportedView, BoardSummaryView, DependenciesView, TmoDeskView
from .views import ActivityViewSet, ContributionViewSet, NotificationViewSet, PartnerViewSet, TaskViewSet

router = DefaultRouter()
router.register("tasks", TaskViewSet, basename="task")
router.register("activities", ActivityViewSet, basename="activity")
router.register("partners", PartnerViewSet, basename="partner")  # partner rows
router.register("contributions", ContributionViewSet, basename="contribution")  # contribution rows
router.register("notifications", NotificationViewSet, basename="notification")  # the action centre
urlpatterns = [
    path("tmo-desk/", TmoDeskView.as_view(), name="tmo-desk"),
    path("reports/board-summary/", BoardSummaryView.as_view(), name="board-summary"),
    path("reports/dependencies/", DependenciesView.as_view(), name="report-dependencies"),
    path("reports/board-summary/exported/", BoardSummaryExportedView.as_view(), name="board-summary-exported"),
    *router.urls,
]
