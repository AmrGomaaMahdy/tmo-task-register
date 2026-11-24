"""A leader away names a delegate, who approves and rejects in their place for a while."""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core import mail
from django.utils import timezone

from apps.accounts.models import LeaderDelegation
from apps.masterdata.models import WorkGroup
from apps.register.models import Task

User = get_user_model()


def wg(code):
    return WorkGroup.objects.get(code=code)


def name(client, group, delegate, start=0, days=5, **extra):
    today = timezone.localdate()
    body = {
        "work_group": wg(group).id,
        "delegate": User.objects.get(username=delegate).id,
        "starts_on": str(today + timedelta(days=start)),
        "ends_on": str(today + timedelta(days=start + days - 1)),
        **extra,
    }
    return client.post("/api/auth/delegations/", body, format="json")


def ready_task(group="HR"):
    t = Task.objects.filter(work_group__code=group).first()
    Task.objects.filter(pk=t.pk).update(status="ready", approval="pending")
    return t


def test_delegate_decides_while_the_delegation_runs(client_for):
    hr_leader, member = client_for("rakan.alauni"), client_for("hr.member")
    t = ready_task()
    assert member.post(f"/api/tasks/{t.id}/approval/", {"decision": "approved"}, format="json").status_code == 403
    r = name(hr_leader, "HR", "hr.member", note="Annual leave")
    assert r.status_code == 201 and r.json()["state"] == "active" and r.json()["leader_name"]
    member = client_for("hr.member")  # a fresh request user, as every real request has
    me = member.get("/api/auth/me/").json()
    assert me["permissions"]["leader"] is True and me["permissions"]["lead_own"] is False
    assert any(
        i["kind"] == "decide" and i["task"]["id"] == t.id for i in member.get("/api/notifications/").json()["items"]
    )
    assert member.post(f"/api/tasks/{t.id}/approval/", {"decision": "approved"}, format="json").status_code == 200
    # Deciding is all: the delegate does not edit the register.
    assert member.patch(f"/api/tasks/{t.id}/", {"title": "Changed by the delegate"}, format="json").status_code in (
        403,
        404,
    )


def test_cancelling_ends_it_at_once_and_the_delegate_is_told(client_for, settings):
    hr_leader, member = client_for("rakan.alauni"), client_for("hr.member")
    d = name(hr_leader, "HR", "hr.member").json()
    assert any("hr.member@" in m.to[0] for m in mail.outbox)
    assert hr_leader.post(f"/api/auth/delegations/{d['id']}/cancel/").json()["state"] == "cancelled"
    member = client_for("hr.member")
    t = ready_task()
    assert member.post(f"/api/tasks/{t.id}/approval/", {"decision": "approved"}, format="json").status_code == 403


def test_an_upcoming_delegation_gives_nothing_yet(client_for):
    name(client_for("rakan.alauni"), "HR", "hr.member", start=3)
    t = ready_task()
    assert (
        client_for("hr.member")
        .post(f"/api/tasks/{t.id}/approval/", {"decision": "approved"}, format="json")
        .status_code
        == 403
    )


def test_rules_on_who_names_whom_and_when(client_for):
    hr_leader = client_for("rakan.alauni")
    assert name(client_for("hr.team"), "HR", "hr.member").status_code == 403  # not the leader
    assert name(hr_leader, "ICT", "ict.team").status_code == 403  # not their group
    assert name(hr_leader, "HR", "ict.team").status_code == 400  # not in the group
    assert name(hr_leader, "HR", "rakan.alauni").status_code == 400  # themselves
    assert name(hr_leader, "HR", "hr.member", start=-1).status_code == 400  # in the past
    assert name(hr_leader, "HR", "hr.member", days=91).status_code == 400  # too long
    assert name(hr_leader, "HR", "hr.member").status_code == 201
    assert name(hr_leader, "HR", "hr.team", start=2).status_code == 400  # overlaps the running one
    assert name(client_for("admin"), "HR", "hr.team", start=10).status_code == 201  # admin, for the leader
    assert LeaderDelegation.objects.filter(work_group__code="HR", leader__username="rakan.alauni").count() == 2


def test_candidates_are_the_group_people_except_the_leader(client_for):
    people = client_for("rakan.alauni").get(f"/api/auth/delegations/candidates/?work_group={wg('HR').id}").json()
    names = {p["id"] for p in people}
    assert User.objects.get(username="hr.member").id in names
    assert User.objects.get(username="rakan.alauni").id not in names
    assert client_for("hr.member").get(f"/api/auth/delegations/candidates/?work_group={wg('HR').id}").status_code == 403
