"""
The automatic check, following sheet 5 (Check) of the Simplified Task Register.

It checks one task row together with its partner rows (what we need from each partner group),
its contribution rows (what an Enable / Support task delivers to other groups) and its activities.

"error"   must be fixed (red in the app)
"warning" still to complete before the task can be Ready to include (amber)
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from datetime import date

from apps.masterdata.models import LookupValue

S = LookupValue.Semantic
DRAFT, NEEDS, READY, IN_PLAN = "draft", "needs_completion", "ready", "in_master_plan"

LABELS = {
    "title": "Task",
    "direction": "Direction",
    "workstream": "Main workstream",
    "sub_objective": "Sub-objective",
    "owner_role": "Owner role",
    "planned_start": "Planned start",
    "planned_finish": "Planned finish",
    "status": "Readiness status",
    "contribution": "Contributions",
    "activities": "Activities",
}
REQUIRED = ("title", "direction", "workstream", "owner_role")
BEFORE_READY = ("planned_start", "planned_finish")
TASK_NUMBER = re.compile(r"^([A-Z]{2,5})-T\d{3}$")
LINKS_OUT = (S.ENABLE, S.SUPPORT)
MAX_ROWS = 5


@dataclass(frozen=True)
class Issue:
    field: str
    label: str
    message: str
    level: str  # "error" | "warning"

    def as_dict(self) -> dict:
        return asdict(self)


@dataclass
class PartnerData:
    """A partner row, saved or as typed in the form."""

    slot: int
    group_id: int | None
    group_code: str
    role_id: int | None
    need: str
    needed_when_id: int | None
    their_task_ref: str


@dataclass
class ContributionData:
    """A contribution row, saved or as typed in the form."""

    slot: int
    group_id: int | None
    group_code: str
    benefit: str
    needed_when_id: int | None
    their_task_ref: str


def their_task_problem(ref: str, group_code: str) -> str | None:
    """Their task must be a task number of that group, written like HR-T012."""
    match = TASK_NUMBER.match((ref or "").strip())
    if not match or match.group(1) != group_code:
        return f"Their task must be a task number of {group_code}, written like {group_code}-T012"
    return None


def partner_issues(p: PartnerData, own_group_id: int) -> list[str]:
    out: list[str] = []
    if not p.role_id:
        out.append(f"Role {p.slot} is empty: choose Enable or Support for partner group {p.group_code}")
    if p.group_id == own_group_id:
        out.append("A partner must be another work group")
    if not (p.need or "").strip() and not p.needed_when_id and not (p.their_task_ref or "").strip():
        out.append("Partner details missing: fill in what we need, when and their task")
        return out
    if not (p.need or "").strip():
        out.append("What we need is empty: name the output we need from them")
    if not p.needed_when_id:
        out.append("When needed is empty: Before start or During execution")
    if not (p.their_task_ref or "").strip():
        out.append("Their task is empty: write the task number agreed with the group")
    elif problem := their_task_problem(p.their_task_ref, p.group_code):
        out.append(problem)
    return out


def contribution_issues(c: ContributionData | None, own_group_id: int) -> list[str]:
    if c is None:
        return ["Add at least one contribution: the group we help, what we deliver, when and their task"]
    out: list[str] = []
    if not c.group_id:
        out.append("Group is empty: pick the group we enable or support")
    elif c.group_id == own_group_id:
        out.append("Group must be another work group")
    if not (c.benefit or "").strip():
        out.append("What we deliver is empty: describe the output or service")
    if not c.needed_when_id:
        out.append("When they need it is empty: Before start or During execution of their task")
    if not (c.their_task_ref or "").strip():
        out.append("Their task is empty: write the task number agreed with the group")
    elif c.group_id and (problem := their_task_problem(c.their_task_ref, c.group_code)):
        out.append(problem)
    return out


def activity_issues(a, task_start: date | None, task_finish: date | None) -> list[str]:
    """The rules of sheet 4 (Activities) for one saved activity."""
    out: list[str] = []
    if a.finish_date < a.start_date:
        out.append("Finish is before Start")
    owner = a.owner if a.owner_id else None
    if owner is not None and owner.work_group_id != a.task.work_group_id:
        group, own = owner.work_group.code, a.task.work_group.code
        out.append(f"Owner {owner.name} is a member of {group}, not {own}: pick a member of {own}")
    if task_start and a.start_date < task_start:
        out.append("Start is before the task's planned start")
    if task_finish and a.finish_date > task_finish:
        out.append("Finish is after the task's planned finish")
    for p in sorted(a.predecessors.all(), key=lambda x: x.order):
        if p.pk == a.pk:
            out.append("A predecessor is this activity itself")
        elif p.task_id != a.task_id:
            out.append(f"Predecessor {p.code} belongs to another task: only activities of the same task")
        elif a.start_date <= p.finish_date:
            out.append(f"Start is not after the finish of predecessor {p.code}")
    return out


def partners_of(task) -> list[PartnerData]:
    if not task.pk:
        return []
    return [
        PartnerData(p.slot, p.work_group_id, p.work_group.code, p.role_id, p.need, p.needed_when_id, p.their_task_ref)
        for p in task.partners.all()
    ]


def contributions_of(task) -> list[ContributionData]:
    if not task.pk:
        return []
    return [
        ContributionData(
            c.slot,
            c.to_group_id,
            c.to_group.code if c.to_group_id else "",
            c.benefit,
            c.needed_when_id,
            c.their_task_ref,
        )
        for c in task.contributions.all()
    ]


def links_out(task) -> bool:
    return bool(task.owner_role_id) and task.owner_role.semantic in LINKS_OUT


def check_task(
    task, partners: list[PartnerData] | None = None, contributions: list[ContributionData] | None = None
) -> list[Issue]:
    """
    Run every rule. The form passes `partners` and `contributions` as typed; a list left as None
    is read from the saved task.
    """
    issues: list[Issue] = []

    def add(field: str, message: str, level: str = "error", label: str | None = None) -> None:
        issues.append(Issue(field, label or LABELS.get(field, field), message, level))

    def empty(field: str) -> bool:
        if hasattr(task, f"{field}_id"):
            return getattr(task, f"{field}_id") is None
        value = getattr(task, field)
        return value is None or (isinstance(value, str) and not value.strip())

    for f in REQUIRED:
        if empty(f):
            add(f, f"{LABELS[f]} is empty (required)")
    if task.status == DRAFT:
        add("status", "Readiness status is not set (required)")

    ready = task.status in (READY, IN_PLAN)
    for f in BEFORE_READY:
        if empty(f):
            if ready:
                add(f, f'{LABELS[f]} is required before "Ready to include"')
            else:
                add(f, f'{LABELS[f]} is needed before the task can be "Ready to include"', "warning")

    if task.direction_id and task.direction.work_group_id != task.work_group_id:
        add("direction", "The direction belongs to another work group")
    if task.planned_start and task.planned_finish and task.planned_finish < task.planned_start:
        add("planned_finish", "Planned finish is before the planned start")

    from_form = partners is not None
    rows = partners_of(task) if partners is None else partners
    if len(rows) > MAX_ROWS:
        add("partners", f"A task can have up to {MAX_ROWS} partner groups", label="Partners")
    seen: set[int] = set()
    for p in rows:
        label = f"Partner group {p.slot}"
        if p.group_id in seen:
            add(f"partner_{p.slot}", f"{p.group_code} is named twice: name each partner once", label=label)
        seen.add(p.group_id)
        for message in partner_issues(p, task.work_group_id):
            add(f"partner_{p.slot}", f"Partner {p.group_code}: {message}", label=label)

    if links_out(task):
        cons = contributions_of(task) if contributions is None else contributions
        if len(cons) > MAX_ROWS:
            add("contribution", f"A task can have up to {MAX_ROWS} contributions")
        if not cons:
            add(
                "contribution",
                f"Owner role is {task.owner_role.value}: add at least one contribution "
                "(the group we help, what we deliver, when and their task)",
            )
        for c in cons:
            to = f" to {c.group_code}" if c.group_code else ""
            for message in contribution_issues(c, task.work_group_id):
                add(f"contribution_{c.slot}", f"Contribution {c.slot}{to}: {message}", label=f"Contribution {c.slot}")

    if task.pk and not from_form:
        for a in task.activities.all():
            for message in activity_issues(a, task.planned_start, task.planned_finish):
                add("activities", f"{a.code}: {message}")
    return issues


def is_ok(issues: list[Issue]) -> bool:
    return not any(i.level == "error" or (i.level == "warning" and i.field in BEFORE_READY) for i in issues)


def summary(issues: list[Issue]) -> dict:
    return {
        "errors": sum(1 for i in issues if i.level == "error"),
        "warnings": sum(1 for i in issues if i.level == "warning"),
        "ok": is_ok(issues),
    }
