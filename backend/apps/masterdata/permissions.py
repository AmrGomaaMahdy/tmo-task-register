from rest_framework.permissions import SAFE_METHODS, BasePermission

from apps.accounts.roles import can_manage_master_data


class MasterDataPermission(BasePermission):
    """Everyone signed in can read master data; only Administrators and the TMO can change it."""

    message = "Only Administrators and the TMO can change master data."

    def has_permission(self, request, view) -> bool:
        if not request.user or not request.user.is_authenticated:
            return False
        return request.method in SAFE_METHODS or can_manage_master_data(request.user)
