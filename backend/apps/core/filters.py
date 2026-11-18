import django_filters
from django.db.models import Q, TextField
from django.db.models.functions import Cast

from .models import AuditLog, SystemEvent


class AuditLogFilter(django_filters.FilterSet):
    """Audit trail filters: who, what, which record, which group, when, and free text."""

    actor = django_filters.CharFilter(method="by_actor")
    date_from = django_filters.DateFilter(field_name="created_at", lookup_expr="date__gte")
    date_to = django_filters.DateFilter(field_name="created_at", lookup_expr="date__lte")
    q = django_filters.CharFilter(method="search")

    class Meta:
        model = AuditLog
        fields = ["action", "entity", "entity_id", "work_group"]

    def by_actor(self, qs, name, value):
        return qs.filter(Q(actor__username=value) | Q(actor_name=value))

    def search(self, qs, name, value):
        # The changed values count too: searching "offshore" finds an edit that added that word.
        qs = qs.annotate(changes_text=Cast("changes", TextField()))
        q = Q()
        for word in value.split()[:6]:
            q &= (
                Q(summary__icontains=word)
                | Q(entity_label__icontains=word)
                | Q(actor_name__icontains=word)
                | Q(ip__icontains=word)
                | Q(path__icontains=word)
                | Q(changes_text__icontains=word)
            )
        return qs.filter(q)


class SystemEventFilter(django_filters.FilterSet):
    since = django_filters.DateFilter(field_name="last_seen", lookup_expr="date__gte")
    q = django_filters.CharFilter(method="search")

    class Meta:
        model = SystemEvent
        fields = ["level", "source", "resolved", "kind"]

    def search(self, qs, name, value):
        q = Q()
        for word in value.split()[:6]:
            q &= (
                Q(message__icontains=word)
                | Q(kind__icontains=word)
                | Q(path__icontains=word)
                | Q(username__icontains=word)
                | Q(ip__icontains=word)
            )
        return qs.filter(q)
