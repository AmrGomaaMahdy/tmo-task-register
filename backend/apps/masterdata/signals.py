"""
Each work group has three roles that follow it, created, renamed and removed with it:
"<CODE> Team Leader", "<CODE> Team Coordinator" and "<CODE> Team Member".
"""

from django.contrib.auth.models import Group
from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from apps.accounts.roles import leader_role_name, member_role_name, team_role_name

from .models import WorkGroup


@receiver(pre_save, sender=WorkGroup)
def remember_old_code(sender, instance, **kwargs):
    instance._old_code = (
        WorkGroup.objects.filter(pk=instance.pk).values_list("code", flat=True).first() if instance.pk else None
    )


@receiver(post_save, sender=WorkGroup)
def keep_team_role(sender, instance, created, **kwargs):
    old_code = getattr(instance, "_old_code", None)
    for name_of in (team_role_name, leader_role_name, member_role_name):
        new_name = name_of(instance.code)
        renamed = old_code and old_code != instance.code
        if renamed and Group.objects.filter(name=name_of(old_code)).update(name=new_name):
            continue
        Group.objects.get_or_create(name=new_name)


@receiver(post_delete, sender=WorkGroup)
def remove_team_role(sender, instance, **kwargs):
    names = [team_role_name(instance.code), leader_role_name(instance.code), member_role_name(instance.code)]
    Group.objects.filter(name__in=names).delete()
