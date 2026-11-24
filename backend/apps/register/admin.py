from django.contrib import admin

from .models import MAX_ROWS, Activity, Contribution, Task, TaskPartner


class PartnerInline(admin.TabularInline):
    model = TaskPartner
    extra = 0
    max_num = MAX_ROWS
    fk_name = "task"
    fields = ("slot", "work_group", "role", "need", "needed_when", "their_task_ref")


class ContributionInline(admin.TabularInline):
    model = Contribution
    extra = 0
    max_num = MAX_ROWS
    fk_name = "task"
    fields = ("slot", "to_group", "benefit", "needed_when", "their_task_ref")


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ("code", "title", "work_group", "owner_role", "status", "planned_start", "planned_finish")
    list_filter = ("work_group", "status")
    search_fields = ("code", "title")
    readonly_fields = ("code", "created_at", "updated_at", "created_by", "updated_by")
    inlines = [PartnerInline, ContributionInline]


@admin.register(Activity)
class ActivityAdmin(admin.ModelAdmin):
    list_display = ("__str__", "start_date", "finish_date")
    list_filter = ("task__work_group",)
