"""Group members belong to a work group; an activity owner is a member of the task's own group."""

from apps.masterdata.models import GroupMember, WorkGroup
from apps.register.models import Activity, Task
from apps.register.services.checks import check_task


def test_demo_members_belong_to_their_groups(seeded):
    ict = WorkGroup.objects.get(code="ICT")
    names = set(GroupMember.objects.filter(work_group=ict).values_list("name", flat=True))
    assert {"Shadi Alghanim", "Essam Essmat", "Amr Gomaa"} <= names
    assert GroupMember.objects.filter(work_group__code="HR").count() == 6
    assert all(a.owner is None or a.owner.work_group_id == a.task.work_group_id for a in Activity.objects.all())


def test_team_sees_only_its_own_members(client_for):
    rows = client_for("hr.team").get("/api/members/").json()
    assert rows and {r["work_group_code"] for r in rows} == {"HR"}
    everyone = client_for("tmo.officer").get("/api/members/").json()
    assert len(everyone) == GroupMember.objects.count()
    amr = next(r for r in everyone if r["name"] == "Amr Gomaa")
    assert amr["work_group_code"] == "ICT" and amr["activity_count"] == 1


def test_only_admin_and_tmo_manage_members(client_for):
    hr = WorkGroup.objects.get(code="HR")
    assert client_for("hr.team").post("/api/members/", {"name": "New Person", "work_group": hr.id}).status_code == 403
    created = client_for("tmo.officer").post("/api/members/", {"name": "  New   Person ", "work_group": hr.id})
    assert created.status_code == 201 and created.json()["name"] == "New Person"


def test_member_who_owns_activities_cannot_be_deleted(client_for):
    essam = GroupMember.objects.get(name="Essam Essmat")
    assert client_for("admin").delete(f"/api/members/{essam.id}/").status_code == 409


def test_activity_owner_must_be_a_member_of_the_task_group(client_for):
    task = Task.objects.get(code="ICT-T030")
    hr_member = GroupMember.objects.get(name="Hassan Farooq")
    ict_member = GroupMember.objects.get(name="Amr Gomaa")
    body = {"task": task.id, "name": "Brief the pilot teams", "start_date": "2027-01-10", "finish_date": "2027-01-14"}
    refused = client_for("ict.team").post("/api/activities/", {**body, "owner": hr_member.id}, format="json")
    assert refused.status_code == 400 and "Pick a member of ICT" in refused.json()["owner"][0]
    ok = client_for("ict.team").post("/api/activities/", {**body, "owner": ict_member.id}, format="json")
    assert ok.status_code == 201
    row = ok.json()
    assert row["owner_name"] == "Amr Gomaa" and row["task_code"] == "ICT-T030" and row["work_group_code"] == "ICT"


def test_check_flags_an_owner_moved_to_another_group(seeded):
    essam = GroupMember.objects.get(name="Essam Essmat")
    essam.work_group = WorkGroup.objects.get(code="HR")
    essam.save()
    messages = [i.message for i in check_task(Task.objects.get(code="ICT-T030")) if i.field == "activities"]
    assert any(m.endswith(": Owner Essam Essmat is a member of HR, not ICT: pick a member of ICT") for m in messages)


def test_activity_list_covers_the_visible_registers(client_for):
    team = client_for("ict.team").get("/api/activities/").json()
    assert team and {a["work_group_code"] for a in team} == {"ICT"}
    assert len(client_for("committee.viewer").get("/api/activities/").json()) == Activity.objects.count()
