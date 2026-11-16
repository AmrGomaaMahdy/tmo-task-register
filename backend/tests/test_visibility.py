"""Teams see their own register in full and, of other groups, only what is shared with them."""

import pytest

from apps.masterdata.models import WorkGroup
from apps.register.models import Contribution, Task, TaskPartner


def wg(code):
    return WorkGroup.objects.get(code=code)


def shared_and_unshared(code):
    """One task of another group linked to `code`'s group, and one that is not."""
    group = wg(code)
    linked = set(
        Task.objects.exclude(work_group=group)
        .filter(
            pk__in=list(TaskPartner.objects.filter(work_group=group).values_list("task", flat=True))
            + list(TaskPartner.objects.filter(task__work_group=group).values_list("their_task", flat=True))
            + list(Contribution.objects.filter(to_group=group).values_list("task", flat=True))
            + list(Contribution.objects.filter(task__work_group=group).values_list("their_task", flat=True))
        )
        .values_list("pk", flat=True)
    )
    unlinked = Task.objects.exclude(work_group=group).exclude(pk__in=linked).first()
    return Task.objects.get(pk=min(linked)), unlinked


def test_team_register_lists_only_its_own_tasks(client_for):
    r = client_for("ict.team").get("/api/tasks/?page_size=50")
    assert r.status_code == 200
    codes = [t["code"] for t in r.data["results"]]
    assert codes and all(c.startswith("ICT-") for c in codes)
    assert r.data["count"] == Task.objects.filter(work_group=wg("ICT")).count()


def test_team_sees_only_the_shared_part_of_a_linked_task(client_for):
    shared, unlinked = shared_and_unshared("ICT")
    c = client_for("ict.team")
    r = c.get(f"/api/tasks/{shared.id}/")
    assert r.status_code == 200
    data = r.json()
    assert data["limited"] is True
    assert data["code"] == shared.code
    for hidden in ("direction", "workstream", "owner_role", "checks", "partners", "access"):
        assert hidden not in data
    every_link = data["shared"]["contributions"] + data["shared"]["partners"]
    assert every_link, "the shared part lists the links with ICT"
    if unlinked:
        assert c.get(f"/api/tasks/{unlinked.id}/").status_code == 404


def test_team_cannot_change_another_groups_task_even_if_shared(client_for):
    shared, _ = shared_and_unshared("ICT")
    c = client_for("ict.team")
    assert c.patch(f"/api/tasks/{shared.id}/", {"title": "x"}, format="json").status_code == 404
    assert c.delete(f"/api/tasks/{shared.id}/").status_code == 404


def test_links_lists_show_only_rows_involving_the_team(client_for):
    ict = wg("ICT").id
    c = client_for("ict.team")
    for x in c.get("/api/contributions/?page_size=50").data["results"]:
        their = (x["their_task_info"] or {}).get("work_group_code")
        assert "ICT" in (x["task_ref"]["work_group_code"], x["to_group_code"], their)
    for p in c.get("/api/partners/?page_size=50").data["results"]:
        their = (p["their_task_info"] or {}).get("work_group_code")
        assert "ICT" in (p["task_ref"]["work_group_code"], p["work_group_code"], their)
    for a in c.get("/api/activities/").data:
        assert Task.objects.get(pk=a["task"]).work_group_id == ict
    # HR sees fewer rows than the TMO, who sees them all
    hr_count = client_for("hr.team").get("/api/partners/").data["count"]
    assert hr_count < client_for("tmo.officer").get("/api/partners/").data["count"] == TaskPartner.objects.count()


def test_involves_filter_returns_both_directions(client_for):
    hr = wg("HR")
    c = client_for("tmo.officer")
    rows = c.get(f"/api/partners/?involves={hr.id}&page_size=50").data["results"]
    expected = (
        TaskPartner.objects.filter(task__work_group=hr)
        | TaskPartner.objects.filter(work_group=hr)
        | TaskPartner.objects.filter(their_task__work_group=hr)
    )
    assert len(rows) == expected.distinct().count()


@pytest.mark.parametrize(
    ("user", "status"), [("ict.team", 403), ("tmo.officer", 200), ("committee.viewer", 200), ("admin", 200)]
)
def test_master_plan_is_for_tmo_admin_and_committee(client_for, user, status):
    assert client_for(user).get("/api/tasks/master-plan/").status_code == status


def test_permissions_flags(client_for):
    team = client_for("ict.team").get("/api/auth/me/").json()["permissions"]
    viewer = client_for("committee.viewer").get("/api/auth/me/").json()["permissions"]
    assert (team["view_all"], team["master_plan"]) == (False, False)
    assert (viewer["view_all"], viewer["master_plan"]) == (True, True)


def test_summary_covers_only_the_teams_register(client_for):
    r = client_for("hr.team").get("/api/tasks/summary/")
    assert r.data["total"] == Task.objects.filter(work_group=wg("HR")).count()
    assert all(d["code"].startswith("HR-") for d in r.data["by_direction"])


def test_team_sees_task_counts_of_its_own_group_only(client_for):
    data = client_for("hr.team").get("/api/work-groups/?page_size=50").data
    rows = data["results"] if isinstance(data, dict) else data
    groups = {g["code"]: g["task_count"] for g in rows}
    assert groups["HR"] is not None
    assert groups["ICT"] is None


def test_directory_gives_code_and_title_only_to_link_tasks(client_for):
    rows = client_for("hr.team").get(f"/api/tasks/directory/?work_group={wg('ICT').id}").json()
    assert rows and set(rows[0]) == {"id", "code", "title", "work_group", "work_group_code"}


def test_team_links_its_task_to_another_groups_task(client_for):
    from apps.masterdata.models import LookupValue

    ict_task = Task.objects.filter(work_group=wg("ICT"), partners__isnull=True).exclude(status="in_master_plan").first()
    hr_task = Task.objects.filter(work_group=wg("HR")).exclude(status="in_master_plan").first()
    support = LookupValue.objects.get(list_key="partner_role", value="Support").id
    before = LookupValue.objects.get(list_key="needed", value="Before start").id
    c = client_for("hr.team")
    row = {"work_group": wg("ICT").id, "role": support, "need": "Shared data", "needed_when": before}
    body = {"partners": [{**row, "their_task_ref": ict_task.code.lower()}]}
    r = c.patch(f"/api/tasks/{hr_task.id}/", body, format="json")
    assert r.status_code == 200, r.content
    saved = r.json()["partners"][0]
    assert saved["their_task_ref"] == ict_task.code and saved["their_task_info"]["code"] == ict_task.code
    assert saved["issues"] == []
    # but not on the other group's task
    body = {"partners": [{"work_group": wg("HR").id, "role": support, "need": "No"}]}
    assert c.patch(f"/api/tasks/{ict_task.id}/", body, format="json").status_code == 404
    # and ICT now sees the HR task's shared part
    shared = client_for("ict.team").get(f"/api/tasks/{hr_task.id}/").json()
    assert shared["limited"] is True and shared["shared"]["partners"]


def test_links_lists_are_read_only(client_for):
    c = client_for("admin")
    assert c.post("/api/partners/", {}, format="json").status_code == 405
    assert c.post("/api/contributions/", {}, format="json").status_code == 405
