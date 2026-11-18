from rest_framework.routers import DefaultRouter

from .views import ActivityViewSet, ContributionViewSet, PartnerViewSet, TaskViewSet

router = DefaultRouter()
router.register("tasks", TaskViewSet, basename="task")
router.register("activities", ActivityViewSet, basename="activity")
router.register("partners", PartnerViewSet, basename="partner")  # partner rows
router.register("contributions", ContributionViewSet, basename="contribution")  # contribution rows
urlpatterns = router.urls
