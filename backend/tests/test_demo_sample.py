"""The whole demo sample: tasks across the work groups and the governance desk it fills."""

from collections import Counter

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.register.models import Contribution, Task, TaskPartner
from apps.register.services.checks import check_task

from .conftest import PASSWORD


@pytest.fixture
def full(db, monkeypatch):
    monkeypatch.setenv("DEMO_USER_PASSWORD", PASSWORD)
    call_command("seed_demo", verbosity=0)


def as_user(username):
    c = APIClient()
    c.force_authenticate(get_user_model().objects.get(username=username))
    return c


def test_sample_covers_the_work_groups(full):
    groups = Counter(Task.objects.values_list("work_group__code", flat=True))
    assert Task.objects.count() == 55 and len(groups) == 13
    assert sum(1 for n in groups.values() if n >= 2) >= 9
    with_acts = Task.objects.filter(activities__isnull=False).distinct().count()
    assert with_acts >= 40 and Task.objects.filter(activities__isnull=False).count() >= 140


def test_every_decision_state_is_shown(full):
    reviews = set(TaskPartner.objects.values_list("review", flat=True)) | set(
        Contribution.objects.values_list("review", flat=True)
    )
    assert {"pending", "approved", "clarification", "timeline", "rejected"} <= reviews
    approvals = set(Task.objects.filter(owner_role__semantic="direct").values_list("approval", flat=True))
    assert {"pending", "approved", "clarification", "rejected"} <= approvals
    # a decision names the leader of the group that made it
    decided = TaskPartner.objects.exclude(review="pending").exclude(reviewed_by=None).select_related("work_group")
    assert decided and all(p.reviewed_by_id == p.work_group.leader_id for p in decided)


def test_ict_leader_has_requests_from_other_groups_to_decide(full):
    desk = as_user("shadi.alghanim").get("/api/tasks/governance/").json()
    waiting = [x for x in desk["links"] if x["can_review"] and x["review"] == "pending"]
    asking = {x["from_group"] for x in waiting}
    assert len(waiting) >= 5 and {"HR", "FIN", "CM", "ENG", "OTH"} <= asking
    # and ICT's own requests wait for other leaders, for example HR
    hr = as_user("rakan.alauni").get("/api/tasks/governance/").json()
    assert any(x["from_group"] == "ICT" and x["review"] == "pending" for x in hr["links"])


def test_ready_and_planned_tasks_pass_the_check(full):
    for t in Task.objects.filter(status__in=["ready", "in_master_plan"]):
        errors = [i.message for i in check_task(t) if i.level == "error"]
        assert not errors, (t.code, errors)


def test_links_to_the_first_part_are_now_agreed(full):
    p = TaskPartner.objects.get(task__code="ICT-T006", work_group__code="CM")
    assert p.their_task.code == "CM-T005" and p.review == "approved"
