import django_filters
from django.db.models import Q

from .models import Contribution, Task, TaskPartner


class TaskFilter(django_filters.FilterSet):
    class Meta:
        model = Task
        fields = ["work_group", "status", "owner_role", "direction", "workstream", "sub_objective"]


class _InvolvesFilter(django_filters.FilterSet):
    """?involves=<work group id>: links where that group is on either side (its own tasks or the other end)."""

    involves = django_filters.NumberFilter(method="filter_involves")
    other_side: tuple[str, ...] = ()

    def filter_involves(self, queryset, name, value):
        q = Q(task__work_group=value)
        for field in self.other_side:
            q |= Q(**{field: value})
        return queryset.filter(q)


class PartnerFilter(_InvolvesFilter):
    """Partner rows."""

    other_side = ("work_group", "their_task__work_group")

    class Meta:
        model = TaskPartner
        fields = ["task", "task__work_group", "work_group", "their_task"]


class ContributionFilter(_InvolvesFilter):
    """Contribution rows."""

    other_side = ("to_group", "their_task__work_group")

    class Meta:
        model = Contribution
        fields = ["task", "task__work_group", "to_group", "their_task"]
