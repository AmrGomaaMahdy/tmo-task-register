"""A readable Excel copy of the whole register, laid out like the template's sheets. Not used for restore."""

from __future__ import annotations

from io import BytesIO

from django.contrib.auth import get_user_model
from django.db.models import Count, Prefetch
from django.utils import timezone
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from apps.masterdata.models import Direction, GroupMember, LookupValue, WorkGroup
from apps.register.models import MAX_ROWS, Activity, Contribution, Task, TaskPartner
from apps.register.services.checks import activity_issues, check_task, is_ok
from apps.register.services.workdays import working_days

HEADER_FILL = PatternFill("solid", fgColor="0D5C70")
HEADER_FONT = Font(bold=True, color="FFFFFF")


def _v(value):
    if value is None:
        return ""
    if isinstance(value, LookupValue):
        return value.value
    if hasattr(value, "code"):
        return value.code
    if getattr(value, "tzinfo", None) is not None:
        return timezone.localtime(value).replace(tzinfo=None)
    return value


def _sheet(wb: Workbook, title: str, headers: list[str], rows) -> None:
    ws = wb.create_sheet(title)
    ws.append(headers)
    for cell in ws[1]:
        cell.fill, cell.font = HEADER_FILL, HEADER_FONT
        cell.alignment = Alignment(vertical="center")
    for row in rows:
        ws.append([_v(x) for x in row])
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    for i, h in enumerate(headers, start=1):
        ws.column_dimensions[get_column_letter(i)].width = min(max(len(h) + 4, 12), 48)


def _roles(user) -> str:
    return ", ".join(g.name for g in user.groups.all())


def _task_row(t: Task) -> list:
    partners = list(t.partners.all())
    slots = []
    for i in range(MAX_ROWS):
        p = partners[i] if i < len(partners) else None
        slots += [p.work_group if p else "", p.role if p else ""]
    cons = list(t.contributions.all())
    issues = check_task(t)
    return [
        t.code,
        t.work_group,
        t.title,
        str(t.direction) if t.direction_id else "",
        t.workstream,
        t.sub_objective,
        t.owner_role,
        *slots,
        ", ".join(f"{p.work_group.code} ({p.need})" for p in partners if p.need),
        len(cons),
        ", ".join(f"{c.to_group.code} ({c.their_task_ref or '?'})" for c in cons if c.to_group_id),
        t.planned_start,
        t.planned_finish,
        working_days(t.planned_start, t.planned_finish),
        len(t.activities.all()),
        t.get_status_display(),
        "OK" if is_ok(issues) else "\n".join(f"• {i.label}: {i.message}" for i in issues),
    ]


TASK_HEADERS = [
    "Task ID",
    "Work group",
    "Task",
    "Direction",
    "Main workstream",
    "Sub-objective",
    "Owner role",
    *[h for i in range(1, MAX_ROWS + 1) for h in (f"Partner group {i}", f"Role {i}")],
    "Depends on",
    "Contributions",
    "Contributes to",
    "Planned start",
    "Planned finish",
    "Duration (working days)",
    "Activities",
    "Readiness status",
    "Check",
]


def build_workbook() -> bytes:
    wb = Workbook()
    about = wb.active
    about.title = "About"
    about.append(["Task Register export"])
    about["A1"].font = Font(bold=True, size=14)
    about.append(["Exported", timezone.localtime().replace(tzinfo=None)])
    about.append(
        ["Layout", "Sheets follow the Simplified Task Register: Task Register, Partners, Contributions, Activities."]
    )
    about.append(["Note", "For reading and reporting. To restore data, use the JSON backup file."])
    about.column_dimensions["A"].width = 14
    about.column_dimensions["B"].width = 90

    tasks = (
        Task.objects.select_related("work_group", "direction", "workstream", "sub_objective", "owner_role")
        .prefetch_related(
            Prefetch("partners", queryset=TaskPartner.objects.select_related("work_group", "role")),
            Prefetch("activities", queryset=Activity.objects.prefetch_related("predecessors__task")),
            Prefetch("contributions", queryset=Contribution.objects.select_related("to_group")),
        )
        .order_by("code")
    )
    _sheet(wb, "Task Register", TASK_HEADERS, (_task_row(t) for t in tasks))

    partners = TaskPartner.objects.select_related("task", "work_group", "role", "needed_when").order_by(
        "task__code", "slot"
    )
    _sheet(
        wb,
        "Partners",
        ["Our task", "Partner group", "Role", "What we need", "When needed", "Their task"],
        ([p.task, p.work_group, p.role, p.need, p.needed_when, p.their_task_ref] for p in partners),
    )
    contributions = Contribution.objects.select_related("task__owner_role", "to_group", "needed_when").order_by(
        "task__code", "slot"
    )
    _sheet(
        wb,
        "Contributions",
        [
            "Our task",
            "No.",
            "Owner role",
            "Group we enable / support",
            "What we deliver",
            "When they need it",
            "Their task",
        ],
        (
            [c.task, c.slot, c.task.owner_role, c.to_group, c.benefit, c.needed_when, c.their_task_ref]
            for c in contributions
        ),
    )

    activities = (
        Activity.objects.select_related("task__work_group", "owner__work_group")
        .prefetch_related("predecessors__task")
        .order_by("task__code", "order")
    )
    _sheet(
        wb,
        "Activities",
        [
            "Task",
            "Activity ID",
            "Activity",
            "Owner",
            "Owner work group",
            "Start",
            "Finish",
            "Duration (working days)",
            "Predecessors",
            "Check",
        ],
        (
            [
                a.task,
                a.code,
                a.name,
                a.owner.name if a.owner_id else "",
                a.owner.work_group.code if a.owner_id else "",
                a.start_date,
                a.finish_date,
                working_days(a.start_date, a.finish_date),
                ", ".join(p.code for p in a.predecessors.all()),
                "\n".join(activity_issues(a, a.task.planned_start, a.task.planned_finish)) or "OK",
            ]
            for a in activities
        ),
    )

    groups = WorkGroup.objects.order_by("code")
    _sheet(wb, "Work groups", ["Code", "Name", "Active"], ([w.code, w.name, w.is_active] for w in groups))
    members = (
        GroupMember.objects.select_related("work_group")
        .annotate(n=Count("activities"))
        .order_by("work_group__code", "name")
    )
    _sheet(
        wb,
        "Group members",
        ["Name", "Work group", "Active", "Activities"],
        ([m.name, m.work_group, m.is_active, m.n] for m in members),
    )
    directions = Direction.objects.select_related("work_group").order_by("code")
    _sheet(
        wb,
        "Directions",
        ["Code", "Work group", "Title", "Meaning"],
        ([d.code, d.work_group, d.title, d.meaning] for d in directions),
    )
    values = LookupValue.objects.order_by("list_key", "sort_order")
    _sheet(
        wb,
        "Lists",
        ["List", "Value", "Definition", "Order", "Core value"],
        ([v.get_list_key_display(), v.value, v.definition, v.sort_order, v.semantic or ""] for v in values),
    )
    users = get_user_model().objects.prefetch_related("groups").order_by("username")
    _sheet(
        wb,
        "Users",
        ["User", "First name", "Last name", "Email", "Active", "Roles", "Last sign-in"],
        ([u.username, u.first_name, u.last_name, u.email, u.is_active, _roles(u), u.last_login] for u in users),
    )

    out = BytesIO()
    wb.save(out)
    return out.getvalue()
