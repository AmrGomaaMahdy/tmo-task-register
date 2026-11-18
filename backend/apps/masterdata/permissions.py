from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.accounts.roles import can_manage_master_data, led_group_ids


class MemberPermission(BasePermission):
    """
    Group members: Admins and the TMO change any group's members; a Team Leader changes the members of the
    group they lead (types and contact details), but does not pick the leader or link sign-in accounts.
    """

    message = "Only Admins, the TMO and the group's Team Leader can change its members."

    def has_permission(self, request, view) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS or can_manage_master_data(request.user):
            return True
        if not led_group_ids(request.user):
            return False
        if request.method == "POST":
            wg = request.data.get("work_group")
            return str(wg).isdigit() and int(wg) in led_group_ids(request.user)
        return True

    def has_object_permission(self, request, view, obj) -> bool:
        if request.method in SAFE_METHODS or can_manage_master_data(request.user):
            return True
        moved = request.data.get("work_group")
        if moved is not None and str(moved) != str(obj.work_group_id):
            return False
        return obj.work_group_id in led_group_ids(request.user)


class MasterDataPermission(BasePermission):
    """Everyone signed in can read master data; only Administrators and the TMO can change it."""

    message = "Only Administrators and the TMO can change master data."

    def has_permission(self, request, view) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False
        return request.method in SAFE_METHODS or can_manage_master_data(request.user)
