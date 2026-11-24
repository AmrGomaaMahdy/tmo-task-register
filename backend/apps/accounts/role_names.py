"""
Role names: older names are renamed, keeping every user's roles.

    Administrator              -> Admin                         (1.16)
    Viewer                     -> Global Viewer                 (1.16)
    <CODE> Team                -> <CODE> Team Focal Point       (1.16 named it Team Coordinator)
    <CODE> Team Coordinator    -> <CODE> Team Focal Point       (1.19)
    <CODE> Group Leader        -> <CODE> Team Leader            (1.16)
    (new)                         <CODE> Team Member            (1.16)

Used by migrations accounts 0003 and 0004, by setup_roles (every start) and after a restore, so data from
any earlier version ends up with the current names. Works with the real or the historical (migration) models.
"""

FIXED_RENAMES = {"Administrator": "Admin", "Viewer": "Global Viewer"}
GROUP_RENAMES = (
    (" Team Coordinator", " Team Focal Point"),
    (" Team", " Team Focal Point"),
    (" Group Leader", " Team Leader"),
)


def _move(Group, old_name: str, new_name: str) -> bool:
    old = Group.objects.filter(name=old_name).first()
    if old is None:
        return False
    new = Group.objects.filter(name=new_name).first()
    if new is None:
        old.name = new_name
        old.save(update_fields=["name"])
    else:  # both exist: give the users the new role, then drop the old one
        new.user_set.add(*old.user_set.all())
        old.delete()
    return True


def upgrade_role_names(Group, WorkGroup) -> list[str]:
    """Rename old roles and create the missing group roles. Returns what changed, for the log."""
    changed = []
    for old, new in FIXED_RENAMES.items():
        if _move(Group, old, new):
            changed.append(f"{old} -> {new}")
    for code in WorkGroup.objects.values_list("code", flat=True):
        for old_suffix, new_suffix in GROUP_RENAMES:
            if _move(Group, f"{code}{old_suffix}", f"{code}{new_suffix}"):
                changed.append(f"{code}{old_suffix} -> {code}{new_suffix}")
        for suffix in (" Team Leader", " Team Focal Point", " Team Member"):
            Group.objects.get_or_create(name=f"{code}{suffix}")
    return changed
