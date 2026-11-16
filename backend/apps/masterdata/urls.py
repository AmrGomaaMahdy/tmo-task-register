from rest_framework.routers import DefaultRouter

from .views import DirectionViewSet, GroupMemberViewSet, LookupValueViewSet, WorkGroupViewSet

router = DefaultRouter()
router.register("work-groups", WorkGroupViewSet, basename="work-group")
router.register("directions", DirectionViewSet, basename="direction")
router.register("members", GroupMemberViewSet, basename="member")
router.register("lookups", LookupValueViewSet, basename="lookup")
urlpatterns = router.urls
