"""The action centre: each role sees what waits for it, and an item goes away once it is done."""

from apps.register.models import Task, TaskPartner


def task(code):
    return Task.objects.get(code=code)


def items(client, kind=None):
    body = client.get("/api/notifications/").json()
    return [i for i in body["items"] if kind is None or i["kind"] == kind], body


def keys(client, kind):
    return {i["task"]["code"] for i in items(client, kind)[0]}


def test_the_flow_moves_the_action_from_one_role_to_the_next(client_for):
    t = task("ICT-T030")  # Needs completion
    fp, leader, tmo = client_for("ict.team"), client_for("shadi.alghanim"), client_for("tmo.officer")
    assert "ICT-T030" in keys(fp, "complete")

    fp.post(f"/api/tasks/{t.id}/transition/", {"status": "ready"}, format="json")
    assert "ICT-T030" not in keys(fp, "complete")
    decide = [i for i in items(leader, "decide")[0] if i["task"]["code"] == "ICT-T030"][0]
    assert decide["role"] == "Leader" and decide["by"] and decide["url"] == f"/tasks/{t.id}?act=decide"
    assert "ICT-T030" not in keys(client_for("hr.team"), "decide")  # only the group's own leader

    leader.post(f"/api/tasks/{t.id}/approval/", {"decision": "rejected", "note": "Split by site"}, format="json")
    assert "ICT-T030" not in keys(leader, "decide")
    back = [i for i in items(fp, "returned_leader")[0] if i["task"]["code"] == "ICT-T030"][0]
    assert back["note"] == "Split by site" and back["by"]

    fp.post(f"/api/tasks/{t.id}/transition/", {"status": "ready"}, format="json")
    leader.post(f"/api/tasks/{t.id}/approval/", {"decision": "approved"}, format="json")
    assert "ICT-T030" in keys(tmo, "include")
    assert "ICT-T030" not in keys(fp, "returned_leader")

    tmo.post(f"/api/tasks/{t.id}/transition/", {"status": "needs_completion", "note": "Dates overlap"}, format="json")
    back = [i for i in items(fp, "returned_tmo")[0] if i["task"]["code"] == "ICT-T030"][0]
    assert back["note"] == "Dates overlap" and "ICT-T030" not in keys(tmo, "include")


def test_link_reviews_reach_the_other_groups_leader_and_rejections_come_back(client_for):
    row = TaskPartner.objects.get(task__code="ICT-T041", work_group__code="HR")
    TaskPartner.objects.filter(pk=row.pk).update(review="pending")
    Task.objects.filter(pk=row.task_id).update(status="needs_completion")
    hr_leader = client_for("rakan.alauni")
    review = [i for i in items(hr_leader, "review_link")[0] if i["link"]["id"] == row.id]
    assert review and review[0]["url"] == f"/governance?tab=links&link=partner-{row.id}"

    hr_leader.post(
        f"/api/partners/{row.id}/review/", {"decision": "rejected", "note": "Not in our scope"}, format="json"
    )
    assert not [i for i in items(hr_leader, "review_link")[0] if i["link"]["id"] == row.id]
    back = [i for i in items(client_for("ict.team"), "link_rejected")[0] if i["link"]["id"] == row.id][0]
    assert back["note"] == "Not in our scope" and back["link"]["group_code"] == "HR"


def test_new_items_are_marked_until_the_list_is_opened(client_for):
    fp = client_for("ict.team")
    _, body = items(fp)
    assert body["count"] > 0 and body["new"] == body["count"]
    assert fp.post("/api/notifications/seen/").status_code == 204
    assert items(fp)[1]["new"] == 0


def test_viewers_and_members_have_nothing_to_do(client_for):
    for user in ("committee.viewer", "hr.member"):
        assert client_for(user).get("/api/notifications/").json()["count"] == 0


def test_opening_an_item_without_acting_keeps_it_in_the_list(client_for):
    t = task("ICT-T030")  # Needs completion
    fp, leader = client_for("ict.team"), client_for("shadi.alghanim")
    # The Focal Point opens it and saves without moving it on: still theirs to complete.
    assert fp.get(f"/api/tasks/{t.id}/").status_code == 200
    assert fp.patch(f"/api/tasks/{t.id}/", {"title": t.title}, format="json").status_code == 200
    fp.post("/api/notifications/seen/")
    assert "ICT-T030" in keys(fp, "complete")

    fp.post(f"/api/tasks/{t.id}/transition/", {"status": "ready"}, format="json")
    # The leader opens it from the bell and leaves without deciding: it stays, and still counts.
    assert leader.get(f"/api/tasks/{t.id}/").status_code == 200
    leader.post("/api/notifications/seen/")
    _, body = items(leader)
    assert "ICT-T030" in keys(leader, "decide") and body["count"] > 0 and body["new"] == 0

    leader.post(f"/api/tasks/{t.id}/approval/", {"decision": "approved"}, format="json")
    assert "ICT-T030" not in keys(leader, "decide")
