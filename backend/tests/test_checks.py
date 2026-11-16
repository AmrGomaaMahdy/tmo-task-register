"""The automatic check follows sheet 5 (Check) of the Simplified Task Register v1.7."""

from datetime import date

from apps.masterdata.models import LookupValue, WorkGroup
from apps.register.models import Task
from apps.register.services.checks import ContributionData, PartnerData, check_task, is_ok
from apps.register.services.workdays import working_days


def get(code):
    return Task.objects.get(code=code)


def lk(list_key, value):
    return LookupValue.objects.get(list_key=list_key, value=value)


def test_draft_task_lists_missing_required_fields(seeded):
    issues = check_task(get("ICT-T016"))
    labels = {i.label for i in issues if i.level == "error"}
    assert {"Main workstream", "Owner role", "Readiness status"} <= labels
    assert not is_ok(issues)


def test_sample_data_matches_the_prototype(seeded):
    not_ok = sorted(t.code for t in Task.objects.all() if not is_ok(check_task(t)))
    assert not_ok == ["ICT-T005", "ICT-T010", "ICT-T016", "ICT-T046"]


def test_planned_dates_are_needed_before_ready(seeded):
    task = get("ICT-T005")  # needs completion, no finish: a warning only
    assert [i.level for i in check_task(task) if i.field == "planned_finish"] == ["warning"]
    task.status = "ready"
    assert [i.level for i in check_task(task) if i.field == "planned_finish"] == ["error"]


def test_partner_row_needs_what_when_and_their_task(seeded):
    task = get("ICT-T030")
    hr = WorkGroup.objects.get(code="HR")
    row = PartnerData(1, hr.id, "HR", lk("partner_role", "Support").id, "", None, "")
    messages = [i.message for i in check_task(task, [row], None)]
    assert messages == ["Partner HR: Partner details missing: fill in what we need, when and their task"]

    row = PartnerData(1, hr.id, "HR", None, "Staffing rules", lk("needed", "Before start").id, "FIN-T004")
    messages = [i.message for i in check_task(task, [row], None)]
    assert any("Role 1 is empty" in m for m in messages)
    assert any("Their task must be a task number of HR, written like HR-T012" in m for m in messages)


def test_enable_task_needs_its_contribution_row(seeded):
    task = get("ICT-T046")
    assert any(i.field == "contribution" for i in check_task(task))
    pm = WorkGroup.objects.get(code="PM")
    row = ContributionData(1, pm.id, "PM", "Dashboards", lk("needed", "During execution").id, "PM-T009")
    assert not [i for i in check_task(task, [], [row]) if i.field.startswith("contribution")]
    [missing] = [i for i in check_task(task, [], []) if i.field == "contribution"]
    assert missing.message.startswith("Owner role is Enable: add at least one contribution")
    half = ContributionData(2, pm.id, "PM", "", None, "")
    messages = [i.message for i in check_task(task, [], [row, half]) if i.field == "contribution_2"]
    assert messages and all(m.startswith("Contribution 2 to PM: ") for m in messages)


def test_up_to_five_rows_each(seeded):
    task = get("ICT-T046")
    pm = WorkGroup.objects.get(code="PM")
    rows = [ContributionData(n, pm.id, "PM", "x", lk("needed", "Before start").id, "PM-T009") for n in range(1, 7)]
    assert any("up to 5 contributions" in i.message for i in check_task(task, [], rows))


def test_direct_task_needs_no_contribution(seeded):
    task = get("ICT-T030")
    assert task.owner_role.value == "Direct"
    assert not [i for i in check_task(task) if i.field == "contribution"]


def test_activity_rules(seeded):
    task = get("ICT-T030")
    a2 = task.activities.get(order=2)
    a2.start_date = date(2026, 12, 10)  # before its predecessor A01 finishes
    a2.save()
    messages = [i.message for i in check_task(task)]
    assert any("ICT-T030-A02: Start is not after the finish of predecessor ICT-T030-A01" in m for m in messages)


def test_working_days_skip_friday_and_saturday():
    assert working_days(date(2026, 12, 1), date(2027, 1, 31)) == 44  # the template's example
    assert working_days(date(2026, 12, 4), date(2026, 12, 5)) == 0  # a Friday and a Saturday
    assert working_days(date(2027, 1, 31), date(2026, 12, 1)) is None


def test_live_check_reports_blank_fields_instead_of_ok(client_for):
    client = client_for("ict.team")
    response = client.post(
        "/api/tasks/check-draft/",
        {"work_group": WorkGroup.objects.get(code="ICT").id, "title": "", "workstream": "", "partners": []},
        format="json",
    )
    assert response.status_code == 200
    fields = {issue["field"] for issue in response.json()["checks"]}
    assert {"title", "direction", "workstream", "owner_role"} <= fields


def test_live_check_includes_partner_rows_as_typed(client_for):
    ict, hr = WorkGroup.objects.get(code="ICT"), WorkGroup.objects.get(code="HR")
    response = client_for("ict.team").post(
        "/api/tasks/check-draft/",
        {
            "work_group": ict.id,
            "title": "A task",
            "partners": [{"work_group": hr.id, "role": lk("partner_role", "Support").id, "their_task_ref": "hr-t5"}],
        },
        format="json",
    )
    messages = [i["message"] for i in response.json()["checks"] if i["field"] == "partner_1"]
    assert any("What we need is empty" in m for m in messages)
    assert any("Their task must be a task number of HR" in m for m in messages)
