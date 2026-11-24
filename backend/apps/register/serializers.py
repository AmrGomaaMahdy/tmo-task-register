from django.db import transaction
from django.db.models import Q
from rest_framework import serializers

from apps.accounts import roles
from apps.masterdata.models import Direction, GroupMember, LookupValue, WorkGroup

from .models import MAX_ROWS, Activity, Contribution, Decision, Task, TaskPartner
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
from .validation import activity_date_problems, clean_text, task_date_problems, task_ref_problem

LK = LookupValue.ListKey
MAX_PARTNERS = MAX_ROWS
REVIEW_READ_ONLY = ("review", "review_note", "review_date", "reviewed_at")


PARTNER_CONTENT = ("work_group_id", "role_id", "need", "needed_when_id", "their_task_ref")
CONTRIBUTION_CONTENT = ("to_group_id", "benefit", "needed_when_id", "their_task_ref")


def same(a, b, fields) -> bool:
    return all(getattr(a, f) == getattr(b, f) for f in fields)


def keep_review(old, new, fields) -> None:
    """Carry the leader's review over to a row saved again without changes."""
    if old is not None and same(old, new, fields):
        for f in old.REVIEW_FIELDS:
            setattr(new, f, getattr(old, f))


def is_direct(task) -> bool:
    return bool(task.owner_role_id) and task.owner_role.semantic == LookupValue.Semantic.DIRECT


def person(user) -> str:
    return (user.get_full_name() or user.get_username()) if user else ""


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
    reviewed_by_name = serializers.SerializerMethodField()
    can_review = serializers.SerializerMethodField()

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
            "review",
            "review_note",
            "review_date",
            "reviewed_by_name",
            "reviewed_at",
            "can_review",
        ]
        read_only_fields = ["id", "slot", *REVIEW_READ_ONLY]

    def validate_their_task_ref(self, value: str) -> str:
        return value.strip().upper()

    def get_reviewed_by_name(self, obj) -> str:
        return person(obj.reviewed_by)

    def get_can_review(self, obj) -> bool:
        return roles.can_review_link(self.context["request"].user, obj.work_group_id)

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
    reviewed_by_name = serializers.SerializerMethodField()
    can_review = serializers.SerializerMethodField()

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
            "review",
            "review_note",
            "review_date",
            "reviewed_by_name",
            "reviewed_at",
            "can_review",
        ]
        read_only_fields = ["id", "slot", *REVIEW_READ_ONLY]

    def validate_their_task_ref(self, value: str) -> str:
        return value.strip().upper()

    def get_reviewed_by_name(self, obj) -> str:
        return person(obj.reviewed_by)

    def get_can_review(self, obj) -> bool:
        return roles.can_review_link(self.context["request"].user, obj.to_group_id)

    def get_agreed(self, obj) -> bool:
        return contribution_agreed(obj)

    def get_issues(self, obj) -> list[str]:
        return contribution_issues(contribution_data(obj), obj.task.work_group_id)


# ---- Tasks -------------------------------------------------------------------
class TaskListSerializer(serializers.ModelSerializer):
    """Light representation for tables."""

    work_group_code = serializers.CharField(source="work_group.code", read_only=True)
    approval = serializers.SerializerMethodField()
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
            "description",
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
            "approval",
        ]

    def get_approval(self, obj) -> str | None:
        return obj.approval

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
    A task with its partner rows and its contribution rows (up to twenty of each). The form saves
    all of them in one request. A Direct task also carries its leader's approval.
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
    approval_by_name = serializers.SerializerMethodField()
    approval_needed = serializers.SerializerMethodField()
    tmo_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = [
            "id",
            "code",
            "work_group",
            "work_group_code",
            "title",
            "description",
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
            "approval",
            "approval_note",
            "approval_by_name",
            "approval_at",
            "approval_needed",
            "tmo_note",
            "tmo_by_name",
            "tmo_at",
            "checks",
            "check_summary",
            "access",
            "created_at",
            "updated_at",
            "updated_by_name",
        ]
        read_only_fields = [
            "code",
            "created_at",
            "updated_at",
            "approval",
            "approval_note",
            "approval_at",
            "tmo_note",
            "tmo_at",
        ]

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
            "can_approve": roles.can_approve_task(user, obj),
        }

    def get_approval_by_name(self, obj) -> str:
        return person(obj.approval_by)

    def get_tmo_by_name(self, obj) -> str:
        return person(obj.tmo_by)

    def get_approval_needed(self, obj) -> bool:
        """Every task goes to its work group leader once it is Ready to include (links are reviewed per link)."""
        return True

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

    def validate_title(self, value):
        return clean_text(value, "The task", 3)

    def validate_description(self, value):
        # Line breaks are kept (a description may list points); spaces at line ends and blank runs are not.
        lines = [line.rstrip() for line in (value or "").strip().splitlines()]
        text = "\n".join(lines)
        while "\n\n\n" in text:
            text = text.replace("\n\n\n", "\n\n")
        return text

    def _field_problems(self, attrs, wg) -> dict:
        """Dates, task numbers and groups: refused on save; the live check shows them as errors instead."""
        inst = self.instance
        start = attrs.get("planned_start", inst.planned_start if inst else None)
        finish = attrs.get("planned_finish", inst.planned_finish if inst else None)
        changed = bool(inst) and (start != inst.planned_start or finish != inst.planned_finish)
        out = task_date_problems(start, finish, inst, changed)
        sub = attrs.get("sub_objective", inst.sub_objective if inst else None)
        if sub is not None and sub.work_group_id and wg and sub.work_group_id != wg.id:
            # Sub-objectives belong to one work group; the form offers only the task's own.
            out["sub_objective"] = f"This sub-objective belongs to {sub.work_group.code}. Pick one of {wg.code}'s."
        before_groups = set()
        if inst:
            before_groups = set(inst.partners.values_list("work_group_id", flat=True))
            before_groups |= set(inst.contributions.exclude(to_group=None).values_list("to_group_id", flat=True))
        msgs: dict[str, list[str]] = {"partners": [], "contributions": []}
        for i, p in enumerate(attrs.get("partners", []), start=1):
            g = p["work_group"]
            if not g.is_active and g.id not in before_groups:
                msgs["partners"].append(f"Partner {i}: {g.code} is no longer an active work group.")
            if problem := task_ref_problem(p.get("their_task_ref", "")):
                msgs["partners"].append(f"Partner {i}: {problem}.")
        for i, c in enumerate(attrs.get("contributions", []), start=1):
            g = c.get("to_group")
            if g and wg and g.id == wg.id:
                msgs["contributions"].append(f"Contribution {i}: it must go to another work group.")
            elif g and not g.is_active and g.id not in before_groups:
                msgs["contributions"].append(f"Contribution {i}: {g.code} is no longer an active work group.")
            if problem := task_ref_problem(c.get("their_task_ref", "")):
                msgs["contributions"].append(f"Contribution {i}: {problem}.")
        out.update({k: v for k, v in msgs.items() if v})
        return out

    def validate(self, attrs):
        user = self.context["request"].user
        wg = attrs.get("work_group") or (self.instance.work_group if self.instance else None)
        problems = self._field_problems(attrs, wg)
        if self.context.get("live_check"):
            # The check already reports a finish before the start and badly written task numbers.
            self.live_problems = {k: v for k, v in problems.items() if k not in ("partners", "contributions")}
            if "Planned finish must be on or after" in str(self.live_problems.get("planned_finish", "")):
                self.live_problems.pop("planned_finish")
        elif problems:
            raise serializers.ValidationError(problems)
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
                if new_status in (Task.Status.LEADER_APPROVED, Task.Status.IN_MASTER_PLAN) and not roles.is_admin(user):
                    raise serializers.ValidationError({"status": "The leader and then the TMO decide on this status."})
                if new_status == Task.Status.READY:
                    # Submitted (again): the leader decides on this version.
                    attrs.update(approval="pending", approval_note="", approval_by=None, approval_at=None)
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
        # The leader's decision is reset when the task is submitted again (status Ready, see validate()),
        # so a rejection or a question stays visible while the Focal Point completes the task.
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
        # A row saved again unchanged keeps its review; a changed row goes back to its leader as pending.
        before = {p.work_group_id: p for p in task.partners.all()}
        task.partners.all().delete()
        rows = []
        for i, p in enumerate(partners, start=1):
            row = TaskPartner(
                task=task,
                slot=i,
                work_group=p["work_group"],
                role=p.get("role"),
                need=p.get("need", ""),
                needed_when=p.get("needed_when"),
                their_task_ref=p.get("their_task_ref", ""),
                their_task=task_by_number(p.get("their_task_ref", "")),
            )
            keep_review(before.get(row.work_group_id), row, PARTNER_CONTENT)
            rows.append(row)
        TaskPartner.objects.bulk_create(rows)

    @staticmethod
    def _save_contributions(task, rows):
        """Contributions exist only for an Enable or Support task; a Direct task keeps none."""
        before = list(task.contributions.all())
        task.contributions.all().delete()
        if not links_out(task):
            return
        filled = [c for c in rows if any(c.get(k) for k in CON_FIELDS)]
        made = []
        for i, c in enumerate(filled, start=1):
            row = Contribution(
                task=task,
                slot=i,
                to_group=c.get("to_group"),
                benefit=c.get("benefit", ""),
                needed_when=c.get("needed_when"),
                their_task_ref=c.get("their_task_ref", ""),
                their_task=task_by_number(c.get("their_task_ref", "")),
            )
            keep_review(
                next((b for b in before if same(b, row, CONTRIBUTION_CONTENT)), None), row, CONTRIBUTION_CONTENT
            )
            made.append(row)
        Contribution.objects.bulk_create(made)

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

    def validate_name(self, value):
        return clean_text(value, "The activity", 3)

    def validate(self, attrs):
        inst = self.instance
        task = attrs.get("task") or inst.task
        owner = attrs.get("owner")
        if owner is not None and owner.work_group_id != task.work_group_id:
            own, theirs = task.work_group.code, owner.work_group.code
            raise serializers.ValidationError(
                {"owner": f"{owner.name} is a member of {theirs}. Pick a member of {own}."}
            )
        if owner is not None and not owner.is_active and not (inst and inst.owner_id == owner.id):
            raise serializers.ValidationError({"owner": f"{owner.name} is no longer active. Pick another member."})
        preds = attrs["predecessors"] if "predecessors" in attrs else (list(inst.predecessors.all()) if inst else [])
        if len(preds) > 2:
            raise serializers.ValidationError({"predecessors": "Up to two predecessors (Predecessor 1 and 2)."})
        for p in preds:
            if p.task_id != task.id:
                raise serializers.ValidationError({"predecessors": "Predecessors must be activities of the same task."})
            if self.instance and p.id == self.instance.id:
                raise serializers.ValidationError({"predecessors": "An activity cannot precede itself."})
        start = attrs.get("start_date", inst.start_date if inst else None)
        finish = attrs.get("finish_date", inst.finish_date if inst else None)
        problems = activity_date_problems(start, finish, task, preds, inst)
        if problems:
            raise serializers.ValidationError(problems)
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
    # The reason when the TMO sends a task back to the group.
    note = serializers.CharField(max_length=500, allow_blank=True, required=False, default="")

    def validate_note(self, value):
        return " ".join(value.split())


class DecisionSerializer(serializers.Serializer):
    """
    A leader's decision, on a task of the group or on a link with another group: Approve or Reject, with a
    reason when needed (1.20). Decisions saved earlier as "clarification" or "change timeline" stay readable.
    """

    decision = serializers.ChoiceField(choices=[(Decision.APPROVED, "Approve"), (Decision.REJECTED, "Reject")])
    note = serializers.CharField(max_length=500, allow_blank=True, required=False, default="")

    def validate(self, attrs):
        attrs["note"] = " ".join(attrs["note"].split())
        attrs["proposed_date"] = None
        return attrs


class TaskDirectorySerializer(serializers.ModelSerializer):
    """Just enough to pick another group's task number when recording a link."""

    work_group_code = serializers.CharField(source="work_group.code", read_only=True)

    class Meta:
        model = Task
        fields = ["id", "code", "title", "work_group", "work_group_code"]


class SharedTaskSerializer(serializers.ModelSerializer):
    """
    Another work group's task as a team user sees it: identity, description and dates (so a partner group
    understands what it is asked for), plus only the rows of partners and contributions between that task
    and the user's own work group(s).
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
            "description",
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
        groups = roles.view_group_ids(self.context["request"].user)
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
