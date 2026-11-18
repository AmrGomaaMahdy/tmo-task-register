"""
Role names of 1.16: older names are renamed, keeping every user's roles.

    Administrator          -> Admin
    Viewer                 -> Global Viewer
    <CODE> Team            -> <CODE> Team Coordinator
    <CODE> Group Leader    -> <CODE> Team Leader
    (new)                     <CODE> Team Member

Used by migration accounts 0003, by setup_roles (every start) and after a restore, so data from any
earlier version ends up with the new names. Works with the real or the historical (migration) models.
"""

FIXED_RENAMES = {"Administrator": "Admin", "Viewer": "Global Viewer"}
GROUP_RENAMES = ((" Team", " Team Coordinator"), (" Group Leader", " Team Leader"))


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
        for suffix in (" Team Leader", " Team Coordinator", " Team Member"):
            Group.objects.get_or_create(name=f"{code}{suffix}")
    return changed
