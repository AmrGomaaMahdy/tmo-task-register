"""Work group leaders: approval of Direct tasks and review of the links other groups record with them."""

import pytest
from django.contrib.auth import get_user_model

from apps.masterdata.models import LookupValue, WorkGroup
from apps.register.models import Contribution, Task, TaskPartner


def task(code):
    return Task.objects.get(code=code)


def direct_pending(group="ICT"):
    return (
        Task.objects.filter(work_group__code=group, owner_role__semantic=LookupValue.Semantic.DIRECT)
        .exclude(status="in_master_plan")
        .first()
    )


def test_a_leader_is_a_member_and_shows_as_leader(client_for):
    me = client_for("shadi.alghanim").get("/api/auth/me/").json()
    assert "ICT Team Leader" in me["roles"] and me["permissions"]["leader"] and me["permissions"]["governance"]
    assert me["work_groups"] == [
        {
            "id": WorkGroup.objects.get(code="ICT").id,
            "code": "ICT",
            "name": me["work_groups"][0]["name"],
            "leader": True,
        }
    ]
    assert not client_for("ict.team").get("/api/auth/me/").json()["permissions"]["leader"]
    assert WorkGroup.objects.get(code="ICT").leader.username == "shadi.alghanim"


def test_only_the_tmo_or_admin_names_the_leader(client_for):
    hr = WorkGroup.objects.get(code="HR")
    user = get_user_model().objects.get(username="hr.team")
    assert (
        client_for("hr.team").patch(f"/api/work-groups/{hr.id}/", {"leader": user.id}, format="json").status_code == 403
    )
    assert client_for("hr.team").get("/api/work-groups/leader-candidates/").status_code == 403
    r = client_for("tmo.officer").patch(f"/api/work-groups/{hr.id}/", {"leader": user.id}, format="json")
    assert r.status_code == 200 and r.json()["leader_name"]
    assert any(
        u["username"] == "hr.team" for u in client_for("tmo.officer").get("/api/work-groups/leader-candidates/").json()
    )


def submit(client, t):
    """The Focal Point submits the task: Ready to include, waiting for the leader."""
    r = client.post(f"/api/tasks/{t.id}/transition/", {"status": "ready"}, format="json")
    assert r.status_code == 200, r.content
    return r.json()


def test_leader_decides_on_ready_tasks_only(client_for):
    t = task("ICT-T030")  # Needs completion
    url = f"/api/tasks/{t.id}/approval/"
    leader = client_for("shadi.alghanim")
    assert leader.post(url, {"decision": "approved"}, format="json").status_code == 400  # not submitted yet
    assert submit(client_for("ict.team"), t)["status"] == "ready"
    assert client_for("ict.team").post(url, {"decision": "approved"}, format="json").status_code == 403
    assert client_for("rakan.alauni").post(url, {"decision": "approved"}, format="json").status_code in (403, 404)
    # Since 1.20 the leader only approves or rejects: no question, no new date.
    for old in ("clarification", "timeline"):
        assert leader.post(url, {"decision": old, "note": "x y z"}, format="json").status_code == 400
    r = leader.post(url, {"decision": "approved"}, format="json")
    assert r.status_code == 200 and r.json()["status"] == "leader_approved" and r.json()["approval_by_name"]


def test_leader_rejection_or_question_sends_the_task_back(client_for):
    t = task("ICT-T030")
    submit(client_for("ict.team"), t)
    r = client_for("shadi.alghanim").post(
        f"/api/tasks/{t.id}/approval/", {"decision": "rejected", "note": "Duplicate of ICT-T031"}, format="json"
    )
    body = r.json()
    assert body["status"] == "needs_completion" and body["approval"] == "rejected"
    assert any("Duplicate of ICT-T031" in c["message"] for c in body["checks"] if c["field"] == "approval")
    # The Focal Point completes it and submits again: the leader decides on the new version.
    fp = client_for("ict.team")
    assert fp.patch(f"/api/tasks/{t.id}/", {"title": t.title + " (revised)"}, format="json").status_code == 200
    again = submit(fp, t)
    assert again["approval"] == "pending" and again["status"] == "ready"
    # A rejection without a reason is accepted too (the reason is given when needed).
    r = client_for("shadi.alghanim").post(f"/api/tasks/{t.id}/approval/", {"decision": "rejected"}, format="json")
    assert r.json()["status"] == "needs_completion" and r.json()["approval_note"] == ""


def test_every_task_type_goes_to_the_leader(client_for):
    t = (
        Task.objects.filter(work_group__code="ICT", status="ready")
        .exclude(owner_role__semantic=LookupValue.Semantic.DIRECT)
        .first()
    )
    assert t is not None  # an Enable / Support task waiting for its leader
    r = client_for("shadi.alghanim").post(f"/api/tasks/{t.id}/approval/", {"decision": "approved"}, format="json")
    assert r.status_code == 200 and r.json()["status"] == "leader_approved"


def test_focal_point_edits_only_while_preparing(client_for):
    fp = client_for("ict.team")
    t = task("ICT-T030")
    assert fp.patch(f"/api/tasks/{t.id}/", {"title": "Still being prepared"}, format="json").status_code == 200
    submit(fp, t)
    assert fp.patch(f"/api/tasks/{t.id}/", {"title": "Changed after submitting"}, format="json").status_code == 403
    assert fp.delete(f"/api/tasks/{t.id}/").status_code == 403
    # Before the leader decides, the Focal Point may withdraw it to Draft and change it again.
    r = fp.post(f"/api/tasks/{t.id}/transition/", {"status": "draft"}, format="json")
    assert r.status_code == 200 and r.json()["access"]["can_edit"] and r.json()["access"]["can_delete"]
    approved = Task.objects.filter(work_group__code="ICT", status="in_master_plan").first()
    assert fp.patch(f"/api/tasks/{approved.id}/", {"title": "x y z"}, format="json").status_code == 403
    assert fp.post(f"/api/tasks/{approved.id}/transition/", {"status": "draft"}, format="json").status_code == 403


def test_tmo_includes_or_sends_back_leader_approved_tasks(client_for):
    t = task("ICT-T030")
    submit(client_for("ict.team"), t)
    client_for("shadi.alghanim").post(f"/api/tasks/{t.id}/approval/", {"decision": "approved"}, format="json")
    tmo = client_for("tmo.officer")
    plan = {r["code"]: r for r in tmo.get("/api/tasks/master-plan/").json()}
    assert plan["ICT-T030"]["status"] == "leader_approved" and plan["ICT-T030"]["can_include"]
    assert plan["ICT-T030"]["can_return"]
    url = f"/api/tasks/{t.id}/transition/"
    assert tmo.post(url, {"status": "needs_completion"}, format="json").status_code == 400  # reason needed
    r = tmo.post(url, {"status": "needs_completion", "note": "Split the rollout by site"}, format="json")
    body = r.json()
    assert body["status"] == "needs_completion" and body["tmo_note"] == "Split the rollout by site"
    assert body["approval"] == "pending" and body["tmo_by_name"]
    assert any("TMO sent this task back: Split the rollout by site" in c["message"] for c in body["checks"])
    # Back through the leader, then included.
    submit(client_for("ict.team"), t)
    client_for("shadi.alghanim").post(f"/api/tasks/{t.id}/approval/", {"decision": "approved"}, format="json")
    r = tmo.post(url, {"status": "in_master_plan"}, format="json")
    assert r.status_code == 200 and r.json()["status"] == "in_master_plan"
    # A task in the plan goes back to the group only with a reason.
    r = tmo.post(url, {"status": "needs_completion", "note": "Dates moved"}, format="json")
    assert r.json()["status"] == "needs_completion"


def test_leader_desk_shows_only_ready_tasks(client_for):
    desk = client_for("shadi.alghanim").get("/api/tasks/governance/").json()
    assert desk["direct"] and all(d["status"] == "ready" and d["can_decide"] for d in desk["direct"])
    assert desk["pending"]["direct"] == len(desk["direct"])
    assert {d["owner_role"] for d in desk["direct"]} >= {"Enable"}


def test_deleting_a_task_deletes_its_activities_and_records_the_reason(client_for):
    from apps.core.models import AuditLog
    from apps.register.models import Activity

    t = task("ICT-T030")
    n = t.activities.count()
    assert n > 0
    r = client_for("ict.team").delete(f"/api/tasks/{t.id}/", {"reason": "Merged into ICT-T031"}, format="json")
    assert r.status_code == 204
    assert not Activity.objects.filter(task_id=t.id).exists()
    entry = AuditLog.objects.filter(action="delete", entity_label="ICT-T030").latest("created_at")
    assert entry.changes["Reason"] == ["Merged into ICT-T031", None]
    assert entry.changes["Activities deleted"] == [n, None]


def test_governance_desk_lists_direct_tasks_and_links_to_review(client_for):
    assert client_for("ict.team").get("/api/tasks/governance/").status_code == 403
    desk = client_for("rakan.alauni").get("/api/tasks/governance/").json()
    assert [g["code"] for g in desk["groups"]] == ["HR"]
    assert all(d["work_group_code"] == "HR" and d["can_decide"] for d in desk["direct"])
    assert desk["links"] and all(
        x["group"] == "HR" and x["from_group"] != "HR" and x["can_review"] for x in desk["links"]
    )
    kinds = {x["kind"] for x in desk["links"]}
    assert "partner" in kinds
    assert desk["pending"]["links"] == sum(1 for x in desk["links"] if x["review"] == "pending")
    every = client_for("tmo.officer").get("/api/tasks/governance/").json()
    assert len(every["groups"]) == WorkGroup.objects.filter(is_active=True).count()
    assert not any(x["can_review"] for x in every["links"])  # the TMO sees, leaders decide


def test_partner_group_leader_reviews_a_link(client_for):
    row = TaskPartner.objects.get(task__code="ICT-T041", work_group__code="HR")
    url = f"/api/partners/{row.id}/review/"
    assert client_for("shadi.alghanim").post(url, {"decision": "approved"}, format="json").status_code == 403
    hr = client_for("rakan.alauni")
    assert hr.post(url, {"decision": "timeline", "note": "Later"}, format="json").status_code == 400  # not offered
    r = hr.post(url, {"decision": "approved", "note": "After the hiring freeze"}, format="json")
    assert (
        r.status_code == 200
        and r.json()["review"] == "approved"
        and r.json()["review_note"] == "After the hiring freeze"
    )
    hr.post(url, {"decision": "rejected", "note": "Not our scope"}, format="json")
    assert not client_for("ict.team").get(f"/api/tasks/{row.task_id}/").json()["check_summary"]["ok"]


def test_receiving_group_leader_reviews_a_contribution(client_for):
    c = Contribution.objects.filter(to_group__leader__isnull=False).first()
    if c is None:
        pytest.skip("no contribution to a group with a leader in the sample data")
    leader = c.to_group.leader.username
    r = client_for(leader).post(f"/api/contributions/{c.id}/review/", {"decision": "approved"}, format="json")
    assert r.status_code == 200 and r.json()["review"] == "approved"
    other = "rakan.alauni" if leader != "rakan.alauni" else "hussam.eldien.salah"
    r = client_for(other).post(f"/api/contributions/{c.id}/review/", {"decision": "approved"}, format="json")
    assert r.status_code in (403, 404)


def test_reviews_survive_an_unchanged_save_and_reset_on_a_change(client_for):
    row = (
        TaskPartner.objects.filter(task__work_group__code="ICT", work_group__code="HR")
        .exclude(task__status="in_master_plan")
        .first()
    )
    client_for("rakan.alauni").post(f"/api/partners/{row.id}/review/", {"decision": "approved"}, format="json")
    team = client_for("ict.team")
    body = team.get(f"/api/tasks/{row.task_id}/").json()
    keep = [
        {k: p[k] for k in ("work_group", "role", "need", "needed_when", "their_task_ref")} for p in body["partners"]
    ]
    assert team.patch(f"/api/tasks/{row.task_id}/", {"partners": keep}, format="json").status_code == 200
    assert TaskPartner.objects.get(task_id=row.task_id, work_group__code="HR").review == "approved"
    for p in keep:
        if p["work_group"] == row.work_group_id:
            p["need"] = p["need"] + " and the approval letter"
    r = team.patch(f"/api/tasks/{row.task_id}/", {"partners": keep}, format="json")
    assert r.status_code == 200, r.content
    assert TaskPartner.objects.get(task_id=row.task_id, work_group__code="HR").review == "pending"


def test_register_timeline_follows_the_user(client_for):
    mine = client_for("ict.team").get("/api/tasks/timeline/").json()
    assert mine and {r["work_group_code"] for r in mine} == {"ICT"}
    assert len(client_for("tmo.officer").get("/api/tasks/timeline/").json()) == Task.objects.count()
    some = client_for("tmo.officer").get("/api/tasks/timeline/?status=ready").json()
    assert {r["status"] for r in some} <= {"ready"}


def test_workflow_lists_each_step_with_who_and_when(client_for):
    t = task("ICT-T030")
    fp, leader, tmo = client_for("ict.team"), client_for("shadi.alghanim"), client_for("tmo.officer")
    submit(fp, t)
    leader.post(f"/api/tasks/{t.id}/approval/", {"decision": "rejected", "note": "Split by site"}, format="json")
    submit(fp, t)
    leader.post(f"/api/tasks/{t.id}/approval/", {"decision": "approved"}, format="json")
    tmo.post(f"/api/tasks/{t.id}/transition/", {"status": "in_master_plan"}, format="json")
    flow = client_for("hr.member").get(f"/api/tasks/{t.id}/workflow/")
    assert flow.status_code in (403, 404)  # only those who can see the task (HR member does not see ICT tasks)
    flow = fp.get(f"/api/tasks/{t.id}/workflow/").json()
    kinds = [e["kind"] for e in flow["events"]]
    assert kinds[0] == "created"  # from the task itself: the sample was loaded without an audit entry
    assert kinds[1:] == ["submitted", "leader_rejected", "submitted", "leader_approved", "included"]
    rejected = flow["events"][2]
    assert rejected["note"] == "Split by site" and rejected["role"] == "Leader" and rejected["by"]
    assert flow["events"][-1]["role"] == "TMO" and flow["status"] == "in_master_plan"
    assert all(e["at"] for e in flow["events"])


def test_workflow_completes_a_submission_the_audit_trail_does_not_have(client_for):
    """A task loaded as Ready to include (no audit entry) still shows that it was submitted."""
    t = task("ICT-T030")
    Task.objects.filter(pk=t.pk).update(status="ready")
    kinds = [e["kind"] for e in client_for("ict.team").get(f"/api/tasks/{t.id}/workflow/").json()["events"]]
    assert kinds == ["created", "submitted"]
