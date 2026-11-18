"""
Save-time rules for the register's data fields. The API refuses data that breaks them; the automatic check
(services/checks.py) still reports what is incomplete. Dates follow one rule everywhere: a finish is on or
after its start, every date sits in the register's date range, and an activity stays inside its task's
planned start and finish (and starts after its predecessors finish).
"""

from datetime import date

from django.conf import settings

from .services.checks import TASK_NUMBER


def date_range() -> tuple[date, date]:
    return date.fromisoformat(settings.REGISTER_DATE_MIN), date.fromisoformat(settings.REGISTER_DATE_MAX)


def out_of_range(value: date | None, label: str) -> str | None:
    lo, hi = date_range()
    if value and not lo <= value <= hi:
        return f"{label} must be between {lo.isoformat()} and {hi.isoformat()}."
    return None


def clean_text(value: str, label: str, minimum: int) -> str:
    """Trimmed text with real words: at least `minimum` characters and one letter."""
    from rest_framework import serializers

    value = " ".join((value or "").split())
    if len(value) < minimum or not any(ch.isalpha() for ch in value):
        raise serializers.ValidationError(f"{label} needs at least {minimum} characters, with words.")
    return value


def task_ref_problem(ref: str) -> str | None:
    if ref and not TASK_NUMBER.match(ref):
        return "write their task number like HR-T012"
    return None


def task_date_problems(start: date | None, finish: date | None, task=None, dates_changed: bool = False) -> dict:
    """Planned start and finish of a task; when they change, they must still hold all of its activities."""
    out: dict[str, str] = {}
    for field, value, label in (
        ("planned_start", start, "Planned start"),
        ("planned_finish", finish, "Planned finish"),
    ):
        problem = out_of_range(value, label)
        if problem:
            out[field] = problem
    if start and finish and finish < start:
        out.setdefault("planned_finish", "Planned finish must be on or after the planned start.")
    if out or task is None or not task.pk or not dates_changed:
        return out
    acts = list(task.activities.all())
    if not acts:
        return out
    if not start or not finish:
        field = "planned_start" if not start else "planned_finish"
        out[field] = f"This task has {len(acts)} activities, so it needs both planned dates."
        return out
    early = sorted((a for a in acts if a.start_date < start), key=lambda a: a.start_date)
    late = sorted((a for a in acts if a.finish_date > finish), key=lambda a: a.finish_date, reverse=True)
    if early:
        codes = ", ".join(a.code for a in early)
        out["planned_start"] = (
            f"Activities {codes} start before this date (the first on {early[0].start_date.isoformat()}). "
            "Move them, or pick an earlier planned start."
        )
    if late:
        codes = ", ".join(a.code for a in late)
        out["planned_finish"] = (
            f"Activities {codes} finish after this date (the last on {late[0].finish_date.isoformat()}). "
            "Move them, or pick a later planned finish."
        )
    return out


def activity_date_problems(start: date, finish: date, task, predecessors, activity=None) -> dict:
    """An activity's dates: inside its task's planned dates, after its predecessors, before its successors."""
    out: dict[str, str] = {}
    for field, value, label in (("start_date", start, "Start"), ("finish_date", finish, "Finish")):
        problem = out_of_range(value, label)
        if problem:
            out[field] = problem
    if start and finish and finish < start:
        out.setdefault("finish_date", "Finish must be on or after start.")
    if out:
        return out
    if not task.planned_start or not task.planned_finish:
        out["start_date"] = "Set the task's planned start and finish first: activities must fit inside them."
        return out
    if start < task.planned_start:
        out["start_date"] = f"Start must be on or after the task's planned start ({task.planned_start.isoformat()})."
    if finish > task.planned_finish:
        out["finish_date"] = (
            f"Finish must be on or before the task's planned finish ({task.planned_finish.isoformat()})."
        )
    if out:
        return out
    for p in predecessors:
        if activity is not None and p.pk == activity.pk:
            continue
        if start <= p.finish_date:
            out["start_date"] = f"Start must be after predecessor {p.code} finishes ({p.finish_date.isoformat()})."
            return out
    if activity is not None and activity.pk:
        for s in activity.successors.all().order_by("start_date"):
            if s.start_date <= finish:
                out["finish_date"] = (
                    f"{s.code} follows this activity and starts on {s.start_date.isoformat()}, "
                    "so this one must finish before then."
                )
                break
    return out
