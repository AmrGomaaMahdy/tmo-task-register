"""The TMO Action Center and the management report (1.27)."""

from django.utils import timezone

from apps.core.models import AuditLog
from apps.register.models import Task


def test_tmo_desk_lists_leader_approved_tasks_and_recent_decisions(client_for):
    tmo = client_for("tmo.officer")
    t = Task.objects.filter(status="ready").first() or Task.objects.first()
    Task.objects.filter(pk=t.pk).update(status="leader_approved", approval="approved", approval_at=timezone.now())
    body = tmo.get("/api/tmo-desk/").json()
    waiting = {r["code"] for r in body["waiting"]}
    assert waiting == set(Task.objects.filter(status="leader_approved").values_list("code", flat=True))
    assert all("waiting_days" in r and "can_include" in r for r in body["waiting"])

    row = next(r for r in body["waiting"] if r["can_return"])
    tmo.post(f"/api/tasks/{row['id']}/transition/", {"status": "needs_completion", "note": "Dates"}, format="json")
    body = tmo.get("/api/tmo-desk/").json()
    assert row["code"] not in {r["code"] for r in body["waiting"]}
    back = next(d for d in body["decided"] if d["code"] == row["code"])
    assert back["outcome"] == "returned" and back["note"] == "Dates" and back["by"]


def test_tmo_desk_is_for_the_tmo_and_administrators(client_for):
    assert client_for("admin").get("/api/tmo-desk/").status_code == 200
    for user in ("shadi.alghanim", "ict.team", "committee.viewer"):
        assert client_for(user).get("/api/tmo-desk/").status_code == 403


def test_board_summary_counts_the_register(client_for):
    body = client_for("committee.viewer").get("/api/reports/board-summary/").json()
    assert body["totals"]["tasks"] == Task.objects.count()
    assert sum(body["totals"]["by_status"].values()) == Task.objects.count()
    assert body["plan"]["included"] == Task.objects.filter(status="in_master_plan").count()
    assert sum(g["total"] for g in body["groups"]) == Task.objects.count()
    assert 0 <= body["plan"]["progress"] <= 100 and body["scope"] is None

    ict = Task.objects.filter(work_group__code="ICT").first().work_group_id
    one = client_for("tmo.officer").get(f"/api/reports/board-summary/?work_group={ict}").json()
    assert one["scope"]["code"] == "ICT" and [g["code"] for g in one["groups"]] == ["ICT"]
    assert one["totals"]["tasks"] == Task.objects.filter(work_group_id=ict).count()


def test_board_summary_is_for_those_who_read_every_register(client_for):
    for user in ("shadi.alghanim", "ict.team", "hr.member"):
        assert client_for(user).get("/api/reports/board-summary/").status_code == 403
    admin = client_for("admin")
    assert admin.post("/api/reports/board-summary/exported/", {"scope": "All work groups"}).status_code == 204
    assert AuditLog.objects.filter(action="export", entity="Report").exists()


def test_dependencies_report_counts_links_and_recent_decisions(client_for):
    from apps.register.models import Contribution, TaskPartner

    body = client_for("committee.viewer").get("/api/reports/dependencies/").json()
    links = TaskPartner.objects.count() + Contribution.objects.filter(to_group__isnull=False).count()
    assert body["totals"]["links"] == links == sum(c["total"] for c in body["matrix"])
    assert body["open_total"] == links - body["totals"]["approved"]

    leader = client_for("shadi.alghanim")
    t = Task.objects.filter(work_group__code="ICT", status="ready").first()
    if t:
        leader.post(f"/api/tasks/{t.id}/approval/", {"decision": "approved"}, format="json")
        body = client_for("tmo.officer").get("/api/reports/dependencies/").json()
        assert any(d["code"] == t.code and d["role"] == "leader" for d in body["decisions"])
    assert client_for("ict.team").get("/api/reports/dependencies/").status_code == 403
