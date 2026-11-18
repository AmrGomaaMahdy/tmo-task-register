"""The organisation's initial data, the three group roles, member types and changing one's password."""

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.accounts.role_names import upgrade_role_names
from apps.masterdata.models import Direction, GroupMember, LookupValue, WorkGroup
from apps.register.models import Task

from .conftest import PASSWORD
from .test_register_api import base_task

User = get_user_model()


def roles(username):
    return sorted(User.objects.get(username=username).groups.values_list("name", flat=True))


def test_work_groups_missions_weights_and_directions(seeded):
    groups = {g.code: g for g in WorkGroup.objects.all()}
    assert len(groups) == 13 and sum(g.weight for g in groups.values()) == 100
    assert groups["HR"].name == "Human Capital Management" and groups["PM"].weight == 15
    assert groups["ICT"].mission.startswith("Create an integrated, secure")
    assert Direction.objects.count() == 103
    assert (
        Direction.objects.get(code="PM-D01").title
        == "Establish clear ownership of planning for the Infrastructure Unit"
    )
    assert Direction.objects.filter(work_group__code="ICT").count() == 7


def test_sub_objectives_belong_to_their_groups(seeded):
    subs = LookupValue.objects.filter(list_key="sub_objective")
    assert subs.count() == 78 and not subs.filter(work_group=None).exists()
    hr = set(subs.filter(work_group__code="HR").values_list("value", flat=True))
    assert hr == {"WB-3-Manpower Utilization", "WB-5-HR (Head /PLAN /EXECUTION )", "WB-10-Service Catalog Linkage"}
    assert not subs.filter(work_group__code="BC").exists()


def test_members_types_and_accounts(seeded):
    amr = GroupMember.objects.get(name="Amr Gomaa", work_group__code="ICT")
    assert amr.member_type == "coordinator" and amr.user.username == "amr.gomaa"
    assert roles("amr.gomaa") == ["ICT Team Coordinator"]
    assert roles("shadi.alghanim") == ["ICT Team Leader"]
    assert roles("abdullah.al.othman") == ["BC Team Leader", "CM Team Leader", "PM Team Leader"]
    assert roles("karim.chettouh") == ["BD Team Member", "OTH Team Member"]
    # Green in the sheet but nothing written in front of the name: a Team Member, as asked.
    assert roles("uduman.thangal") == ["PM Team Member"]
    assert {w.code: w.leader.username for w in WorkGroup.objects.select_related("leader")}[
        "SS"
    ] == "hussam.eldien.salah"
    assert User.objects.get(username="amr.gomaa").check_password(PASSWORD)  # demo: the trial password


def test_team_member_reads_but_changes_nothing(client_for):
    c = client_for("hr.member")
    me = c.get("/api/auth/me/").json()
    assert me["permissions"]["create_tasks"] is False and me["work_groups"] == []
    assert [(g["code"], g["role"]) for g in me["view_groups"]] == [("HR", "member")]
    rows = c.get("/api/tasks/?page_size=50").json()["results"]
    assert rows and {r["work_group_code"] for r in rows} == {"HR"}
    task = Task.objects.filter(work_group__code="HR").exclude(status="in_master_plan").first()
    assert c.get(f"/api/tasks/{task.id}/").json()["access"]["can_edit"] is False
    assert c.patch(f"/api/tasks/{task.id}/", {"title": "Changed by a member"}, format="json").status_code == 403
    body = {**base_task(), "work_group": WorkGroup.objects.get(code="HR").id}
    assert c.post("/api/tasks/", body, format="json").status_code == 403
    assert c.get("/api/tasks/governance/").status_code == 403


def test_coordinator_maintains_the_register_but_does_not_govern(client_for):
    c = client_for("amr.gomaa")
    created = c.post("/api/tasks/", base_task(), format="json")
    assert created.status_code == 201, created.content
    t = Task.objects.get(pk=created.json()["id"])
    assert c.patch(f"/api/tasks/{t.id}/", {"title": "A clearer title"}, format="json").status_code == 200
    assert c.get("/api/tasks/governance/").status_code == 403


def test_leader_has_full_control_of_the_group(client_for):
    c = client_for("rakan.alauni")
    hr = WorkGroup.objects.get(code="HR")
    made = c.post(
        "/api/tasks/",
        {
            **base_task(),
            "work_group": hr.id,
            "partners": [],
            "contributions": [],
            "sub_objective": None,
            "direction": Direction.objects.filter(work_group=hr).first().id,
        },
        format="json",
    )
    assert made.status_code == 201, made.content
    hassan = GroupMember.objects.get(name="Hassan Farooq")
    r = c.patch(f"/api/members/{hassan.id}/", {"phone": "+966 11 234 5678", "job_title": "HR Partner"}, format="json")
    assert r.status_code == 200, r.content
    # The leader cannot hand over leadership, and cannot change another group's members.
    assert c.patch(f"/api/members/{hassan.id}/", {"member_type": "leader"}, format="json").status_code == 400
    amr = GroupMember.objects.get(name="Amr Gomaa")
    assert c.patch(f"/api/members/{amr.id}/", {"phone": "+966 11 000 0000"}, format="json").status_code in (403, 404)
    # A coordinator does not manage members.
    assert (
        client_for("hassan.farooq").patch(f"/api/members/{hassan.id}/", {"phone": "123456"}, format="json").status_code
        == 403
    )


def test_member_type_sets_the_accounts_role(client_for):
    admin = client_for("admin")
    hassan = GroupMember.objects.get(name="Hassan Farooq")
    admin.patch(f"/api/members/{hassan.id}/", {"member_type": "member"}, format="json")
    assert roles("hassan.farooq") == ["HR Team Member"]
    raed = GroupMember.objects.get(name="Raed Smaidi")
    r = admin.patch(f"/api/members/{raed.id}/", {"member_type": "leader"}, format="json")
    assert r.status_code == 200, r.content
    assert WorkGroup.objects.get(code="HR").leader.username == "raed.smaidi"
    assert roles("raed.smaidi") == ["HR Team Leader"]
    assert roles("rakan.alauni") == ["HR Team Member"]  # the previous leader stays in the group as a member
    assert GroupMember.objects.get(name="Rakan Alauni").member_type == "member"


def test_leader_chosen_in_configuration_updates_the_member_rows(client_for):
    ict = WorkGroup.objects.get(code="ICT")
    amr = User.objects.get(username="amr.gomaa")
    assert (
        client_for("tmo.officer").patch(f"/api/work-groups/{ict.id}/", {"leader": amr.id}, format="json").status_code
        == 200
    )
    assert GroupMember.objects.get(name="Amr Gomaa").member_type == "leader"
    assert GroupMember.objects.get(name="Shadi Alghanim", work_group=ict).member_type == "member"
    assert "ICT Team Member" in roles("shadi.alghanim") and "ICT Team Leader" not in roles("shadi.alghanim")


def test_sub_objective_of_another_group_is_refused(client_for):
    other = LookupValue.objects.get(value="WB-3-Manpower Utilization")  # HR's
    r = client_for("amr.gomaa").post("/api/tasks/", {**base_task(), "sub_objective": other.id}, format="json")
    assert r.status_code == 400 and "belongs to HR" in str(r.content)
    own = LookupValue.objects.get(value="WB-15-Digitalization of Related Sub-objectives")
    assert (
        client_for("amr.gomaa").post("/api/tasks/", {**base_task(), "sub_objective": own.id}, format="json").status_code
        == 201
    )


def test_loading_again_keeps_edits_and_update_restores_the_file(seeded):
    d = Direction.objects.get(code="HR-D01")
    d.title = "Edited in Configuration"
    d.save()
    call_command("load_initial_data", verbosity=0)
    assert Direction.objects.get(code="HR-D01").title == "Edited in Configuration"
    assert Direction.objects.count() == 103 and GroupMember.objects.count() == 75
    call_command("load_initial_data", "--update", verbosity=0)
    assert Direction.objects.get(code="HR-D01").title == "Operationalize the HR Blueprint."


def test_accounts_without_an_initial_password_cannot_sign_in(db, monkeypatch):
    monkeypatch.delenv("INITIAL_USER_PASSWORD", raising=False)
    call_command("setup_roles", verbosity=0)
    call_command("load_initial_data", verbosity=0)
    assert User.objects.filter(username="amr.gomaa").exists()
    assert not User.objects.get(username="amr.gomaa").has_usable_password()


def test_change_own_password(seeded):
    c = APIClient()
    assert c.post("/api/auth/login/", {"username": "amr.gomaa", "password": PASSWORD}).status_code == 200
    bad = c.post("/api/auth/password/", {"current_password": "wrong", "new_password": "Desert-Gold-2027!"})
    assert bad.status_code == 400 and "current_password" in bad.json()
    weak = c.post("/api/auth/password/", {"current_password": PASSWORD, "new_password": "12345678"})
    assert weak.status_code == 400 and "new_password" in weak.json()
    ok = c.post("/api/auth/password/", {"current_password": PASSWORD, "new_password": "Desert-Gold-2027!"})
    assert ok.status_code == 204
    assert c.get("/api/auth/me/").status_code == 200  # still signed in here
    assert (
        APIClient().post("/api/auth/login/", {"username": "amr.gomaa", "password": "Desert-Gold-2027!"}).status_code
        == 200
    )


def test_old_role_names_are_renamed_keeping_users(seeded):
    user = User.objects.get(username="hr.team")
    user.groups.clear()
    old = Group.objects.create(name="HR Team")
    Group.objects.filter(name="HR Team Coordinator").delete()
    user.groups.add(old, Group.objects.get_or_create(name="Administrator")[0])
    upgrade_role_names(Group, WorkGroup)
    assert roles("hr.team") == ["Admin", "HR Team Coordinator"]
    assert not Group.objects.filter(name__in=["HR Team", "Administrator"]).exists()


def test_upgrade_gives_existing_unlinked_rows_the_sheets_type(seeded):
    # Before 1.16 a member row had no type or account: the migration made it a Member.
    GroupMember.objects.filter(name="Amr Gomaa").update(member_type="member", user=None)
    User.objects.get(username="amr.gomaa").groups.clear()
    call_command("load_initial_data", verbosity=0)
    assert GroupMember.objects.get(name="Amr Gomaa").member_type == "coordinator"
    assert roles("amr.gomaa") == ["ICT Team Coordinator"]
