from django.contrib import admin

from .models import Direction, GroupMember, LookupValue, WorkGroup


@admin.register(WorkGroup)
class WorkGroupAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "is_active")
    search_fields = ("code", "name")


@admin.register(Direction)
class DirectionAdmin(admin.ModelAdmin):
    list_display = ("code", "work_group", "title")
    list_filter = ("work_group",)
    search_fields = ("code", "title")


@admin.register(LookupValue)
class LookupValueAdmin(admin.ModelAdmin):
    list_display = ("list_key", "value", "semantic", "sort_order")
    list_filter = ("list_key",)
    search_fields = ("value", "definition")


@admin.register(GroupMember)
class GroupMemberAdmin(admin.ModelAdmin):
    list_display = ("name", "work_group", "is_active")
    list_filter = ("work_group", "is_active")
    search_fields = ("name",)
