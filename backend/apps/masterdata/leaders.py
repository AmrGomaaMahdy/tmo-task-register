"""
Work group leaders: the "<CODE> Team Leader" role and the work group's leader field, kept in step.

The role decides permissions (apps/accounts/roles.py). It can be given in two places:
- Configuration → Work groups → Leader (sets WorkGroup.leader): the chosen user gets the role, and the
  previous leader loses it;
- the Django admin site or Microsoft Entra ID (adds the role to a user): that user becomes the group's
  leader, and the previous holder loses the role.

So each work group has at most one leader, and the field and the role always agree. While a backup is
being restored, the data is loaded as saved and sync_all() puts the two in step afterwards.
"""

from __future__ import annotations

import threading

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db.models.signals import m2m_changed, post_save, pre_save
from django.dispatch import receiver

from apps.accounts.roles import LEADER_SUFFIX, leader_role_name

from .models import WorkGroup

_state = threading.local()


def _busy() -> bool:
    return getattr(_state, "busy", False) or getattr(_state, "paused", False)


class paused:
    """Context manager: no syncing (used while a backup is restored)."""

    def __enter__(self):
        _state.paused = True

    def __exit__(self, *exc):
        _state.paused = False


def _set_role_members(group: WorkGroup, user) -> None:
    from .membership import after_leader_set

    role, _ = Group.objects.get_or_create(name=leader_role_name(group.code))
    _state.busy = True
    try:
        role.user_set.set([user] if user is not None else [])
        after_leader_set(group, user)
    finally:
        _state.busy = False


def _set_field(group: WorkGroup, user) -> None:
    WorkGroup.objects.filter(pk=group.pk).update(leader=user)


def sync_all() -> None:
    """The work group's leader field wins: its role holds exactly that user (or nobody)."""
    for group in WorkGroup.objects.select_related("leader"):
        _set_role_members(group, group.leader)


@receiver(pre_save, sender=WorkGroup)
def _remember_leader(sender, instance, **kwargs):
    instance._old_leader_id = (
        WorkGroup.objects.filter(pk=instance.pk).values_list("leader_id", flat=True).first() if instance.pk else None
    )


@receiver(post_save, sender=WorkGroup)
def _leader_field_changed(sender, instance, created, raw=False, **kwargs):
    if raw or _busy():
        return
    if created or getattr(instance, "_old_leader_id", None) != instance.leader_id:
        _set_role_members(instance, instance.leader)


def _code_of(role_name: str) -> str | None:
    return role_name[: -len(LEADER_SUFFIX)] if role_name.endswith(LEADER_SUFFIX) else None


@receiver(m2m_changed, sender=get_user_model().groups.through)
def _leader_role_changed(sender, instance, action, reverse, pk_set, **kwargs):
    """A leader role given or taken away (admin site, Entra ID, a script): update the work group."""
    if _busy() or action not in ("post_add", "post_remove", "post_clear"):
        return
    User = get_user_model()
    if action == "post_clear":
        # The affected roles are unknown after a clear: re-read every group's leader from its role.
        changes = [(g, None) for g in WorkGroup.objects.all()]
    elif not reverse:  # user.groups.add/remove(role, ...)
        roles = Group.objects.filter(pk__in=pk_set or [])
        changes = [(code, instance) for code in (_code_of(r.name) for r in roles) if code]
    else:  # role.user_set.add/remove(user, ...)
        code = _code_of(instance.name)
        changes = [(code, u) for u in User.objects.filter(pk__in=pk_set or [])] if code else []
    for target, user in changes:
        group = target if isinstance(target, WorkGroup) else WorkGroup.objects.filter(code=target).first()
        if group is None:
            continue
        holders = list(User.objects.filter(groups__name=leader_role_name(group.code)).order_by("pk"))
        if action == "post_add":
            # The newly given role makes that user the leader; nobody else keeps it.
            _set_field(group, user)
            _set_role_members(group, user)
        elif group.leader_id not in {u.pk for u in holders}:
            # The leader lost the role: the group has no leader (or the remaining holder, if any).
            new = holders[0] if holders else None
            _set_field(group, new)
            _set_role_members(group, new)
