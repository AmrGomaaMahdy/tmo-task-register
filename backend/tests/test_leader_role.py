"""The "<CODE> Team Leader" role: given in the admin site or in Configuration, and what a leader may decide."""

import json

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.backup import services
from apps.core.models import AuditLog
from apps.masterdata.models import WorkGroup
from apps.register.models import Contribution, Task, TaskPartner

from .test_register_api import base_task

User = get_user_model()


def role(code):
    return Group.objects.get(name=f"{code} Team Leader")


def holders(code):
    return sorted(role(code).user_set.values_list("username", flat=True))


def test_every_work_group_has_a_leader_role(seeded):
    for wg in WorkGroup.objects.all():
        assert Group.objects.filter(name=f"{wg.code} Team Leader").exists()
    assert holders("HR") == ["rakan.alauni"] and WorkGroup.objects.get(code="HR").leader.username == "rakan.alauni"


def test_role_given_in_the_admin_site_makes_the_leader(client_for):
    fin_team = User.objects.get(username="fin.team")
    fin_team.groups.add(role("FIN"))  # what the admin site does
    fin = WorkGroup.objects.get(code="FIN")
    assert fin.leader == fin_team and holders("FIN") == ["fin.team"]  # one leader per group
    assert "FIN Team Leader" in client_for("fin.team").get("/api/auth/me/").json()["roles"]
    # The previous leader still leads SCM and Support Services, but no longer Finance.
    desk = client_for("hussam.eldien.salah").get("/api/tasks/governance/").json()
    assert "FIN" not in {g["code"] for g in desk["groups"]}
    fin_team.groups.remove(role("FIN"))
    fin.refresh_from_db()
    assert fin.leader is None and holders("FIN") == []


def test_leader_picked_in_configuration_gets_the_role(client_for):
    ict = WorkGroup.objects.get(code="ICT")
    team = User.objects.get(username="ict.team")
    r = client_for("tmo.officer").patch(f"/api/work-groups/{ict.id}/", {"leader": team.id}, format="json")
    assert r.status_code == 200, r.content
    assert holders("ICT") == ["ict.team"]
    assert client_for("ict.team").get("/api/auth/me/").json()["permissions"]["leader"] is True
    client_for("tmo.officer").patch(f"/api/work-groups/{ict.id}/", {"leader": None}, format="json")
    assert holders("ICT") == []


def test_roles_follow_a_renamed_work_group(client_for):
    eng = WorkGroup.objects.get(code="ENG")
    if Task.objects.filter(work_group=eng).exists():
        eng = WorkGroup.objects.create(code="ZZ", name="Temporary")
    client_for("admin").patch(f"/api/work-groups/{eng.id}/", {"code": "QA"}, format="json")
    assert (
        Group.objects.filter(name="QA Team Leader").exists()
        and Group.objects.filter(name="QA Team Coordinator").exists()
    )


def test_leader_reviews_other_groups_direct_and_support_tasks(client_for):
    # ICT's Support task: HR is a partner, FIN receives a contribution.
    task_id = client_for("ict.team").post("/api/tasks/", base_task(), format="json").json()["id"]
    hr_row = TaskPartner.objects.get(task_id=task_id, work_group__code="HR")
    fin_row = Contribution.objects.get(task_id=task_id, to_group__code="FIN")
    hr, fin = client_for("rakan.alauni"), client_for("hussam.eldien.salah")
    links = hr.get("/api/tasks/governance/").json()["links"]
    mine = next(link for link in links if link["kind"] == "partner" and link["id"] == hr_row.id)
    assert mine["owner_role"] == "Support" and mine["can_review"] and mine["can_remove"]
    direct = next(link for link in links if link["task_code"] == "ICT-T030")
    assert direct["owner_role"] == "Direct"
    for decision, extra in (
        ("approved", {}),
        ("clarification", {"note": "Which sites?"}),
        ("rejected", {"note": "Not ours"}),
        ("timeline", {"note": "Later", "proposed_date": "2027-03-01"}),
    ):
        r = hr.post(f"/api/partners/{hr_row.id}/review/", {"decision": decision, **extra}, format="json")
        assert r.status_code == 200, (decision, r.content)
    assert (
        fin.post(f"/api/contributions/{fin_row.id}/review/", {"decision": "approved"}, format="json").status_code == 200
    )
    # A leader decides only for their own group.
    assert hr.post(f"/api/contributions/{fin_row.id}/review/", {"decision": "approved"}, format="json").status_code in (
        403,
        404,
    )


def test_leader_removes_a_link_with_a_reason(client_for):
    task_id = client_for("ict.team").post("/api/tasks/", base_task(), format="json").json()["id"]
    task = Task.objects.get(pk=task_id)
    hr_row = TaskPartner.objects.get(task=task, work_group__code="HR")
    hr = client_for("rakan.alauni")
    assert hr.post(f"/api/partners/{hr_row.id}/remove/", {"note": ""}, format="json").status_code == 400
    # The owning team cannot use the leader's remove.
    assert client_for("hr.team").post(
        f"/api/partners/{hr_row.id}/remove/", {"note": "x x x"}, format="json"
    ).status_code in (
        403,
        404,
    )
    r = hr.post(f"/api/partners/{hr_row.id}/remove/", {"note": "HR has no part in this task."}, format="json")
    assert r.status_code == 204, r.content
    assert not TaskPartner.objects.filter(pk=hr_row.id).exists()
    entry = AuditLog.objects.get(action="remove")
    assert entry.work_group == "ICT" and entry.changes["Reason"] == [None, "HR has no part in this task."]
    assert "HR leader removed partner" in entry.summary
    # The owning group sees it among the changes to its tasks.
    seen = client_for("ict.team").get("/api/audit/?action=remove").json()["results"]
    assert [e["id"] for e in seen] == [entry.id]
    fin_row = Contribution.objects.get(task=task, to_group__code="FIN")
    assert (
        client_for("hussam.eldien.salah")
        .post(f"/api/contributions/{fin_row.id}/remove/", {"note": "Not needed by FIN."}, format="json")
        .status_code
        == 204
    )


def test_no_removal_from_a_master_plan_task(client_for):
    row = TaskPartner.objects.filter(work_group__code="HR", task__status="in_master_plan").first()
    r = client_for("rakan.alauni").post(f"/api/partners/{row.id}/remove/", {"note": "Not ours at all."}, format="json")
    assert r.status_code == 400 and "Master Plan" in str(r.content)
    assert TaskPartner.objects.filter(pk=row.id).exists()


def test_restore_of_an_older_backup_gives_leaders_their_role(client_for):
    admin = client_for("admin")
    doc = json.loads(admin.get("/api/backup/export/").content)
    leader_roles = {
        o["pk"] for o in doc["data"] if o["model"] == "auth.group" and o["fields"]["name"].endswith(" Team Leader")
    }
    for o in doc["data"]:
        if o["model"] == "auth.user":
            o["fields"]["groups"] = [g for g in o["fields"]["groups"] if g not in leader_roles]
    doc["data"] = [o for o in doc["data"] if not (o["model"] == "auth.group" and o["pk"] in leader_roles)]
    doc["sha256"] = services._checksum(doc["data"])
    upload = SimpleUploadedFile("backup.json", json.dumps(doc).encode(), content_type="application/json")
    r = admin.post(
        "/api/backup/restore/", {"file": upload, "dry_run": "false", "confirm": "RESTORE"}, format="multipart"
    )
    assert r.status_code == 200, r.content
    assert holders("HR") == ["rakan.alauni"] and holders("ICT") == ["shadi.alghanim"]
