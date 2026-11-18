"""
Roles and the rules of who may do what.

Roles are Django groups, so they can be assigned in the admin site or mapped
from Microsoft Entra ID app roles. Every permission decision in the API goes
through the functions below, which keeps the rules in one place and testable.

  Admin           everything, including users and master data
  TMO Officer     reads every register, includes Ready tasks in the Master Plan, maintains master data
  Global Viewer   reads every register and the Master Plan (for example the Committee)

  Three roles per work group, created, renamed and removed with it (a user may hold roles of several groups):
  <CODE> Team Leader       one holder per group (for example "HR Team Leader"). Full control of the
                           group's register (as the coordinator), plus governance:
                           - the group's own Direct tasks: approve, reject, ask to clarify, or remove them;
                           - other groups' Direct and Enable / Support tasks that involve the group (their
                             partner rows naming it, their contributions to it): approve, reject, ask to
                             clarify, change the timeline, or remove the link from their task;
                           - the group's member list (types and contact details).
                           Kept in step with Configuration → Work groups → Leader (apps/masterdata/leaders.py).
  <CODE> Team Coordinator  creates, edits and deletes the group's tasks and their links, and marks them Ready.
  <CODE> Team Member       reads the group's whole register; changes nothing.

  Every group role sees ONLY its own register in full; of other groups it sees just the shared part
  (tasks linked to its own by a partner row or a contribution, in a short form). No Master Plan.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover
    from apps.register.models import Task

ADMIN = "Admin"
TMO = "TMO Officer"
VIEWER = "Global Viewer"
FIXED_ROLES = [ADMIN, TMO, VIEWER]
LEADER_SUFFIX = " Team Leader"
TEAM_SUFFIX = " Team Coordinator"  # the role that maintains a register ("HR Team" before 1.16)
MEMBER_SUFFIX = " Team Member"
GROUP_SUFFIXES = (LEADER_SUFFIX, TEAM_SUFFIX, MEMBER_SUFFIX)
# Roles from earlier versions; setup_roles removes them (their users were moved by migrations).
LEGACY_ROLES = ["Group Lead", "Group Editor"]

DRAFT, NEEDS, READY, IN_PLAN = "draft", "needs_completion", "ready", "in_master_plan"


def team_role_name(work_group_code: str) -> str:
    return f"{work_group_code}{TEAM_SUFFIX}"


def leader_role_name(work_group_code: str) -> str:
    return f"{work_group_code}{LEADER_SUFFIX}"


def member_role_name(work_group_code: str) -> str:
    return f"{work_group_code}{MEMBER_SUFFIX}"


def group_role_names(work_group_code: str) -> list[str]:
    """The three roles of a work group: leader, coordinator, member."""
    return [leader_role_name(work_group_code), team_role_name(work_group_code), member_role_name(work_group_code)]


def _ids_for(user, suffix: str, attr: str) -> set[int]:
    if not user or not user.is_authenticated:
        return set()
    cached = getattr(user, attr, None)
    if cached is None:
        from apps.masterdata.models import WorkGroup

        codes = {name[: -len(suffix)] for name in roles_of(user) if name.endswith(suffix)}
        cached = set(WorkGroup.objects.filter(code__in=codes).values_list("id", flat=True)) if codes else set()
        setattr(user, attr, cached)
    return cached


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


def led_group_ids(user) -> set[int]:
    """IDs of the work groups the user leads (their "<CODE> Team Leader" roles)."""
    return _ids_for(user, LEADER_SUFFIX, "_lead_cache")


def is_leader(user) -> bool:
    return bool(led_group_ids(user))


def team_codes(user) -> set[str]:
    """Codes of the work groups whose coordinator role the user holds."""
    return {name[: -len(TEAM_SUFFIX)] for name in roles_of(user) if name.endswith(TEAM_SUFFIX)}


def work_group_ids(user) -> set[int]:
    """IDs of the work groups whose register the user maintains: coordinator or leader."""
    return _ids_for(user, TEAM_SUFFIX, "_team_cache") | led_group_ids(user)


def member_group_ids(user) -> set[int]:
    """IDs of the work groups the user reads as a Team Member (read-only)."""
    return _ids_for(user, MEMBER_SUFFIX, "_member_cache")


def view_group_ids(user) -> set[int]:
    """IDs of the work groups whose register the user reads in full: leader, coordinator or member."""
    return work_group_ids(user) | member_group_ids(user)


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


def can_approve_task(user, task: Task) -> bool:
    """The group's leader (or an administrator) decides on the group's Direct tasks."""
    from apps.masterdata.models import LookupValue

    if not (task.owner_role_id and task.owner_role.semantic == LookupValue.Semantic.DIRECT):
        return False
    return is_admin(user) or task.work_group_id in led_group_ids(user)


def can_review_link(user, group_id: int | None) -> bool:
    """The leader of the group a link points to (or an administrator) reviews it."""
    return group_id is not None and (is_admin(user) or group_id in led_group_ids(user))


def can_remove_link(user, group_id: int | None, task: Task) -> bool:
    """
    The leader of the group a link names (or an administrator) may take the link out of the other group's
    task, while that task is not yet in the Master Plan (the TMO releases it first).
    """
    return can_review_link(user, group_id) and task.status != IN_PLAN


def can_view_governance(user) -> bool:
    return is_leader(user) or sees_all(user)


def sync_team_roles() -> list[str]:
    """Make sure every work group has its three roles. Returns the names created."""
    from django.contrib.auth.models import Group

    from apps.masterdata.models import WorkGroup

    created = []
    for code in WorkGroup.objects.values_list("code", flat=True):
        for name in group_role_names(code):
            _, made = Group.objects.get_or_create(name=name)
            if made:
                created.append(name)
    return created
