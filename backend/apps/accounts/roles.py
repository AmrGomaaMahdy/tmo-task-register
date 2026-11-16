"""
Roles and the rules of who may do what.

Roles are Django groups, so they can be assigned in the admin site or mapped
from Microsoft Entra ID app roles. Every permission decision in the API goes
through the functions below, which keeps the rules in one place and testable.

  Administrator  everything, including users and master data
  TMO Officer    reads every register, includes Ready tasks in the Master Plan,
                 maintains master data
  <CODE> Team    one role per work group (for example "ICT Team", "HR Team"):
                 creates, edits and deletes that group's tasks and their links, and marks them Ready.
                 Sees ONLY its own register in full; of other groups it sees just the shared part
                 (tasks linked to its own by a dependency, contribution or partnership, in a short form).
                 No Master Plan. Created, renamed and removed with the work group; a user may hold several.
  Viewer         reads every register and the Master Plan (for example the Committee)
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover
    from apps.register.models import Task

ADMIN = "Administrator"
TMO = "TMO Officer"
VIEWER = "Viewer"
FIXED_ROLES = [ADMIN, TMO, VIEWER]
TEAM_SUFFIX = " Team"
# Roles from earlier versions; setup_roles removes them (their users were moved by migration accounts 0002).
LEGACY_ROLES = ["Group Lead", "Group Editor"]

DRAFT, NEEDS, READY, IN_PLAN = "draft", "needs_completion", "ready", "in_master_plan"


def team_role_name(work_group_code: str) -> str:
    return f"{work_group_code}{TEAM_SUFFIX}"


def roles_of(user) -> set[str]:
    if not user or not user.is_authenticated:
        return set()
    cached = getattr(user, "_role_cache", None)
    if cached is None:
        cached = set(user.groups.values_list("name", flat=True))
        if user.is_superuser:
            cached.add(ADMIN)
        user._role_cache = cached
    return cached


def team_codes(user) -> set[str]:
    """Codes of the work groups whose team role the user holds."""
    return {name[: -len(TEAM_SUFFIX)] for name in roles_of(user) if name.endswith(TEAM_SUFFIX)}


def work_group_ids(user) -> set[int]:
    """IDs of the work groups whose register the user maintains."""
    if not user or not user.is_authenticated:
        return set()
    cached = getattr(user, "_team_cache", None)
    if cached is None:
        from apps.masterdata.models import WorkGroup

        codes = team_codes(user)
        cached = set(WorkGroup.objects.filter(code__in=codes).values_list("id", flat=True)) if codes else set()
        user._team_cache = cached
    return cached


def is_admin(user) -> bool:
    return ADMIN in roles_of(user)


def is_tmo(user) -> bool:
    return TMO in roles_of(user)


def sees_all(user) -> bool:
    """Administrators, the TMO and viewers read every register; teams see only their own."""
    return bool(roles_of(user) & {ADMIN, TMO, VIEWER})


def can_view_master_plan(user) -> bool:
    return sees_all(user)


def can_manage_master_data(user) -> bool:
    return bool(roles_of(user) & {ADMIN, TMO})


def can_view_audit(user) -> bool:
    return bool(roles_of(user) & {ADMIN, TMO, VIEWER})


def _member(user, work_group: int | None) -> bool:
    return work_group is not None and work_group in work_group_ids(user)


def can_create_task(user, work_group: int | None) -> bool:
    return is_admin(user) or _member(user, work_group)


def can_edit_task(user, task: Task) -> bool:
    """The team edits while it owns the task; once in the Master Plan only the TMO can release it."""
    if is_admin(user):
        return True
    return task.status != IN_PLAN and _member(user, task.work_group_id)


def can_delete_task(user, task: Task) -> bool:
    return can_edit_task(user, task)


def allowed_transitions(user, task: Task) -> list[str]:
    """Statuses the user may move this task to (excluding its current status)."""
    targets: set[str] = set()
    r = roles_of(user)
    if ADMIN in r:
        targets = {DRAFT, NEEDS, READY, IN_PLAN}
    else:
        if TMO in r and task.status in (READY, IN_PLAN):
            targets |= {READY, IN_PLAN}
        if task.status != IN_PLAN and _member(user, task.work_group_id):
            targets |= {DRAFT, NEEDS, READY}
    targets.discard(task.status)
    order = [DRAFT, NEEDS, READY, IN_PLAN]
    return [s for s in order if s in targets]


def sync_team_roles() -> list[str]:
    """Make sure every work group has its team role. Returns the names created."""
    from django.contrib.auth.models import Group

    from apps.masterdata.models import WorkGroup

    created = []
    for code in WorkGroup.objects.values_list("code", flat=True):
        _, made = Group.objects.get_or_create(name=team_role_name(code))
        if made:
            created.append(team_role_name(code))
    return created
