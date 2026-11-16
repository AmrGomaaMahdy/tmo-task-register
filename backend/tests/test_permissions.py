from apps.masterdata.models import LookupValue
from apps.register.models import Task


def tid(code):
    return Task.objects.get(code=code).id


def test_tmo_and_viewer_read_all_registers(client_for):
    for user in ("tmo.officer", "committee.viewer", "admin"):
        assert client_for(user).get("/api/tasks/?page_size=50").data["count"] == 20


def test_group_role_edits_own_group_but_not_others(client_for):
    c = client_for("ict.team")
    assert c.patch(f"/api/tasks/{tid('ICT-T031')}/", {"cost_basis": "Updated"}, format="json").status_code == 200
    assert c.patch(f"/api/tasks/{tid('HR-T015')}/", {"cost_basis": "No"}, format="json").status_code in (403, 404)


def test_group_role_deletes_own_tasks_only(client_for):
    assert client_for("hr.team").delete(f"/api/tasks/{tid('ICT-T016')}/").status_code in (403, 404)
    assert client_for("ict.team").delete(f"/api/tasks/{tid('ICT-T016')}/").status_code == 204


def test_each_group_has_its_own_lead(client_for):
    assert client_for("fin.team").post(
        f"/api/tasks/{tid('ICT-T005')}/transition/", {"status": "ready"}
    ).status_code in (403, 404)


def test_each_work_group_gets_its_own_team_role(db):
    from django.contrib.auth.models import Group

    from apps.masterdata.models import WorkGroup

    wg = WorkGroup.objects.create(code="QA", name="Quality Assurance")
    assert Group.objects.filter(name="QA Team").exists()
    wg.code = "QHSE"
    wg.save()
    assert Group.objects.filter(name="QHSE Team").exists()
    assert not Group.objects.filter(name="QA Team").exists()
    wg.delete()
    assert not Group.objects.filter(name="QHSE Team").exists()


def test_a_user_can_belong_to_two_teams(client_for):
    from django.contrib.auth.models import Group, User

    user = User.objects.get(username="hr.team")
    user.groups.add(Group.objects.get(name="ICT Team"))
    c = client_for("hr.team")
    assert c.patch(f"/api/tasks/{tid('ICT-T031')}/", {"cost_basis": "Joint"}, format="json").status_code == 200
    me = c.get("/api/auth/me/").json()
    assert [g["code"] for g in me["work_groups"]] == ["HR", "ICT"]


def test_old_roles_are_retired(db):
    import io

    from django.contrib.auth.models import Group
    from django.core.management import call_command

    Group.objects.create(name="Group Lead")
    call_command("setup_roles", stdout=io.StringIO())
    assert not Group.objects.filter(name="Group Lead").exists()


def test_lead_can_mark_ready(client_for):
    r = client_for("ict.team").post(f"/api/tasks/{tid('ICT-T005')}/transition/", {"status": "ready"})
    assert r.status_code == 200
    assert r.data["status"] == "ready"


def test_only_tmo_includes_in_master_plan_and_only_when_ok(client_for):
    assert (
        client_for("ict.team")
        .post(f"/api/tasks/{tid('ICT-T030')}/transition/", {"status": "in_master_plan"})
        .status_code
        == 403
    )
    tmo = client_for("tmo.officer")
    assert tmo.post(f"/api/tasks/{tid('ICT-T030')}/transition/", {"status": "in_master_plan"}).status_code == 200
    # ICT-T010 is Ready but its partner row misses their task number: it cannot be included
    r = tmo.post(f"/api/tasks/{tid('ICT-T010')}/transition/", {"status": "in_master_plan"})
    assert r.status_code == 400


def test_task_in_master_plan_is_locked_for_the_group(client_for):
    r = client_for("ict.team").patch(f"/api/tasks/{tid('ICT-T007')}/", {"cost_basis": "x"}, format="json")
    assert r.status_code == 403


def test_viewer_is_read_only(client_for):
    c = client_for("committee.viewer")
    assert c.get("/api/tasks/summary/").status_code == 200
    assert c.post("/api/tasks/", {"title": "x", "work_group": 1}, format="json").status_code == 403


def test_new_task_gets_next_code_of_its_group(client_for):
    from apps.masterdata.models import WorkGroup

    hr = WorkGroup.objects.get(code="HR").id
    r = client_for("hr.team").post(
        "/api/tasks/", {"title": "Plan the HR onboarding pilot", "work_group": hr}, format="json"
    )
    assert r.status_code == 201
    assert r.data["code"] == "HR-T021"


def test_master_data_changes_are_limited_to_tmo_and_admin(client_for):
    body = {"list_key": "workstream", "value": "Quality"}
    assert client_for("ict.team").post("/api/lookups/", body, format="json").status_code == 403
    assert client_for("tmo.officer").post("/api/lookups/", body, format="json").status_code == 201


def test_values_in_use_and_core_values_cannot_be_deleted(client_for):
    admin = client_for("admin")
    core = LookupValue.objects.get(list_key="owner_role", semantic="direct")
    assert admin.delete(f"/api/lookups/{core.id}/").status_code == 409
    used = LookupValue.objects.get(list_key="workstream", value="Offshoring")
    assert admin.delete(f"/api/lookups/{used.id}/").status_code == 409


def test_rename_updates_every_task(client_for):
    used = LookupValue.objects.get(list_key="workstream", value="Offshoring")
    client_for("admin").patch(f"/api/lookups/{used.id}/", {"value": "Offshoring (Jordan)"}, format="json")
    assert Task.objects.get(code="ICT-T040").workstream.value == "Offshoring (Jordan)"
