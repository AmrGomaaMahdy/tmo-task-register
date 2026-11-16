"""Each work group has a team role ("<CODE> Team") that follows it: created, renamed and removed with it."""

from django.contrib.auth.models import Group
from django.db.models.signals import post_delete, post_save, pre_save
from django.dispatch import receiver

from apps.accounts.roles import team_role_name

from .models import WorkGroup


@receiver(pre_save, sender=WorkGroup)
def remember_old_code(sender, instance, **kwargs):
    instance._old_code = (
        WorkGroup.objects.filter(pk=instance.pk).values_list("code", flat=True).first() if instance.pk else None
    )


@receiver(post_save, sender=WorkGroup)
def keep_team_role(sender, instance, created, **kwargs):
    new_name = team_role_name(instance.code)
    old_code = getattr(instance, "_old_code", None)
    if old_code and old_code != instance.code:
        renamed = Group.objects.filter(name=team_role_name(old_code)).update(name=new_name)
        if renamed:
            return
    Group.objects.get_or_create(name=new_name)


@receiver(post_delete, sender=WorkGroup)
def remove_team_role(sender, instance, **kwargs):
    Group.objects.filter(name=team_role_name(instance.code)).delete()
