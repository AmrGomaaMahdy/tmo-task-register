from django.db import transaction
from django.db.models import Q
from rest_framework import serializers

from apps.accounts import roles
from apps.masterdata.models import Direction, GroupMember, LookupValue, WorkGroup

from .models import MAX_ROWS, Activity, Contribution, Task, TaskPartner
from .services.checks import (
    ContributionData,
    PartnerData,
    activity_issues,
    check_task,
    contribution_issues,
    links_out,
    partner_issues,
    summary,
)
from .services.workdays import working_days

LK = LookupValue.ListKey
MAX_PARTNERS = MAX_ROWS
MAX_CONTRIBUTIONS = MAX_ROWS
CON_FIELDS = ("to_group", "benefit", "needed_when", "their_task_ref")


def lookup_field(list_key: str) -> serializers.PrimaryKeyRelatedField:
    return serializers.PrimaryKeyRelatedField(
        queryset=LookupValue.objects.filter(list_key=list_key), allow_null=True, required=False
    )


def task_by_number(ref: str) -> Task | None:
    ref = (ref or "").strip().upper()
    return Task.objects.filter(code=ref).first() if ref else None


class TaskRefSerializer(serializers.ModelSerializer):
    work_group_code = serializers.CharField(source="work_group.code", read_only=True)

    class Meta:
        model = Task
        fields = ["id", "code", "title", "status", "work_group_code"]


def partner_agreed(p: TaskPartner) -> bool:
    """Both registers record each other's task number: their task points back to ours."""
    other = p.their_task
    if other is None:
        return False
    return (
        other.contributions.filter(their_task=p.task_id).exists()
        or other.partners.filter(their_task=p.task_id).exists()
    )


def contribution_agreed(c: Contribution) -> bool:
    other = c.their_task
    if other is None:
        return False
    return (
        other.partners.filter(their_task=c.task_id).exists()
        or other.contributions.filter(their_task=c.task_id).exists()
    )


def partner_data(p: TaskPartner) -> PartnerData:
    return PartnerData(
        p.slot, p.work_group_id, p.work_group.code, p.role_id, p.need, p.needed_when_id, p.their_task_ref
    )


def contribution_data(c: Contribution) -> ContributionData:
    return ContributionData(
        c.slot, c.to_group_id, c.to_group.code if c.to_group_id else "", c.benefit, c.needed_when_id, c.their_task_ref
    )


# ---- Partner and contribution rows ------------------------------------------------
class PartnerRowSerializer(serializers.ModelSerializer):
    """A partner row: partner group, role, what we need, when, their task."""

    work_group = serializers.PrimaryKeyRelatedField(queryset=WorkGroup.objects.all())
    work_group_code = serializers.CharField(source="work_group.code", read_only=True)
    role = lookup_field(LK.PARTNER_ROLE)
    needed_when = lookup_field(LK.NEEDED)
    need = serializers.CharField(max_length=300, allow_blank=True, required=False)
    their_task_ref = serializers.CharField(max_length=20, allow_blank=True, required=False)
    their_task_info = TaskRefSerializer(source="their_task", read_only=True)
    agreed = serializers.SerializerMethodField()
    issues = serializers.SerializerMethodField()

    class Meta:
        model = TaskPartner
        fields = [
            "id",
            "slot",
            "work_group",
            "work_group_code",
            "role",
            "need",
            "needed_when",
            "their_task_ref",
            "their_task_info",
            "agreed",
            "issues",
        ]
        read_only_fields = ["id", "slot"]

    def validate_their_task_ref(self, value: str) -> str:
        return value.strip().upper()

    def get_agreed(self, obj) -> bool:
        return partner_agreed(obj)

    def get_issues(self, obj) -> list[str]:
        return partner_issues(partner_data(obj), obj.task.work_group_id)


class ContributionRowSerializer(serializers.ModelSerializer):
    """A contribution row: group we enable / support, what we deliver, when they need it, their task."""

    to_group = serializers.PrimaryKeyRelatedField(queryset=WorkGroup.objects.all(), allow_null=True, required=False)
    to_group_code = serializers.CharField(source="to_group.code", read_only=True, default="")
    needed_when = lookup_field(LK.NEEDED)
    benefit = serializers.CharField(max_length=300, allow_blank=True, required=False)
    their_task_ref = serializers.CharField(max_length=20, allow_blank=True, required=False)
    their_task_info = TaskRefSerializer(source="their_task", read_only=True)
    agreed = serializers.SerializerMethodField()
    issues = serializers.SerializerMethodField()

    class Meta:
        model = Contribution
        fields = [
            "id",
            "slot",
            "to_group",
            "to_group_code",
            "benefit",
            "needed_when",
            "their_task_ref",
            "their_task_info",
            "agreed",
            "issues",
        ]
        read_only_fields = ["id", "slot"]

    def validate_their_task_ref(self, value: str) -> str:
        return value.strip().upper()

    def get_agreed(self, obj) -> bool:
        return contribution_agreed(obj)

    def get_issues(self, obj) -> list[str]:
        return contribution_issues(contribution_data(obj), obj.task.work_group_id)


# ---- Tasks -------------------------------------------------------------------
class TaskListSerializer(serializers.ModelSerializer):
    """Light representation for tables."""

    work_group_code = serializers.CharField(source="work_group.code", read_only=True)
    partner_codes = serializers.SerializerMethodField()
    activity_count = serializers.SerializerMethodField()
    duration_days = serializers.SerializerMethodField()
    check_summary = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = [
            "id",
            "code",
            "title",
            "work_group",
            "work_group_code",
            "status",
            "direction",
            "workstream",
            "sub_objective",
            "owner_role",
            "planned_start",
            "planned_finish",
            "duration_days",
            "partner_codes",
            "activity_count",
            "check_summary",
        ]

    def get_partner_codes(self, obj) -> list[str]:
        return [p.work_group.code for p in obj.partners.all()]

    def get_activity_count(self, obj) -> int:
        return len(obj.activities.all())

    def get_duration_days(self, obj) -> int | None:
        return working_days(obj.planned_start, obj.planned_finish)

    def get_check_summary(self, obj) -> dict:
        return summary(check_task(obj))


class TaskSerializer(serializers.ModelSerializer):
    """
    A task with its partner rows and its contribution rows (up to five of each). The form saves
    all of them in one request.
    """

    work_group = serializers.PrimaryKeyRelatedField(queryset=WorkGroup.objects.filter(is_active=True))
    work_group_code = serializers.CharField(source="work_group.code", read_only=True)
    direction = serializers.PrimaryKeyRelatedField(queryset=Direction.objects.all(), allow_null=True, required=False)
    workstream = lookup_field(LK.WORKSTREAM)
    sub_objective = lookup_field(LK.SUB_OBJECTIVE)
    owner_role = lookup_field(LK.OWNER_ROLE)
    status = serializers.ChoiceField(choices=Task.Status.choices, required=False)
    partners = PartnerRowSerializer(many=True, required=False)
    contributions = ContributionRowSerializer(many=True, required=False)

    duration_days = serializers.SerializerMethodField()
    activity_count = serializers.SerializerMethodField()
    checks = serializers.SerializerMethodField()
    check_summary = serializers.SerializerMethodField()
    access = serializers.SerializerMethodField()
    updated_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = [
            "id",
            "code",
            "work_group",
            "work_group_code",
            "title",
            "direction",
            "workstream",
            "sub_objective",
            "owner_role",
            "partners",
            "contributions",
            "planned_start",
            "planned_finish",
            "duration_days",
            "activity_count",
            "status",
            "checks",
            "check_summary",
            "access",
            "created_at",
            "updated_at",
            "updated_by_name",
        ]
        read_only_fields = ["code", "created_at", "updated_at"]

    # --- read helpers ---------------------------------------------------
    def _issues(self, obj):
        cache = self.context.setdefault("_issues", {})
        if obj.pk not in cache:
            cache[obj.pk] = check_task(obj)
        return cache[obj.pk]

    def get_duration_days(self, obj) -> int | None:
        return working_days(obj.planned_start, obj.planned_finish)

    def get_activity_count(self, obj) -> int:
        return obj.activities.count() if obj.pk else 0

    def get_checks(self, obj) -> list[dict]:
        return [i.as_dict() for i in self._issues(obj)]

    def get_check_summary(self, obj) -> dict:
        return summary(self._issues(obj))

    def get_access(self, obj) -> dict:
        user = self.context["request"].user
        return {
            "can_edit": roles.can_edit_task(user, obj),
            "can_delete": roles.can_delete_task(user, obj),
            "transitions": roles.allowed_transitions(user, obj),
        }

    def get_updated_by_name(self, obj) -> str:
        u = obj.updated_by
        return (u.get_full_name() or u.get_username()) if u else ""

    # --- validation -----------------------------------------------------
    def validate_partners(self, value):
        if len(value) > MAX_PARTNERS:
            raise serializers.ValidationError(f"A task can have up to {MAX_PARTNERS} partner groups.")
        groups = [p["work_group"].id for p in value]
        if len(set(groups)) != len(groups):
            raise serializers.ValidationError("Name each partner group once.")
        return value

    def validate_contributions(self, value):
        if len(value) > MAX_CONTRIBUTIONS:
            raise serializers.ValidationError(f"A task can have up to {MAX_CONTRIBUTIONS} contributions.")
        return value

    def validate(self, attrs):
        user = self.context["request"].user
        wg = attrs.get("work_group") or (self.instance.work_group if self.instance else None)
        if self.instance and "work_group" in attrs and attrs["work_group"] != self.instance.work_group:
            raise serializers.ValidationError({"work_group": "A task cannot move to another work group."})
        d = attrs.get("direction")
        if d and wg and d.work_group_id != wg.id:
            raise serializers.ValidationError({"direction": "Pick a direction of the task's own work group."})
        if wg and any(p["work_group"].id == wg.id for p in attrs.get("partners", [])):
            raise serializers.ValidationError({"partners": "A partner must be another work group."})
        new_status = attrs.get("status")
        if new_status:
            current = self.instance.status if self.instance else Task.Status.DRAFT
            if new_status == Task.Status.IN_MASTER_PLAN and current != Task.Status.IN_MASTER_PLAN:
                raise serializers.ValidationError({"status": "Only the TMO includes tasks in the Master Plan."})
            if new_status != current:
                probe = self.instance or Task(work_group=wg, status=Task.Status.DRAFT)
                if new_status not in roles.allowed_transitions(user, probe) and not (
                    not self.instance and new_status == Task.Status.DRAFT
                ):
                    raise serializers.ValidationError({"status": "You cannot set this readiness status."})
        return attrs

    # --- write ----------------------------------------------------------
    @transaction.atomic
    def create(self, validated_data):
        partners = validated_data.pop("partners", [])
        contributions = validated_data.pop("contributions", [])
        task = Task.objects.create(**validated_data)
        self._save_partners(task, partners)
        self._save_contributions(task, contributions)
        return task

    @transaction.atomic
    def update(self, instance, validated_data):
        partners = validated_data.pop("partners", None)
        contributions = validated_data.pop("contributions", None)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        instance.save()
        if partners is not None:
            self._save_partners(instance, partners)
        if contributions is not None:
            self._save_contributions(instance, contributions)
        elif not links_out(instance):
            instance.contributions.all().delete()
        return instance

    @staticmethod
    def _save_partners(task, partners):
        task.partners.all().delete()
        TaskPartner.objects.bulk_create(
            [
                TaskPartner(
                    task=task,
                    slot=i,
                    work_group=p["work_group"],
                    role=p.get("role"),
                    need=p.get("need", ""),
                    needed_when=p.get("needed_when"),
                    their_task_ref=p.get("their_task_ref", ""),
                    their_task=task_by_number(p.get("their_task_ref", "")),
                )
                for i, p in enumerate(partners, start=1)
            ]
        )

    @staticmethod
    def _save_contributions(task, rows):
        """Contributions exist only for an Enable or Support task; a Direct task keeps none."""
        task.contributions.all().delete()
        if not links_out(task):
            return
        filled = [c for c in rows if any(c.get(k) for k in CON_FIELDS)]
        Contribution.objects.bulk_create(
            [
                Contribution(
                    task=task,
                    slot=i,
                    to_group=c.get("to_group"),
                    benefit=c.get("benefit", ""),
                    needed_when=c.get("needed_when"),
                    their_task_ref=c.get("their_task_ref", ""),
                    their_task=task_by_number(c.get("their_task_ref", "")),
                )
                for i, c in enumerate(filled, start=1)
            ]
        )

    def build_unsaved(self):
        """
        For the live check: an unsaved task, its partner rows and its contribution rows from the
        form data. A list left out of the data is None (read from the saved task).
        """
        data = dict(self.validated_data)
        partners = data.pop("partners", None)
        contributions = data.pop("contributions", None)
        task = Task(**data)
        if self.instance:
            task.pk, task.id, task.code = self.instance.pk, self.instance.pk, self.instance.code
            for f in Task._meta.concrete_fields:
                if f.name not in data and f.name not in ("id", "code"):
                    setattr(task, f.attname, getattr(self.instance, f.attname))
        rows = (
            [
                PartnerData(
                    i,
                    p["work_group"].id,
                    p["work_group"].code,
                    p["role"].id if p.get("role") else None,
                    p.get("need", ""),
                    p["needed_when"].id if p.get("needed_when") else None,
                    p.get("their_task_ref", ""),
                )
                for i, p in enumerate(partners or [], start=1)
            ]
            if partners is not None or not self.instance
            else None
        )
        cons = None
        if contributions is not None or not self.instance:
            filled = [c for c in contributions or [] if any(c.get(k) for k in CON_FIELDS)]
            cons = [
                ContributionData(
                    i,
                    c["to_group"].id if c.get("to_group") else None,
                    c["to_group"].code if c.get("to_group") else "",
                    c.get("benefit", ""),
                    c["needed_when"].id if c.get("needed_when") else None,
                    c.get("their_task_ref", ""),
                )
                for i, c in enumerate(filled, start=1)
            ]
        return task, rows, cons


class ParentTaskMixin:
    """Validates that the user may edit the parent task of an activity."""

    def validate_task(self, task):
        user = self.context["request"].user
        if not roles.can_edit_task(user, task):
            raise serializers.ValidationError("You cannot change this task.")
        if self.instance and self.instance.task_id != task.id:
            raise serializers.ValidationError("A record cannot move to another task.")
        return task


class ActivitySerializer(ParentTaskMixin, serializers.ModelSerializer):
    code = serializers.CharField(read_only=True)
    owner = serializers.PrimaryKeyRelatedField(queryset=GroupMember.objects.all(), allow_null=True, required=False)
    owner_name = serializers.CharField(source="owner.name", read_only=True, default="")
    owner_group = serializers.CharField(source="owner.work_group.code", read_only=True, default="")
    task_code = serializers.CharField(source="task.code", read_only=True)
    task_title = serializers.CharField(source="task.title", read_only=True)
    task_status = serializers.CharField(source="task.status", read_only=True)
    work_group = serializers.IntegerField(source="task.work_group_id", read_only=True)
    work_group_code = serializers.CharField(source="task.work_group.code", read_only=True)
    predecessors = serializers.PrimaryKeyRelatedField(queryset=Activity.objects.all(), many=True, required=False)
    duration_days = serializers.SerializerMethodField()
    issues = serializers.SerializerMethodField()

    class Meta:
        model = Activity
        fields = [
            "id",
            "task",
            "code",
            "order",
            "name",
            "owner",
            "owner_name",
            "owner_group",
            "task_code",
            "task_title",
            "task_status",
            "work_group",
            "work_group_code",
            "start_date",
            "finish_date",
            "duration_days",
            "predecessors",
            "issues",
        ]
        read_only_fields = ["order"]

    def get_duration_days(self, obj) -> int | None:
        return working_days(obj.start_date, obj.finish_date)

    def get_issues(self, obj) -> list[str]:
        return activity_issues(obj, obj.task.planned_start, obj.task.planned_finish)

    def validate(self, attrs):
        task = attrs.get("task") or self.instance.task
        if attrs.get("start_date") and attrs.get("finish_date") and attrs["finish_date"] < attrs["start_date"]:
            raise serializers.ValidationError({"finish_date": "Finish must be on or after start."})
        owner = attrs.get("owner")
        if owner is not None and owner.work_group_id != task.work_group_id:
            own, theirs = task.work_group.code, owner.work_group.code
            raise serializers.ValidationError(
                {"owner": f"{owner.name} is a member of {theirs}. Pick a member of {own}."}
            )
        preds = attrs.get("predecessors", [])
        if len(preds) > 2:
            raise serializers.ValidationError({"predecessors": "Up to two predecessors (Predecessor 1 and 2)."})
        for p in preds:
            if p.task_id != task.id:
                raise serializers.ValidationError({"predecessors": "Predecessors must be activities of the same task."})
            if self.instance and p.id == self.instance.id:
                raise serializers.ValidationError({"predecessors": "An activity cannot precede itself."})
        return attrs

    def create(self, validated_data):
        task = validated_data["task"]
        last = task.activities.order_by("-order").values_list("order", flat=True).first() or 0
        validated_data["order"] = last + 1
        return super().create(validated_data)


# ---- Links page (read only: rows are edited in the task form) -----------------
class PartnerLinkSerializer(PartnerRowSerializer):
    task_ref = TaskRefSerializer(source="task", read_only=True)
    task = serializers.IntegerField(source="task_id", read_only=True)

    class Meta(PartnerRowSerializer.Meta):
        fields = ["task", "task_ref", *PartnerRowSerializer.Meta.fields]


class ContributionLinkSerializer(ContributionRowSerializer):
    task_ref = TaskRefSerializer(source="task", read_only=True)
    task = serializers.IntegerField(source="task_id", read_only=True)
    owner_role = serializers.CharField(source="task.owner_role.value", read_only=True, default="")
    orphan = serializers.SerializerMethodField()

    class Meta(ContributionRowSerializer.Meta):
        fields = ["task", "task_ref", "owner_role", "orphan", *ContributionRowSerializer.Meta.fields]

    def get_orphan(self, obj) -> bool:
        """The owner role changed to Direct: this row has no Enable / Support task any more."""
        return not links_out(obj.task)


class TransitionSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Task.Status.choices)


class TaskDirectorySerializer(serializers.ModelSerializer):
    """Just enough to pick another group's task number when recording a link."""

    work_group_code = serializers.CharField(source="work_group.code", read_only=True)

    class Meta:
        model = Task
        fields = ["id", "code", "title", "work_group", "work_group_code"]


class SharedTaskSerializer(serializers.ModelSerializer):
    """
    Another work group's task as a team user sees it: identity and dates, plus only the rows of
    partners and contributions between that task and the user's own work group(s).
    """

    work_group_code = serializers.CharField(source="work_group.code", read_only=True)
    limited = serializers.SerializerMethodField()
    shared = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = [
            "id",
            "code",
            "title",
            "status",
            "work_group",
            "work_group_code",
            "planned_start",
            "planned_finish",
            "limited",
            "shared",
        ]

    def get_limited(self, obj) -> bool:
        return True

    def get_shared(self, obj) -> dict:
        groups = roles.work_group_ids(self.context["request"].user)
        ctx = self.context
        partners = TaskPartner.objects.select_related(
            "task__work_group", "work_group", "their_task__work_group"
        ).filter(Q(task=obj, work_group__in=groups) | Q(their_task=obj, task__work_group__in=groups))
        contributions = Contribution.objects.select_related(
            "task__work_group", "task__owner_role", "to_group", "their_task__work_group"
        ).filter(Q(task=obj, to_group__in=groups) | Q(their_task=obj, task__work_group__in=groups))
        return {
            "partners": PartnerLinkSerializer(partners, many=True, context=ctx).data,
            "contributions": ContributionLinkSerializer(contributions, many=True, context=ctx).data,
        }
