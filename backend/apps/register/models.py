"""The task register: tasks and everything that hangs off a task."""

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.masterdata.models import Direction, GroupMember, LookupValue, WorkGroup

LK = LookupValue.ListKey


def lookup(list_key: str, related_name: str = "+", **kwargs) -> models.ForeignKey:
    """A nullable link to a value of one dropdown list. PROTECT stops deleting a value in use."""
    return models.ForeignKey(
        LookupValue,
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name=related_name,
        limit_choices_to={"list_key": list_key},
        **kwargs,
    )


class Decision(models.TextChoices):
    """A work group leader's decision on a Direct task or on a link with another group."""

    PENDING = "pending", "Waiting for review"
    APPROVED = "approved", "Approved"
    CLARIFICATION = "clarification", "Needs clarification"
    TIMELINE = "timeline", "Change timeline"
    REJECTED = "rejected", "Rejected"


class Reviewed(models.Model):
    """
    The review of a partner row or a contribution by the leader of the other group: the group asked to
    deliver (partner rows) or the group receiving it (contributions).
    """

    review = models.CharField(max_length=16, choices=Decision.choices, default=Decision.PENDING, db_index=True)
    review_note = models.CharField(max_length=500, blank=True)
    # With "Change timeline": the date the reviewing group proposes instead.
    review_date = models.DateField(null=True, blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)

    REVIEW_FIELDS = ("review", "review_note", "review_date", "reviewed_by_id", "reviewed_at")

    class Meta:
        abstract = True


class Task(models.Model):
    """One row of the Task Register (Simplified Task Register, sheet 2)."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        NEEDS_COMPLETION = "needs_completion", "Needs completion"
        READY = "ready", "Ready to include"
        LEADER_APPROVED = "leader_approved", "Leader Approved"
        IN_MASTER_PLAN = "in_master_plan", "In Master Plan"

    code = models.CharField(max_length=16, unique=True, editable=False)
    work_group = models.ForeignKey(WorkGroup, on_delete=models.PROTECT, related_name="tasks")

    # 1. Describe the task
    title = models.CharField(max_length=300)
    # Optional: what the task covers, its scope and expected result, in a few sentences.
    description = models.TextField(max_length=3000, blank=True)
    direction = models.ForeignKey(Direction, null=True, blank=True, on_delete=models.PROTECT, related_name="tasks")
    workstream = lookup(LK.WORKSTREAM)
    sub_objective = lookup(LK.SUB_OBJECTIVE)

    # 2. Who it involves (partners and the contribution are separate rows)
    owner_role = lookup(LK.OWNER_ROLE)

    # 3. Plan
    planned_start = models.DateField(null=True, blank=True)
    planned_finish = models.DateField(null=True, blank=True)

    # 4. Readiness: the Focal Point prepares (Draft / Needs completion) and submits (Ready to include); the
    #    leader approves (Leader Approved) or sends it back (Needs completion); the TMO includes it
    #    (In Master Plan) or sends it back (Needs completion).
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT, db_index=True)

    # 5. The work group leader's decision on the task (links with other groups are reviewed link by link)
    approval = models.CharField(max_length=16, choices=Decision.choices, default="pending", db_index=True)
    approval_note = models.CharField(max_length=500, blank=True)
    approval_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    approval_at = models.DateTimeField(null=True, blank=True)

    # 6. The TMO's latest decision: the reason when it sent the task back to the group
    tmo_note = models.CharField(max_length=500, blank=True)
    tmo_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    tmo_at = models.DateTimeField(null=True, blank=True)

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["work_group__code", "code"]

    def __str__(self) -> str:
        return f"{self.code} – {self.title}"

    def save(self, *args, **kwargs):
        if not self.code:
            prefix = f"{self.work_group.code}-T"
            numbers = [
                int(c.split("-T")[1])
                for c in Task.objects.filter(code__startswith=prefix).values_list("code", flat=True)
                if c.split("-T")[1].isdigit()
            ]
            self.code = f"{prefix}{(max(numbers) + 1) if numbers else 1:03d}"
        super().save(*args, **kwargs)


class Activity(models.Model):
    """The detailed plan of a big task (sheet 4)."""

    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="activities")
    order = models.PositiveSmallIntegerField()
    name = models.CharField(max_length=200)
    owner = models.ForeignKey(GroupMember, null=True, blank=True, on_delete=models.PROTECT, related_name="activities")
    start_date = models.DateField()
    finish_date = models.DateField()
    predecessors = models.ManyToManyField("self", symmetrical=False, blank=True, related_name="successors")

    class Meta:
        ordering = ["task", "order"]
        verbose_name_plural = "activities"

    def __str__(self) -> str:
        return f"{self.code} {self.name}"

    @property
    def code(self) -> str:
        return f"{self.task.code}-A{self.order:02d}"


MAX_ROWS = 20  # partner groups and contributions per task


class TaskPartner(Reviewed):
    """
    Partner row: a partner group working with us on the task, its role, and what we need from it,
    when, and their task number agreed in the meeting. Up to twenty per task. The partner group's
    leader reviews it.
    """

    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="partners")
    slot = models.PositiveSmallIntegerField(default=1, validators=[MinValueValidator(1), MaxValueValidator(MAX_ROWS)])
    work_group = models.ForeignKey(WorkGroup, on_delete=models.PROTECT, related_name="partner_in")
    role = lookup(LK.PARTNER_ROLE)
    need = models.CharField("what we need", max_length=300, blank=True)
    needed_when = lookup(LK.NEEDED)
    their_task_ref = models.CharField("their task", max_length=20, blank=True)
    their_task = models.ForeignKey(Task, null=True, blank=True, on_delete=models.SET_NULL, related_name="needed_by")

    class Meta:
        ordering = ["task", "slot"]
        constraints = [models.UniqueConstraint(fields=["task", "work_group"], name="unique_partner_per_task")]

    def __str__(self) -> str:
        return f"{self.task.code} partner {self.work_group.code}"


class Contribution(Reviewed):
    """
    Contribution row: for a task whose owner role is Enable or Support, a group it helps, what it
    delivers, when they need it and their task number. Up to twenty per task. The receiving group's
    leader reviews it.
    """

    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="contributions")
    slot = models.PositiveSmallIntegerField(default=1, validators=[MinValueValidator(1), MaxValueValidator(MAX_ROWS)])
    to_group = models.ForeignKey(WorkGroup, null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    benefit = models.CharField("what we deliver", max_length=300, blank=True)
    needed_when = lookup(LK.NEEDED)
    their_task_ref = models.CharField("their task", max_length=20, blank=True)
    their_task = models.ForeignKey(Task, null=True, blank=True, on_delete=models.SET_NULL, related_name="supported_by")

    class Meta:
        ordering = ["task", "slot"]

    def __str__(self) -> str:
        return f"{self.task.code} helps {self.their_task_ref or (self.to_group and self.to_group.code) or '?'}"


class NotificationState(models.Model):
    """When the person last opened the action centre: items that arrived after it are marked new."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notification_state")
    seen_at = models.DateTimeField(null=True, blank=True)

    def __str__(self) -> str:
        return f"{self.user} saw notifications at {self.seen_at}"
