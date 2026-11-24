"""Master data: work groups, directions and the lists behind every dropdown."""

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator, RegexValidator
from django.db import models


class WorkGroup(models.Model):
    """A group that keeps its own task register. Its code starts every task ID."""

    code = models.CharField(
        max_length=5,
        unique=True,
        validators=[RegexValidator(r"^[A-Z]{2,5}$", "Use 2 to 5 capital letters.")],
    )
    name = models.CharField(max_length=120)
    # From "Directions from Leadership": the group's mission, and its weight in the programme (percent).
    mission = models.TextField(max_length=1000, blank=True)
    weight = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(0), MaxValueValidator(100)]
    )
    is_active = models.BooleanField(default=True)
    # The work group leader: one per group. Approves the group's Direct tasks and reviews what other groups
    # need from it (partner rows) or deliver to it (contributions). A leader is also a member of the group.
    leader = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="led_groups"
    )

    class Meta:
        ordering = ["code"]

    def __str__(self) -> str:
        return f"{self.code} – {self.name}"


class Direction(models.Model):
    """A direction a work group serves. Code is generated as <GROUP>-D<NN>."""

    code = models.CharField(max_length=12, unique=True, editable=False)
    work_group = models.ForeignKey(WorkGroup, on_delete=models.PROTECT, related_name="directions")
    title = models.CharField(max_length=200)
    meaning = models.TextField(blank=True)

    class Meta:
        ordering = ["work_group__code", "code"]

    def __str__(self) -> str:
        return f"{self.code} – {self.title}"

    def save(self, *args, **kwargs):
        if not self.code:
            prefix = f"{self.work_group.code}-D"
            numbers = [
                int(c.split("-D")[1])
                for c in Direction.objects.filter(code__startswith=prefix).values_list("code", flat=True)
                if c.split("-D")[1].isdigit()
            ]
            self.code = f"{prefix}{(max(numbers) + 1) if numbers else 1:02d}"
        super().save(*args, **kwargs)


class LookupValue(models.Model):
    """A value in one of the dropdown lists. Tasks point to it, so a rename updates every task."""

    class ListKey(models.TextChoices):
        WORKSTREAM = "workstream", "Workstreams"
        SUB_OBJECTIVE = "sub_objective", "Sub-objectives"
        OWNER_ROLE = "owner_role", "Owner roles"
        PARTNER_ROLE = "partner_role", "Partner roles"
        NEEDED = "needed", "When needed"

    class Semantic(models.TextChoices):
        """Meanings the automatic check relies on. Values with a meaning can be renamed but not deleted."""

        DIRECT = "direct", "Owner role: result is the group's own"
        ENABLE = "enable", "Owner role: enables another group"
        SUPPORT = "support", "Owner role: supports another group"
        BEFORE_START = "before_start", "Needed before the task starts"

    list_key = models.CharField(max_length=20, choices=ListKey.choices, db_index=True)
    value = models.CharField(max_length=200)
    definition = models.TextField(blank=True)
    sort_order = models.PositiveIntegerField(default=0)
    semantic = models.CharField(max_length=20, choices=Semantic.choices, blank=True)
    # Sub-objectives belong to one work group: a task offers only its own group's sub-objectives.
    # Empty for the other lists, and for a sub-objective shared by every group.
    work_group = models.ForeignKey(
        WorkGroup, null=True, blank=True, on_delete=models.PROTECT, related_name="sub_objectives"
    )

    class Meta:
        ordering = ["list_key", "sort_order", "id"]
        constraints = [
            models.UniqueConstraint(fields=["list_key", "value"], name="unique_value_per_list"),
        ]

    def __str__(self) -> str:
        return self.value

    @property
    def is_core(self) -> bool:
        return bool(self.semantic)


class GroupMember(models.Model):
    """
    A person of a work group. An activity owner is a member of the task's own work group. One person
    can belong to several groups (one row per group), for example leading three of them.
    """

    class MemberType(models.TextChoices):
        LEADER = "leader", "Leader"
        COORDINATOR = "coordinator", "Focal Point"
        MEMBER = "member", "Member"

    name = models.CharField(max_length=120)
    work_group = models.ForeignKey(WorkGroup, on_delete=models.PROTECT, related_name="members")
    # The member's place in the group. With a linked sign-in account it also sets the account's role for
    # this group: Team Leader, Team Focal Point or Team Member (apps/masterdata/membership.py).
    member_type = models.CharField(max_length=12, choices=MemberType.choices, default=MemberType.MEMBER)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="memberships"
    )
    # Optional contact details, so the TMO and other groups know whom to reach about an activity.
    job_title = models.CharField(max_length=120, blank=True)
    email = models.EmailField(max_length=254, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["work_group__code", "name"]
        constraints = [models.UniqueConstraint(fields=["work_group", "name"], name="unique_member_per_group")]

    def __str__(self) -> str:
        return f"{self.name} ({self.work_group.code})"
