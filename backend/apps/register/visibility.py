"""
Row-level visibility for team users.

Administrators, the TMO and viewers see everything. A team user (one or more "<CODE> Team" roles) sees:

* the full register of their own work group(s);
* of other work groups, only what is shared with their own group: the other group's tasks that
  are linked to theirs (a partner row either way, a contribution either way),
  shown in a short form, and those link rows themselves.

Every list and detail endpoint goes through these functions, so the rule holds for the API, not just the screens.
"""

from __future__ import annotations

from django.db.models import Q, QuerySet

from apps.accounts import roles

from .models import Activity, Contribution, Task, TaskPartner


def my_groups(user) -> set[int]:
    return roles.work_group_ids(user)


def tasks(user, qs: QuerySet[Task]) -> QuerySet[Task]:
    """Tasks shown in full (register, summaries, edit)."""
    return qs if roles.sees_all(user) else qs.filter(work_group__in=my_groups(user))


def shared_tasks_q(groups: set[int]) -> Q:
    """Other groups' tasks that have something in common with the given groups."""
    return (
        Q(partners__work_group__in=groups)
        | Q(partners__their_task__work_group__in=groups)
        | Q(needed_by__task__work_group__in=groups)
        | Q(contributions__to_group__in=groups)
        | Q(contributions__their_task__work_group__in=groups)
        | Q(supported_by__task__work_group__in=groups)
    )


def is_shared_with(user, task: Task) -> bool:
    groups = my_groups(user)
    return bool(groups) and Task.objects.filter(shared_tasks_q(groups), pk=task.pk).exists()


def contributions(user, qs: QuerySet[Contribution]) -> QuerySet[Contribution]:
    if roles.sees_all(user):
        return qs
    g = my_groups(user)
    return qs.filter(Q(task__work_group__in=g) | Q(to_group__in=g) | Q(their_task__work_group__in=g))


def partners(user, qs: QuerySet[TaskPartner]) -> QuerySet[TaskPartner]:
    if roles.sees_all(user):
        return qs
    g = my_groups(user)
    return qs.filter(Q(task__work_group__in=g) | Q(work_group__in=g) | Q(their_task__work_group__in=g))


def activities(user, qs: QuerySet[Activity]) -> QuerySet[Activity]:
    """Activities are a task's internal plan: own group only."""
    return qs if roles.sees_all(user) else qs.filter(task__work_group__in=my_groups(user))
