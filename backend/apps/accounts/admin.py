from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

User = get_user_model()


class UserAdmin(BaseUserAdmin):
    """Give a user a team role (for example "ICT Team") under Groups to let them maintain that register."""

    list_display = ("username", "first_name", "last_name", "is_active", "roles")
    list_filter = ("is_active", "groups")

    @admin.display(description="Roles")
    def roles(self, obj):
        return ", ".join(obj.groups.values_list("name", flat=True))


admin.site.unregister(User)
admin.site.register(User, UserAdmin)
