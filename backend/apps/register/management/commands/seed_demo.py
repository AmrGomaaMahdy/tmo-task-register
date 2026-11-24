"""
Load the demo: the organisation's initial data (13 work groups, their directions, sub-objectives and
members with their sign-in accounts; see apps/masterdata/initial.py), the other dropdown lists, sample
tasks with their partners, contributions and activities, and trial users for the fixed roles.

The sample comes in two parts:
* fixtures/demo_data.json: 20 tasks from the prototype (mostly ICT); their sub-objectives and activity
  owners are matched to the real ones of each group;
* fixtures/demo_more.json: 35 tasks across the work groups, so the governance desk has something to show:
  other groups asking ICT (and ICT asking them), each link waiting for or carrying a leader's decision
  (approved, or rejected with its reason), and tasks at each approval state.

    python manage.py seed_demo            # only if the database is empty
    python manage.py seed_demo --reset    # wipe the register and load again

Trial users and the accounts of the group members get the password from DEMO_USER_PASSWORD.
For testing only.
"""

import json
import os
import re
import secrets
from datetime import UTC, date, datetime
from pathlib import Path

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.accounts.roles import ADMIN, TMO, VIEWER, member_role_name, sync_team_roles, team_role_name
from apps.masterdata import initial
from apps.masterdata.models import Direction, GroupMember, LookupValue, WorkGroup
from apps.register.models import MAX_ROWS, Activity, Contribution, Task, TaskPartner
from apps.register.serializers import contribution_agreed, partner_agreed

DATA_FILE = Path(__file__).resolve().parents[2] / "fixtures" / "demo_data.json"
MORE_FILE = Path(__file__).resolve().parents[2] / "fixtures" / "demo_more.json"
LIST_KEYS = {
    "workstreams": "workstream",
    "subs": "sub_objective",
    "ownerRoles": "owner_role",
    "partnerRoles": "partner_role",
    "needed": "needed",
}
SEMANTICS = {
    ("owner_role", "Direct"): "direct",
    ("owner_role", "Enable"): "enable",
    ("owner_role", "Support"): "support",
    ("needed", "Before start"): "before_start",
}
STATUS = {
    "draft": "draft",
    "need": "needs_completion",
    "ready": "ready",
    "plan": "in_master_plan",
    "exec": "in_master_plan",
    "done": "in_master_plan",
}
DEMO_USERS = [
    # username, first name, last name, role, work group
    ("admin", "System", "Administrator", ADMIN, None),
    ("tmo.officer", "TMO", "Officer", TMO, None),
    ("ict.team", "ICT", "Focal Point (trial)", team_role_name("ICT"), "ICT"),
    ("hr.team", "HR", "Focal Point (trial)", team_role_name("HR"), "HR"),
    ("fin.team", "Finance", "Focal Point (trial)", team_role_name("FIN"), "FIN"),
    ("hr.member", "HR", "Member (trial)", member_role_name("HR"), "HR"),
    ("committee.viewer", "Committee", "Viewer", VIEWER, None),
]
# The group leaders are real people from the initial data (for example shadi.alghanim for ICT).
# Sample answers from leaders on links, so the governance desk shows each kind of decision.
DEMO_REVIEWS = {
    ("ICT-T041", "FIN"): ("approved", "We can deliver the budget codes two weeks later.", None),
}


def modern(decision):
    """
    Since 1.20 a leader approves or rejects (with a reason when needed). The sample file still holds a few
    older answers: a question becomes "waiting" (the leader has not decided yet), a new date becomes an
    approval that keeps its note.
    """
    if not decision:
        return decision
    kind, note, *rest = decision
    if kind == "clarification":
        return ("pending", "", None)
    if kind == "timeline":
        return ("approved", note, None)
    return (kind, note, *rest)


def d(value):
    return date.fromisoformat(value) if value else None


class Command(BaseCommand):
    help = "Load the initial data, sample tasks across the work groups and trial users."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Delete the register and master data first.")
        parser.add_argument(
            "--core-only", action="store_true", help="Load only the first part of the sample (the 20 prototype tasks)."
        )

    @transaction.atomic
    def handle(self, *args, **options):
        call_command("setup_roles", stdout=self.stdout)
        password = os.environ.get("DEMO_USER_PASSWORD")
        generated = False
        if not password:
            password, generated = secrets.token_urlsafe(12), True
        if options["reset"]:
            for model in (Activity, Contribution, TaskPartner, Task, Direction, GroupMember, LookupValue):
                model.objects.all().delete()
            WorkGroup.objects.all().delete()
        if Task.objects.exists():
            self.stdout.write("Demo data already present; use --reset to reload it.")
            # Still add any initial data that is missing (for example after an upgrade).
            for line in initial.load(users=True, password=password).lines():
                self.stdout.write(line)
        else:
            self._load(json.loads(DATA_FILE.read_text(encoding="utf-8")), password, more=not options["core_only"])
        self._users(password)
        # The TMO's reason on a task it sent back is signed by the trial TMO Officer (created just above).
        Task.objects.exclude(tmo_note="").filter(tmo_by=None).update(
            tmo_by=get_user_model().objects.filter(username="tmo.officer").first()
        )
        if generated:
            self.stdout.write(self.style.WARNING(f"DEMO_USER_PASSWORD was not set. New users got: {password}"))

    # ------------------------------------------------------------------
    def _load(self, payload, password, more=True):
        md, data = payload["md"], payload["data"]
        # The real organisation first: groups, directions, sub-objectives, members and their accounts.
        for line in initial.load(users=True, password=password).lines():
            self.stdout.write(line)
        groups = {w.code: w for w in WorkGroup.objects.all()}
        directions = {d.code: d for d in Direction.objects.all()}

        lookups: dict[tuple[str, str], LookupValue] = {}
        for md_key, list_key in LIST_KEYS.items():
            if list_key == "sub_objective":
                continue  # sub-objectives come from the initial data, by group
            defs = md["def"].get(md_key, {})
            for i, value in enumerate(md[md_key]):
                lookups[(list_key, value)] = LookupValue.objects.get_or_create(
                    list_key=list_key,
                    value=value,
                    defaults={
                        "definition": defs.get(value, ""),
                        "sort_order": i + 1,
                        "semantic": SEMANTICS.get((list_key, value), ""),
                    },
                )[0]

        def norm(text: str) -> str:
            return re.sub(r"[^a-z0-9]", "", text.lower())

        subs = {norm(v.value): v for v in LookupValue.objects.filter(list_key="sub_objective")}

        def sub_for(value: str | None, wg: WorkGroup):
            # Prototype values look like "WB-081 – WB-13-AI Invention Points…"; keep only a match of the same group.
            if not value:
                return None
            match = subs.get(norm(value.split(" – ", 1)[-1]))
            return match if match and match.work_group_id == wg.id else None

        # Prototype activity owners are matched, in order, to the real members of the same group.
        real = {code: list(GroupMember.objects.filter(work_group=wg).order_by("id")) for code, wg in groups.items()}
        demo_by_group: dict[str, list[str]] = {}
        for m in md["members"]:
            demo_by_group.setdefault(m.get("wg"), []).append(m["name"])
        members = {}
        for code, names in demo_by_group.items():
            for i, name in enumerate(names):
                if real.get(code):
                    members[name] = real[code][i % len(real[code])]

        def lk(list_key, value):
            return lookups.get((list_key, value)) if value else None

        tasks = {}
        for t in data["tasks"]:
            task = Task(
                code=t["id"],
                work_group=groups[t["wg"]],
                title=t["task"],
                direction=directions.get(t.get("dir")),
                workstream=lk("workstream", t.get("ws")),
                sub_objective=sub_for(t.get("sub"), groups[t["wg"]]),
                owner_role=lk("owner_role", t.get("role")),
                planned_start=d(t.get("start")),
                planned_finish=d(t.get("finish")),
                status=STATUS[t["stage"]],
            )
            task.save()
            tasks[task.code] = task

        needs = {(row["task"], row["from"]): row for row in data["deps"]}
        for t in data["tasks"]:
            for i in range(1, MAX_ROWS + 1):
                if not t.get(f"p{i}"):
                    continue
                row = needs.get((t["id"], t[f"p{i}"]), {})
                TaskPartner.objects.create(
                    task=tasks[t["id"]],
                    slot=i,
                    work_group=groups[t[f"p{i}"]],
                    role=lk("partner_role", t.get(f"r{i}")),
                    need=row.get("need", ""),
                    needed_when=lk("needed", row.get("when")),
                    their_task_ref=row.get("their", ""),
                )
        con_slots: dict[str, int] = {}
        for row in data["cons"]:
            con_slots[row["task"]] = con_slots.get(row["task"], 0) + 1
            Contribution.objects.create(
                task=tasks[row["task"]],
                slot=con_slots[row["task"]],
                to_group=groups[row["group"]],
                benefit=row["what"],
                needed_when=lk("needed", row.get("when")),
                their_task_ref=row["their"],
            )
        # their task numbers that are in this register become links to the task
        for p in TaskPartner.objects.exclude(their_task_ref=""):
            p.their_task = tasks.get(p.their_task_ref)
            p.save(update_fields=["their_task"])
        for c in Contribution.objects.exclude(their_task_ref=""):
            c.their_task = tasks.get(c.their_task_ref)
            c.save(update_fields=["their_task"])

        activities, preds, counters = {}, [], {}
        for a in data["acts"]:
            counters[a["task"]] = counters.get(a["task"], 0) + 1
            act = Activity.objects.create(
                task=tasks[a["task"]],
                order=counters[a["task"]],
                name=a["name"],
                owner=members.get(a.get("owner") or ""),
                start_date=d(a["start"]),
                finish_date=d(a["finish"]),
            )
            activities[act.code] = act
            preds.append((act, [p for p in (a.get("p1"), a.get("p2")) if p]))
        for act, codes in preds:
            act.predecessors.set([activities[c] for c in codes])
        self._governance(tasks)
        more_acts = self._load_more(json.loads(MORE_FILE.read_text(encoding="utf-8")), tasks, lk)[1] if more else 0

        self.stdout.write(
            self.style.SUCCESS(f"Loaded {len(tasks)} sample tasks and {len(activities) + more_acts} activities.")
        )

    def _load_more(self, payload, tasks, lk):
        """
        The second part of the sample: tasks of most work groups, their links with each other and with ICT,
        and the leaders' decisions on them. A decision is made by the leader of the group that decides: the
        task's own group for a Direct task, the other group for a partner row or a contribution.
        """
        groups = {w.code: w for w in WorkGroup.objects.select_related("leader")}
        directions = {d.code: d for d in Direction.objects.all()}
        subs = {v.value: v for v in LookupValue.objects.filter(list_key="sub_objective")}
        members = {(m.work_group.code, m.name): m for m in GroupMember.objects.select_related("work_group")}
        decided_at = datetime(2026, 11, 16, 10, 0, tzinfo=UTC)
        new = []
        ready_others = 0
        for t in payload["tasks"]:
            wg = groups[t["wg"]]
            task = Task(
                code=t["code"],
                work_group=wg,
                title=t["title"],
                description=t.get("description", ""),
                direction=directions.get(t["dir"]),
                workstream=lk("workstream", t.get("ws")),
                sub_objective=subs.get(t.get("sub") or ""),
                owner_role=lk("owner_role", t.get("role")),
                planned_start=d(t["start"]),
                planned_finish=d(t["finish"]),
                status=t["status"],
            )
            if t.get("approval"):
                task.approval, task.approval_note = t["approval"]
                if task.approval == "clarification":  # since 1.20: approve or reject, with the reason
                    task.approval = "rejected"
            # 1.19 readiness flow: a Ready task the leader approved is Leader Approved (the TMO decides next);
            # one the leader rejected or questioned is back with the Focal Point; a task in the Master Plan
            # was approved. Ready tasks with no decision wait for the leader; of the Enable and Support ones,
            # every other one has been approved already, so the TMO has decisions to make too.
            if task.status == "ready" and task.approval == "pending" and t["role"] != "Direct":
                ready_others += 1
                if ready_others % 2 == 0:
                    task.approval = "approved"
            if task.status == "in_master_plan":
                task.approval = "approved"
            if task.status == "ready" and task.approval == "approved":
                task.status = "leader_approved"
            if task.approval in ("rejected", "clarification"):
                task.status = "needs_completion"
            if task.approval != "pending":
                task.approval_by, task.approval_at = wg.leader, decided_at
            task.save()
            tasks[task.code] = task
            new.append((task, t))

        def review(row, decision, deciding_group):
            decision = modern(decision)
            if not decision:
                return
            row.review, row.review_note, row.review_date = decision[0], decision[1], d(decision[2])
            if row.review != "pending":
                row.reviewed_by, row.reviewed_at = groups[deciding_group].leader, decided_at
            row.save(update_fields=["review", "review_note", "review_date", "reviewed_by", "reviewed_at"])

        n_acts = 0
        for task, t in new:
            for slot, p in enumerate(t["partners"], start=1):
                row = TaskPartner.objects.create(
                    task=task,
                    slot=slot,
                    work_group=groups[p["group"]],
                    role=lk("partner_role", p["role"]),
                    need=p["need"],
                    needed_when=lk("needed", p["when"]),
                    their_task_ref=p["their"],
                    their_task=tasks.get(p["their"]),
                )
                review(row, p.get("review"), p["group"])
            for slot, c in enumerate(t["contributions"], start=1):
                row = Contribution.objects.create(
                    task=task,
                    slot=slot,
                    to_group=groups[c["to"]],
                    benefit=c["what"],
                    needed_when=lk("needed", c["when"]),
                    their_task_ref=c["their"],
                    their_task=tasks.get(c["their"]),
                )
                review(row, c.get("review"), c["to"])
            made = []
            for i, a in enumerate(t["acts"], start=1):
                act = Activity.objects.create(
                    task=task,
                    order=i,
                    name=a["name"],
                    owner=members.get((t["wg"], a["owner"])),
                    start_date=d(a["start"]),
                    finish_date=d(a["finish"]),
                )
                act.predecessors.set([made[j - 1] for j in a["after"]])
                made.append(act)
            n_acts += len(made)
        new_codes = {task.code for task, _ in new}
        # A first-part partner row with no task number yet takes the number of the new task that answers it.
        for task, t in new:
            for c in t["contributions"]:
                if c["their"] in tasks and c["their"] not in new_codes:
                    TaskPartner.objects.filter(
                        task=tasks[c["their"]], work_group=task.work_group, their_task_ref=""
                    ).update(their_task_ref=task.code, their_task=task)
        # Links of the first part that point to tasks of this part now find them.
        for row in [
            *TaskPartner.objects.filter(their_task=None).exclude(their_task_ref=""),
            *Contribution.objects.filter(their_task=None).exclude(their_task_ref=""),
        ]:
            if row.their_task_ref in tasks:
                row.their_task = tasks[row.their_task_ref]
                row.save(update_fields=["their_task"])
        # Those links are agreed now: their leaders approve them, except two ICT requests left waiting.
        waiting = {("ICT-T041", "SS"), ("ICT-T030", "ENG")}
        first_part = TaskPartner.objects.filter(review="pending").exclude(task__code__in=new_codes)
        for p in first_part.select_related("task", "work_group"):
            if partner_agreed(p) and (p.task.code, p.work_group.code) not in waiting:
                p.review, p.reviewed_by, p.reviewed_at = "approved", groups[p.work_group.code].leader, decided_at
                p.save(update_fields=["review", "reviewed_by", "reviewed_at"])
        return len(new), n_acts

    def _governance(self, tasks):
        """
        Leader decisions in the sample data: tasks in the Master Plan and Direct tasks that reached Ready were
        approved by their leader (the Ready ones are now Leader Approved, for the TMO); the other Ready tasks
        wait for their leader. Links both groups recorded (agreed) are approved, and two links carry a
        question or a new date. ICT-T031 was sent back by the TMO, with its reason.
        """
        approved_at = datetime(2026, 11, 10, 9, 0, tzinfo=UTC)
        leaders = {w.id: w.leader for w in WorkGroup.objects.select_related("leader")}
        for t in tasks.values():
            direct = t.owner_role_id and t.owner_role.semantic == "direct"
            if t.status == "in_master_plan" or (t.status == "ready" and direct):
                t.approval, t.approval_at, t.approval_by = "approved", approved_at, leaders.get(t.work_group_id)
                if t.status == "ready":
                    t.status = "leader_approved"
                t.save(update_fields=["approval", "approval_at", "approval_by", "status"])
        sent_back = tasks.get("ICT-T031")
        if sent_back is not None and sent_back.status in ("ready", "leader_approved"):
            sent_back.status, sent_back.approval = "needs_completion", "pending"
            sent_back.tmo_note = "Add the HR partner's task number and split the rollout by site before we include it."
            sent_back.tmo_at = datetime(2026, 11, 17, 11, 0, tzinfo=UTC)
            sent_back.save(update_fields=["status", "approval", "tmo_note", "tmo_by", "tmo_at"])
        for p in TaskPartner.objects.select_related("task", "work_group"):
            review = DEMO_REVIEWS.get((p.task.code, p.work_group.code))
            if review:
                p.review, p.review_note, p.review_date = review[0], review[1], d(review[2])
            elif partner_agreed(p):
                p.review = "approved"
            else:
                continue
            p.reviewed_at = approved_at
            p.save(update_fields=["review", "review_note", "review_date", "reviewed_at"])
        for c in Contribution.objects.select_related("task", "to_group"):
            if c.to_group_id and contribution_agreed(c):
                c.review, c.reviewed_at = "approved", approved_at
                c.save(update_fields=["review", "reviewed_at"])

    def _users(self, password):
        User = get_user_model()
        sync_team_roles()
        for username, first, last, role, _wg in DEMO_USERS:
            user, created = User.objects.get_or_create(
                username=username, defaults={"first_name": first, "last_name": last, "email": f"{username}@example.com"}
            )
            if created:
                user.set_password(password)
                user.is_staff = role == ADMIN
                user.is_superuser = role == ADMIN
                user.save()
            if not created and (user.first_name, user.last_name) != (first, last):
                # A trial account keeps the name of its role, which changes with the role ("Focal Point").
                user.first_name, user.last_name = first, last
                user.save(update_fields=["first_name", "last_name"])
            user.groups.set([Group.objects.get(name=role)])
            self.stdout.write(f"{'Created' if created else 'Exists '} user {username:<17} {role}")
