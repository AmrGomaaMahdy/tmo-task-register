"""Save-time validation of the register's fields, above all the planned dates of tasks and activities."""

from apps.masterdata.models import WorkGroup
from apps.register.models import Activity, Task

from .test_register_api import base_task


def post_task(client, **changes):
    return client.post("/api/tasks/", {**base_task(), **changes}, format="json")


def test_task_finish_must_not_be_before_start(client_for):
    c = client_for("ict.team")
    r = post_task(c, planned_start="2027-03-01", planned_finish="2027-02-28")
    assert r.status_code == 400 and "on or after the planned start" in r.json()["planned_finish"][0]
    assert post_task(c, planned_start="2027-03-01", planned_finish="2027-03-01").status_code == 201  # same day is fine


def test_task_dates_stay_in_the_register_range(client_for, settings):
    c = client_for("ict.team")
    r = post_task(c, planned_start="0207-01-10")
    assert r.status_code == 400 and "between 2024-01-01 and 2035-12-31" in r.json()["planned_start"][0]
    assert post_task(c, planned_finish="2036-01-01").status_code == 400
    assert client_for("ict.team").get("/api/auth/me/").json()["date_range"] == {
        "min": "2024-01-01",
        "max": "2035-12-31",
    }


def test_task_dates_must_still_hold_its_activities(client_for):
    task = Task.objects.get(code="ICT-T030")  # 2026-12-01 to 2027-01-31, activities 2026-12-01 to 2027-01-28
    c = client_for("ict.team")
    r = c.patch(f"/api/tasks/{task.id}/", {"planned_start": "2026-12-05"}, format="json")
    assert r.status_code == 400 and "ICT-T030-A01 start before this date" in r.json()["planned_start"][0]
    r = c.patch(f"/api/tasks/{task.id}/", {"planned_finish": "2027-01-20"}, format="json")
    assert r.status_code == 400 and "ICT-T030-A04 finish after this date" in r.json()["planned_finish"][0]
    r = c.patch(f"/api/tasks/{task.id}/", {"planned_finish": None}, format="json")
    assert r.status_code == 400 and "needs both planned dates" in r.json()["planned_finish"][0]
    ok = c.patch(
        f"/api/tasks/{task.id}/", {"planned_start": "2026-11-20", "planned_finish": "2027-01-28"}, format="json"
    )
    assert ok.status_code == 200, ok.content


def test_live_check_reports_activities_outside_new_dates(client_for):
    task = Task.objects.get(code="ICT-T030")
    r = client_for("ict.team").post(
        "/api/tasks/check-draft/", {"id": task.id, "planned_finish": "2027-01-15"}, format="json"
    )
    issues = [i for i in r.json()["checks"] if i["field"] == "planned_finish"]
    assert issues and issues[0]["level"] == "error" and "ICT-T030-A04" in issues[0]["message"]


def activity(task, **changes):
    return {
        "task": task.id,
        "name": "Brief the pilot teams",
        "start_date": "2027-01-10",
        "finish_date": "2027-01-14",
        **changes,
    }


def test_activity_must_sit_inside_its_task_dates(client_for):
    task = Task.objects.get(code="ICT-T030")
    c = client_for("ict.team")
    r = c.post("/api/activities/", activity(task, start_date="2026-11-30"), format="json")
    assert r.status_code == 400 and "task's planned start (2026-12-01)" in r.json()["start_date"][0]
    r = c.post("/api/activities/", activity(task, finish_date="2027-02-01"), format="json")
    assert r.status_code == 400 and "task's planned finish (2027-01-31)" in r.json()["finish_date"][0]
    r = c.post("/api/activities/", activity(task, start_date="2027-01-14", finish_date="2027-01-10"), format="json")
    assert r.status_code == 400 and "on or after start" in r.json()["finish_date"][0]
    edge = c.post("/api/activities/", activity(task, start_date="2026-12-01", finish_date="2027-01-31"), format="json")
    assert edge.status_code == 201  # the task's own first and last day are inside


def test_activity_needs_task_dates(client_for):
    task = Task.objects.filter(work_group__code="ICT", planned_start=None).exclude(status="in_master_plan").first()
    if task is None:
        task = Task.objects.get(code="ICT-T030")
        Task.objects.filter(pk=task.pk).update(planned_start=None)
        task.refresh_from_db()
    r = client_for("ict.team").post("/api/activities/", activity(task), format="json")
    assert r.status_code == 400 and "Set the task's planned start and finish first" in r.json()["start_date"][0]


def test_partial_edit_checks_against_the_saved_dates(client_for):
    a = Activity.objects.get(task__code="ICT-T030", order=1)  # 2026-12-01 to 2026-12-14
    c = client_for("ict.team")
    r = c.patch(f"/api/activities/{a.id}/", {"finish_date": "2026-11-30"}, format="json")
    assert r.status_code == 400 and "on or after start" in r.json()["finish_date"][0]


def test_predecessors_and_successors_keep_their_order(client_for):
    a1 = Activity.objects.get(task__code="ICT-T030", order=1)  # finishes 2026-12-14; A02 and A03 follow it
    a2 = Activity.objects.get(task__code="ICT-T030", order=2)
    c = client_for("ict.team")
    r = c.patch(f"/api/activities/{a2.id}/", {"start_date": "2026-12-14"}, format="json")
    assert r.status_code == 400 and "after predecessor ICT-T030-A01 finishes (2026-12-14)" in r.json()["start_date"][0]
    r = c.patch(f"/api/activities/{a1.id}/", {"finish_date": "2026-12-16"}, format="json")
    assert r.status_code == 400 and "ICT-T030-A02 follows this activity" in r.json()["finish_date"][0]


def test_text_fields_need_words(client_for):
    c = client_for("ict.team")
    assert post_task(c, title="   ").status_code == 400
    r = post_task(c, title="--")
    assert r.status_code == 400 and "at least 3 characters" in r.json()["title"][0]
    r = post_task(c, title="  Consolidate   the desks  ")
    assert r.status_code == 201 and r.json()["title"] == "Consolidate the desks"
    task = Task.objects.get(code="ICT-T030")
    assert c.post("/api/activities/", activity(task, name="12"), format="json").status_code == 400


def test_task_numbers_groups_and_contributions(client_for):
    c = client_for("ict.team")
    body = base_task()
    body["partners"][0]["their_task_ref"] = "HR 12"
    r = c.post("/api/tasks/", body, format="json")
    assert r.status_code == 400 and "like HR-T012" in r.json()["partners"][0]
    body = base_task()
    body["contributions"][0]["to_group"] = WorkGroup.objects.get(code="ICT").id
    r = c.post("/api/tasks/", body, format="json")
    assert r.status_code == 400 and "another work group" in r.json()["contributions"][0]
    WorkGroup.objects.filter(code="HR").update(is_active=False)
    r = c.post("/api/tasks/", base_task(), format="json")
    assert r.status_code == 400 and "HR is no longer an active work group" in r.json()["partners"][0]


def test_leader_decides_approve_or_reject_only(client_for):
    from apps.register.models import TaskPartner

    p = TaskPartner.objects.filter(work_group__code="HR").first()
    r = client_for("rakan.alauni").post(
        f"/api/partners/{p.id}/review/",
        {"decision": "timeline", "note": "Later", "proposed_date": "2027-01-01"},
        format="json",
    )
    assert r.status_code == 400 and "decision" in r.json()
