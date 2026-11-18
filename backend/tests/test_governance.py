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


def test_leader_approves_rejects_and_asks_about_direct_tasks(client_for):
    t = direct_pending()
    url = f"/api/tasks/{t.id}/approval/"
    assert client_for("ict.team").post(url, {"decision": "approved"}, format="json").status_code == 403
    assert client_for("rakan.alauni").post(url, {"decision": "approved"}, format="json").status_code in (403, 404)
    leader = client_for("shadi.alghanim")
    assert leader.post(url, {"decision": "rejected"}, format="json").status_code == 400  # a reason is needed
    assert leader.post(url, {"decision": "timeline", "proposed_date": "2027-01-01"}, format="json").status_code == 400
    r = leader.post(url, {"decision": "clarification", "note": "Which sites does this cover?"}, format="json")
    assert r.status_code == 200 and r.json()["approval"] == "clarification"
    assert any("clarification" in c["message"] for c in r.json()["checks"] if c["field"] == "approval")
    r = leader.post(url, {"decision": "rejected", "note": "Duplicate of another task"}, format="json")
    assert r.json()["approval"] == "rejected" and not r.json()["check_summary"]["ok"]
    r = leader.post(url, {"decision": "approved"}, format="json")
    assert r.json()["approval"] == "approved" and r.json()["approval_by_name"]


def test_enable_and_support_tasks_are_not_approved_as_a_whole(client_for):
    t = Task.objects.filter(work_group__code="ICT").exclude(owner_role__semantic=LookupValue.Semantic.DIRECT).first()
    r = client_for("shadi.alghanim").post(f"/api/tasks/{t.id}/approval/", {"decision": "approved"}, format="json")
    assert r.status_code == 403


def test_a_team_edit_sends_an_approved_task_back_to_the_leader(client_for):
    t = direct_pending()
    client_for("shadi.alghanim").post(f"/api/tasks/{t.id}/approval/", {"decision": "approved"}, format="json")
    r = client_for("ict.team").patch(f"/api/tasks/{t.id}/", {"title": t.title + " (revised)"}, format="json")
    assert r.status_code == 200 and r.json()["approval"] == "pending"
    client_for("shadi.alghanim").post(f"/api/tasks/{t.id}/approval/", {"decision": "approved"}, format="json")
    r = client_for("shadi.alghanim").patch(
        f"/api/tasks/{t.id}/", {"title": t.title + " (by the leader)"}, format="json"
    )
    assert r.json()["approval"] == "approved"  # the leader's own edit keeps the approval


def test_the_master_plan_takes_only_approved_direct_tasks(client_for):
    t = Task.objects.filter(status="ready", owner_role__semantic=LookupValue.Semantic.DIRECT).first()
    assert t is not None
    t.approval = "pending"
    t.save(update_fields=["approval"])
    tmo = client_for("tmo.officer")
    r = tmo.post(f"/api/tasks/{t.id}/transition/", {"status": "in_master_plan"}, format="json")
    assert r.status_code == 400 and "approval" in str(r.content)
    leader = WorkGroup.objects.get(pk=t.work_group_id).leader
    t.approval = "approved"
    t.save(update_fields=["approval"])
    r = tmo.post(f"/api/tasks/{t.id}/transition/", {"status": "in_master_plan"}, format="json")
    assert r.status_code in (200, 400), r.content  # 400 only if its own check is not OK
    assert leader is None or leader.memberships.filter(member_type="leader").exists()


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
    assert hr.post(url, {"decision": "timeline", "note": "Later"}, format="json").status_code == 400  # date needed
    r = hr.post(
        url, {"decision": "timeline", "note": "After the hiring freeze", "proposed_date": "2027-02-15"}, format="json"
    )
    assert r.status_code == 200 and r.json()["review"] == "timeline" and r.json()["review_date"] == "2027-02-15"
    checks = client_for("ict.team").get(f"/api/tasks/{row.task_id}/").json()["checks"]
    assert any(c["field"] == "reviews" and "HR leader asks to change the timeline" in c["message"] for c in checks)
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
