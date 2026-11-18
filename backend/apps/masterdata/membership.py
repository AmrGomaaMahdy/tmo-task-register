"""
A group member's type and their sign-in account's role, kept in step.

A member row (Configuration → Group members) can be linked to a user account. Its type then decides the
account's role for that group:

    Leader       -> "<CODE> Team Leader"        (and the work group's leader; one per group)
    Coordinator  -> "<CODE> Team Coordinator"
    Member       -> "<CODE> Team Member"

Changing the type changes the role; unlinking or deleting the row removes the account's roles for that
group. When the group's leader changes elsewhere (Configuration → Work groups, or the role in the admin
site), apps/masterdata/leaders.py calls after_leader_set(): the new leader's row becomes "Leader" and the
previous leader's row becomes "Member".
"""

from __future__ import annotations

from django.contrib.auth.models import Group
from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from apps.accounts.roles import group_role_names, leader_role_name, member_role_name, team_role_name

from .models import GroupMember, WorkGroup

ROLE_OF = {
    GroupMember.MemberType.LEADER: leader_role_name,
    GroupMember.MemberType.COORDINATOR: team_role_name,
    GroupMember.MemberType.MEMBER: member_role_name,
}


def _paused() -> bool:
    from . import leaders

    return leaders._busy()


def _roles(code: str) -> list[Group]:
    return [Group.objects.get_or_create(name=n)[0] for n in group_role_names(code)]


def set_group_role(user, work_group: WorkGroup, member_type: str | None) -> None:
    """Give the user exactly one role of this group (or none), and keep the group's leader in step."""
    from . import leaders

    if user is None:
        return
    leaders._state.busy = True  # the roles are set here in full; the leader handler need not react
    try:
        user.groups.remove(*_roles(work_group.code))
        if member_type:
            user.groups.add(Group.objects.get_or_create(name=ROLE_OF[member_type](work_group.code))[0])
        current = WorkGroup.objects.filter(pk=work_group.pk).values_list("leader_id", flat=True).first()
        if member_type == GroupMember.MemberType.LEADER and current != user.pk:
            WorkGroup.objects.filter(pk=work_group.pk).update(leader=user)
            leader_role = Group.objects.get_or_create(name=leader_role_name(work_group.code))[0]
            leader_role.user_set.set([user])  # one leader per group: the previous one loses the role
            after_leader_set(work_group, user)
        elif member_type != GroupMember.MemberType.LEADER and current == user.pk:
            WorkGroup.objects.filter(pk=work_group.pk).update(leader=None)
            after_leader_set(work_group, None)
    finally:
        leaders._state.busy = False
    for attr in ("_role_cache", "_lead_cache", "_team_cache", "_member_cache"):
        user.__dict__.pop(attr, None)


def after_leader_set(group: WorkGroup, user) -> None:
    """The group's leader is now `user` (or nobody): update the member rows to match."""
    rows = GroupMember.objects.filter(work_group=group)
    for row in rows.filter(member_type=GroupMember.MemberType.LEADER).exclude(user=user).exclude(user=None):
        row.user.groups.add(Group.objects.get_or_create(name=member_role_name(group.code))[0])
    rows.filter(member_type=GroupMember.MemberType.LEADER).exclude(user=user).update(
        member_type=GroupMember.MemberType.MEMBER
    )
    if user is not None:
        rows.filter(user=user).update(member_type=GroupMember.MemberType.LEADER)


@receiver(pre_save, sender=GroupMember)
def _remember(sender, instance, **kwargs):
    old = GroupMember.objects.filter(pk=instance.pk).values("user_id", "member_type").first() if instance.pk else None
    instance._old = old or {}


@receiver(post_save, sender=GroupMember)
def _member_saved(sender, instance, created, raw=False, **kwargs):
    if raw or _paused():
        return
    old = getattr(instance, "_old", {}) or {}
    User = type(instance).user.field.related_model
    if old.get("user_id") and old.get("user_id") != instance.user_id:
        set_group_role(User.objects.filter(pk=old["user_id"]).first(), instance.work_group, None)
    if instance.user_id and (
        created or old.get("user_id") != instance.user_id or old.get("member_type") != instance.member_type
    ):
        set_group_role(instance.user, instance.work_group, instance.member_type)


@receiver(post_delete, sender=GroupMember)
def _member_deleted(sender, instance, **kwargs):
    if _paused() or not instance.user_id:
        return
    set_group_role(instance.user, instance.work_group, None)
