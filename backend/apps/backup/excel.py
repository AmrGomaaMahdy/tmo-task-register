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
from apps.register.models import Activity, Contribution, Task, TaskPartner
from apps.register.services.checks import activity_issues, check_task, is_ok
from apps.register.services.workdays import working_days

HEADER_FILL = PatternFill("solid", fgColor="0D5C70")
HEADER_FONT = Font(bold=True, color="FFFFFF")


# Excel reads a text cell starting with one of these as a formula. Text typed by users (task names, notes)
# could then run a formula when someone opens the export ("CSV / formula injection", OWASP A03).
# openpyxl does the same when it is given such a string, so these cells are written as plain text.
FORMULA_START = ("=", "+", "-", "@", "\t", "\r", "\n", "\uff1d", "\uff0b", "\uff0d", "\uff20")


def as_text(cell) -> None:
    """Store a cell typed by a user as a text value, never a formula (shown exactly as typed)."""
    if isinstance(cell.value, str) and cell.value.startswith(FORMULA_START):
        cell.data_type = "s"


def _v(value):
    if value is None:
        return ""
    if isinstance(value, LookupValue):
        value = value.value
    elif hasattr(value, "code"):
        value = value.code
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
        for cell in ws[ws.max_row]:
            as_text(cell)
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    for i, h in enumerate(headers, start=1):
        ws.column_dimensions[get_column_letter(i)].width = min(max(len(h) + 4, 12), 48)


def _roles(user) -> str:
    return ", ".join(g.name for g in user.groups.all())


REVIEW_HEADERS = ["Leader review", "Review note", "Proposed date", "Reviewed by"]


def _review(row) -> list:
    who = row.reviewed_by
    return [
        row.get_review_display(),
        row.review_note,
        row.review_date,
        (who.get_full_name() or who.get_username()) if who else "",
    ]


def _task_row(t: Task) -> list:
    partners = list(t.partners.all())
    # Up to twenty partners: one cell lists them all, each with its role
    slots = [", ".join(f"{p.work_group.code} ({p.role.value if p.role_id else '?'})" for p in partners)]
    cons = list(t.contributions.all())
    issues = check_task(t)
    return [
        t.code,
        t.work_group,
        t.title,
        t.description,
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
        t.get_approval_display() if t.owner_role_id and t.owner_role.semantic == "direct" else "Reviewed per link",
        "OK" if is_ok(issues) else "\n".join(f"• {i.label}: {i.message}" for i in issues),
    ]


TASK_HEADERS = [
    "Task ID",
    "Work group",
    "Task",
    "Description",
    "Direction",
    "Main workstream",
    "Sub-objective",
    "Owner role",
    "Partner groups (role)",
    "Depends on",
    "Contributions",
    "Contributes to",
    "Planned start",
    "Planned finish",
    "Duration (working days)",
    "Activities",
    "Readiness status",
    "Leader approval",
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

    partners = TaskPartner.objects.select_related("task", "work_group", "role", "needed_when", "reviewed_by").order_by(
        "task__code", "slot"
    )
    _sheet(
        wb,
        "Partners",
        ["Our task", "Partner group", "Role", "What we need", "When needed", "Their task", *REVIEW_HEADERS],
        ([p.task, p.work_group, p.role, p.need, p.needed_when, p.their_task_ref, *_review(p)] for p in partners),
    )
    contributions = Contribution.objects.select_related(
        "task__owner_role", "to_group", "needed_when", "reviewed_by"
    ).order_by("task__code", "slot")
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
            *REVIEW_HEADERS,
        ],
        (
            [c.task, c.slot, c.task.owner_role, c.to_group, c.benefit, c.needed_when, c.their_task_ref, *_review(c)]
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

    groups = WorkGroup.objects.select_related("leader").order_by("code")
    _sheet(
        wb,
        "Work groups",
        ["Code", "Name", "Weight %", "Mission", "Leader", "Active"],
        (
            [w.code, w.name, w.weight, w.mission, w.leader.get_full_name() if w.leader_id else "", w.is_active]
            for w in groups
        ),
    )
    members = (
        GroupMember.objects.select_related("work_group", "user")
        .annotate(n=Count("activities"))
        .order_by("work_group__code", "name")
    )
    _sheet(
        wb,
        "Group members",
        ["Name", "Work group", "Type", "Sign-in account", "Job title", "Email", "Phone", "Active", "Activities"],
        (
            [
                m.name,
                m.work_group,
                m.get_member_type_display(),
                m.user.username if m.user_id else "",
                m.job_title,
                m.email,
                m.phone,
                m.is_active,
                m.n,
            ]
            for m in members
        ),
    )
    directions = Direction.objects.select_related("work_group").order_by("code")
    _sheet(
        wb,
        "Directions",
        ["Code", "Work group", "Title", "Meaning"],
        ([d.code, d.work_group, d.title, d.meaning] for d in directions),
    )
    values = LookupValue.objects.select_related("work_group").order_by("list_key", "sort_order")
    _sheet(
        wb,
        "Lists",
        ["List", "Value", "Work group", "Definition", "Order", "Core value"],
        (
            [
                v.get_list_key_display(),
                v.value,
                v.work_group.code if v.work_group_id else "",
                v.definition,
                v.sort_order,
                v.semantic or "",
            ]
            for v in values
        ),
    )
    users = get_user_model().objects.prefetch_related("groups").order_by("username")
    _sheet(
        wb,
        "Users",
        ["User", "First name", "Last name", "Email", "Active", "Roles", "Last sign-in"],
        ([u.username, u.first_name, u.last_name, u.email, u.is_active, _roles(u), u.last_login] for u in users),
    )

    from apps.core.models import AuditLog

    trail = AuditLog.objects.order_by("-created_at")[:5000]
    _sheet(
        wb,
        "Audit trail",
        ["Time", "User", "Action", "Record type", "Record", "Work group", "Summary", "Changes", "Address"],
        (
            [
                e.created_at,
                e.actor_name or "System",
                e.get_action_display(),
                e.entity,
                e.entity_label,
                e.work_group,
                e.summary,
                "; ".join(f"{k}: {v[0] or '—'} → {v[1] or '—'}" for k, v in (e.changes or {}).items())[:30000],
                e.ip,
            ]
            for e in trail
        ),
    )

    out = BytesIO()
    wb.save(out)
    return out.getvalue()
