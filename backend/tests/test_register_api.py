"""The task form saves the task row, its partners and its contributions together."""

from apps.masterdata.models import Direction, LookupValue, WorkGroup
from apps.register.models import Contribution, TaskPartner


def lk(list_key, value):
    return LookupValue.objects.get(list_key=list_key, value=value).id


def wg(code):
    return WorkGroup.objects.get(code=code).id


def base_task():
    return {
        "work_group": wg("ICT"),
        "title": "Consolidate the service desks",
        "direction": Direction.objects.get(code="ICT-D01").id,
        "workstream": lk("workstream", "Implementation"),
        "owner_role": lk("owner_role", "Support"),
        "planned_start": "2027-01-10",
        "planned_finish": "2027-06-24",
        "status": "needs_completion",
        "partners": [
            {
                "work_group": wg("HR"),
                "role": lk("partner_role", "Support"),
                "need": "Approved staffing rules",
                "needed_when": lk("needed", "Before start"),
                "their_task_ref": "hr-t012",
            }
        ],
        "contributions": [
            {
                "to_group": wg("FIN"),
                "benefit": "Desk reports for Finance",
                "needed_when": lk("needed", "During execution"),
                "their_task_ref": "FIN-T004",
            },
            {
                "to_group": wg("PM"),
                "benefit": "Service desk figures for the PMO",
                "needed_when": lk("needed", "During execution"),
                "their_task_ref": "PM-T009",
            },
        ],
    }


def test_create_task_with_partner_and_contribution(client_for):
    r = client_for("ict.team").post("/api/tasks/", base_task(), format="json")
    assert r.status_code == 201, r.content
    data = r.json()
    assert data["code"] == "ICT-T047"
    assert data["duration_days"] == 120
    [p] = data["partners"]
    assert p["their_task_ref"] == "HR-T012" and p["their_task_info"]["code"] == "HR-T012" and p["issues"] == []
    assert p["agreed"] is False  # HR-T012 does not point back to ICT-T047
    assert [c["slot"] for c in data["contributions"]] == [1, 2]
    assert data["contributions"][0]["their_task_info"]["code"] == "FIN-T004"
    assert data["contributions"][1]["to_group_code"] == "PM"
    assert data["check_summary"]["ok"] is True


def test_changing_owner_role_to_direct_drops_the_contribution(client_for):
    c = client_for("ict.team")
    task_id = c.post("/api/tasks/", base_task(), format="json").json()["id"]
    r = c.patch(f"/api/tasks/{task_id}/", {"owner_role": lk("owner_role", "Direct")}, format="json")
    assert r.status_code == 200 and r.json()["contributions"] == []
    assert not Contribution.objects.filter(task_id=task_id).exists()


def test_partner_rules_are_validated(client_for):
    c = client_for("ict.team")
    body = base_task()
    groups = ("HR", "FIN", "SCM", "PM", "CM", "ENG")
    body["partners"] = [{"work_group": wg(g), "role": lk("partner_role", "Enable")} for g in groups]
    assert c.post("/api/tasks/", body, format="json").status_code == 400  # more than five
    body["partners"] = body["partners"][:5]
    r = c.post("/api/tasks/", body, format="json")
    assert r.status_code == 201, r.content
    assert [p["slot"] for p in r.json()["partners"]] == [1, 2, 3, 4, 5]
    body = base_task()
    body["contributions"] = body["contributions"] * 3
    r = c.post("/api/tasks/", body, format="json")
    assert r.status_code == 400 and "up to 5 contributions" in str(r.content)
    body = base_task()
    body["partners"] = [{"work_group": wg("HR")}, {"work_group": wg("HR")}]
    assert c.post("/api/tasks/", body, format="json").status_code == 400  # named twice
    body["partners"] = [{"work_group": wg("ICT")}]
    assert c.post("/api/tasks/", body, format="json").status_code == 400  # own group


def test_agreed_when_both_registers_point_to_each_other(client_for):
    p = TaskPartner.objects.get(task__code="ICT-T030", work_group__code="HR")
    row = next(x for x in client_for("admin").get("/api/partners/?page_size=50").json()["results"] if x["id"] == p.id)
    assert row["agreed"] is True  # HR-T012 contributes to ICT-T030


def test_summary_counts_match_the_check_sheet(client_for):
    data = client_for("tmo.officer").get("/api/tasks/summary/").json()
    assert data["total"] == 20
    assert data["partner_rows"] == TaskPartner.objects.count() == 19
    assert data["partner_rows_not_complete"] == 1
    assert data["contributions"] == 8 and data["contributions_not_complete"] == 1
    assert data["ready_not_ok"] == 1 and data["readiness_not_set"] == 1
    assert {r["value"]: r["count"] for r in data["by_owner_role"]} == {"Direct": 12, "Enable": 5, "Support": 2}


def test_master_plan_lists_waits_for_from_partner_rows(client_for):
    rows = client_for("tmo.officer").get("/api/tasks/master-plan/").json()
    t003 = next(r for r in rows if r["code"] == "ICT-T003")
    assert t003["waits_for"] == ["FIN-T007", "SCM-T003"]
    assert t003["duration_days"] == 170


def test_summary_lists_the_tasks_behind_each_count(client_for):
    data = client_for("tmo.officer").get("/api/tasks/summary/").json()
    drill = data["drill"]
    rows = {r["id"]: r for r in drill["rows"]}
    assert len(rows) == data["total"]
    assert len(drill["sets"]["not_ok"]) == data["not_ok"]
    assert sorted(rows[i]["code"] for i in drill["sets"]["not_ok"]) == ["ICT-T005", "ICT-T010", "ICT-T016", "ICT-T046"]
    assert len(drill["sets"]["ready_ok"]) == data["ready_ok"]
    assert all(rows[i]["problem"] for i in drill["sets"]["not_ok"])
    team = client_for("hr.team").get("/api/tasks/summary/").json()["drill"]
    assert {r["work_group_code"] for r in team["rows"]} == {"HR"}
