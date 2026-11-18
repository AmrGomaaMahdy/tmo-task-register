"""Task description, member contact details, the audit trail and the System issues page."""

import csv
import io

from django.core.cache import cache
from rest_framework.test import APIClient

from apps.core.models import AuditLog, SystemEvent
from apps.masterdata.models import GroupMember, WorkGroup
from apps.register.models import Task

from .conftest import PASSWORD
from .test_register_api import base_task


def test_task_description_is_saved_trimmed_and_searchable(client_for):
    c = client_for("ict.team")
    body = {**base_task(), "description": "  Merge the three desks into one.  \n\n\n\nScope: HQ and sites.   "}
    r = c.post("/api/tasks/", body, format="json")
    assert r.status_code == 201, r.content
    assert r.json()["description"] == "Merge the three desks into one.\n\nScope: HQ and sites."
    found = c.get("/api/tasks/?search=three desks").json()["results"]
    assert [t["code"] for t in found] == [r.json()["code"]] and found[0]["description"].startswith("Merge")


def test_task_edit_records_before_and_after(client_for):
    task = Task.objects.get(code="ICT-T030")
    c = client_for("ict.team")
    old_title = task.title
    r = c.patch(
        f"/api/tasks/{task.id}/",
        {"title": "A clearer title", "description": "Why and what."},
        format="json",
        HTTP_USER_AGENT="pytest-browser",
        REMOTE_ADDR="10.1.2.3",
    )
    assert r.status_code == 200, r.content
    entry = AuditLog.objects.filter(action="update", entity_label="ICT-T030").latest("created_at")
    assert entry.changes["Title"] == [old_title, "A clearer title"]
    assert entry.changes["Description"] == [None, "Why and what."]
    assert entry.work_group == "ICT" and entry.actor_name == "ict.team"
    assert entry.method == "PATCH" and entry.path == f"/api/tasks/{task.id}/"
    assert entry.user_agent == "pytest-browser" and entry.ip == "10.1.2.3"
    assert "Title" in entry.summary


def test_partner_rows_and_activities_are_in_the_changes(client_for):
    task = Task.objects.get(code="ICT-T030")
    c = client_for("ict.team")
    a = task.activities.order_by("order").first()
    c.patch(f"/api/activities/{a.id}/", {"name": "Map the planning work"}, format="json")
    entry = AuditLog.objects.filter(entity_label="ICT-T030", action="update").latest("created_at")
    assert entry.changes["Name"][1] == "Map the planning work" and a.code in entry.summary


def test_member_contact_details(client_for):
    hr = WorkGroup.objects.get(code="HR")
    c = client_for("admin")
    r = c.post(
        "/api/members/",
        {
            "name": "Sara Nasser",
            "work_group": hr.id,
            "job_title": "  HR   Business Partner ",
            "email": "Sara.Nasser@Example.com",
            "phone": "+966 11 234 5678",
        },
        format="json",
    )
    assert r.status_code == 201, r.content
    m = r.json()
    assert m["job_title"] == "HR Business Partner" and m["email"] == "sara.nasser@example.com"
    dup = c.post(
        "/api/members/", {"name": "Other", "work_group": hr.id, "email": "SARA.NASSER@example.com"}, format="json"
    )
    assert dup.status_code == 400 and "already has this email" in str(dup.content)
    bad = c.post("/api/members/", {"name": "Other", "work_group": hr.id, "email": "not-an-email"}, format="json")
    assert bad.status_code == 400
    phone = c.post("/api/members/", {"name": "Other", "work_group": hr.id, "phone": "call me"}, format="json")
    assert phone.status_code == 400 and "digits" in str(phone.content)
    c.patch(f"/api/members/{m['id']}/", {"phone": "+966 50 000 0000"}, format="json")
    entry = AuditLog.objects.filter(entity="Group member", action="update").latest("created_at")
    assert entry.changes["Phone"] == ["+966 11 234 5678", "+966 50 000 0000"]
    assert GroupMember.objects.get(pk=m["id"]).email == "sara.nasser@example.com"


def test_audit_filters_facets_and_visibility(client_for):
    task = Task.objects.get(code="ICT-T030")
    client_for("ict.team").patch(f"/api/tasks/{task.id}/", {"title": "Trail test title"}, format="json")
    tmo = client_for("tmo.officer")
    rows = tmo.get("/api/audit/?action=update&actor=ict.team&q=Trail").json()["results"]
    assert rows and all(r["action"] == "update" and r["actor_name"] == "ict.team" for r in rows)
    assert tmo.get("/api/audit/?work_group=ICT&entity=Task").json()["count"] >= 1
    facets = tmo.get("/api/audit/facets/").json()
    assert "ict.team" in facets["actors"] and {"value": "login_failed", "label": "Failed sign-in"} in facets["actions"]
    detail = tmo.get(f"/api/audit/{rows[0]['id']}/").json()
    assert detail["changes"]["Title"][1] == "Trail test title"
    # A team member sees only what they did.
    own = client_for("hr.team").get("/api/audit/").json()["results"]
    assert all(r["actor_name"] == "hr.team" for r in own)


def test_audit_export_is_csv_and_formula_safe(client_for):
    task = Task.objects.get(code="ICT-T030")
    client_for("ict.team").patch(f"/api/tasks/{task.id}/", {"title": "=1+1 looks like a formula"}, format="json")
    r = client_for("admin").get("/api/audit/export/?q=formula")
    assert r.status_code == 200 and r["Content-Type"].startswith("text/csv")
    rows = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig"))))
    assert rows[0][0] == "Time" and len(rows) >= 2
    assert all(not cell.startswith(("=", "+", "@")) for row in rows[1:] for cell in row)


def test_failed_sign_in_is_in_the_trail_and_the_issues(seeded):
    cache.clear()
    APIClient().post("/api/auth/login/", {"username": "ict.team", "password": "wrong"})
    APIClient().post("/api/auth/login/", {"username": "ict.team", "password": "wrong-again"})
    entry = AuditLog.objects.filter(action="login_failed").latest("created_at")
    assert entry.actor is None and entry.actor_name == "ict.team" and "ict.team" in entry.summary
    event = SystemEvent.objects.get(kind="login_failed", username="ict.team")
    assert event.source == "security" and event.level == "warning" and event.count == 2


def test_server_errors_are_stored_with_traceback(client_for, monkeypatch):
    from apps.register.views import TaskViewSet

    def boom(self, request):
        raise ZeroDivisionError("division by zero in summary")

    monkeypatch.setattr(TaskViewSet, "summary", boom)
    c = client_for("ict.team")
    c.raise_request_exception = False
    r = c.get("/api/tasks/summary/")
    assert r.status_code == 500
    event = SystemEvent.objects.get(source="server", kind="ZeroDivisionError")
    assert event.level == "error" and "division by zero" in event.message
    assert "Traceback" in event.detail and "boom" in event.detail
    assert event.path == "/api/tasks/summary/" and event.username == "ict.team" and event.status_code in (500, None)


def test_browser_errors_and_issue_handling(client_for):
    c = client_for("hr.team")
    r = c.post(
        "/api/client-errors/",
        {
            "message": "TypeError: x is undefined",
            "stack": "at Gantt (Gantt.tsx:12)",
            "url": "/register?view=gantt",
            "where": "Task Register",
        },
        format="json",
    )
    assert r.status_code == 204
    event = SystemEvent.objects.get(source="browser")
    assert event.username == "hr.team" and "Gantt.tsx" in event.detail and event.path == "/register?view=gantt"
    # Only administrators read and handle issues.
    assert client_for("tmo.officer").get("/api/system-events/").status_code == 403
    admin = client_for("admin")
    listed = admin.get("/api/system-events/?source=browser&resolved=false").json()["results"]
    assert [e["id"] for e in listed] == [event.id]
    assert admin.get("/api/system-events/summary/").json()["browser_open"] == 1
    done = admin.post(f"/api/system-events/{event.id}/resolve/", {"note": "Fixed in 1.14"}, format="json").json()
    assert done["resolved"] and done["resolution_note"] == "Fixed in 1.14" and done["resolved_by_name"]
    assert admin.post(f"/api/system-events/{event.id}/reopen/").json()["resolved"] is False
    n = admin.post("/api/system-events/resolve-all/?source=browser", {"note": "Checked"}, format="json").json()
    assert n["resolved"] == 1


def test_refused_requests_become_security_warnings(client_for):
    client_for("ict.team").get("/api/backup/export/")
    event = SystemEvent.objects.get(kind="permission_denied")
    assert event.username == "ict.team" and event.path == "/api/backup/export/" and event.status_code == 403


def test_me_flags_for_the_new_pages(client_for):
    assert client_for("admin").get("/api/auth/me/").json()["permissions"]["system"] is True
    tmo = client_for("tmo.officer").get("/api/auth/me/").json()["permissions"]
    assert tmo["audit"] is True and tmo["system"] is False
    assert client_for("ict.team").get("/api/auth/me/").json()["permissions"]["audit"] is False


def test_sign_in_password_is_never_stored(seeded):
    cache.clear()
    APIClient().post("/api/auth/login/", {"username": "fin.team", "password": "Sup3r-Secret-Guess"})
    APIClient().post("/api/auth/login/", {"username": "fin.team", "password": PASSWORD})
    text = " ".join(str(e.changes) + e.summary for e in AuditLog.objects.all())
    text += " ".join(e.message + e.detail for e in SystemEvent.objects.all())
    assert "Sup3r-Secret-Guess" not in text and PASSWORD not in text
