"""
Load the demo data: work groups, directions, every dropdown list, 20 sample
tasks with their partners, contributions and activities, and trial users
for each role. The data matches the prototype v1.9 sample data, including the members of each
work group who own the activities.

    python manage.py seed_demo            # only if the database is empty
    python manage.py seed_demo --reset    # wipe the register and load again

Trial users get the password from DEMO_USER_PASSWORD. For testing only.
"""

import json
import os
import secrets
from datetime import date
from pathlib import Path

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.accounts.roles import ADMIN, TMO, VIEWER, sync_team_roles, team_role_name
from apps.masterdata.models import Direction, GroupMember, LookupValue, WorkGroup
from apps.register.models import MAX_ROWS, Activity, Contribution, Task, TaskPartner

DATA_FILE = Path(__file__).resolve().parents[2] / "fixtures" / "demo_data.json"
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
    ("ict.team", "ICT", "Team member", team_role_name("ICT"), "ICT"),
    ("hr.team", "HR", "Team member", team_role_name("HR"), "HR"),
    ("fin.team", "Finance", "Team member", team_role_name("FIN"), "FIN"),
    ("committee.viewer", "Committee", "Viewer", VIEWER, None),
]


def d(value):
    return date.fromisoformat(value) if value else None


class Command(BaseCommand):
    help = "Load demo master data, 20 sample tasks and trial users."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Delete the register and master data first.")

    @transaction.atomic
    def handle(self, *args, **options):
        call_command("setup_roles", stdout=self.stdout)
        if options["reset"]:
            for model in (Activity, Contribution, TaskPartner, Task, Direction, GroupMember, LookupValue):
                model.objects.all().delete()
            WorkGroup.objects.all().delete()
        if WorkGroup.objects.exists():
            self.stdout.write("Demo data already present; use --reset to reload it.")
        else:
            self._load(json.loads(DATA_FILE.read_text(encoding="utf-8")))
        self._users()

    # ------------------------------------------------------------------
    def _load(self, payload):
        md, dirs, data = payload["md"], payload["dirs"], payload["data"]
        groups = {w["code"]: WorkGroup.objects.create(code=w["code"], name=w["name"]) for w in md["workgroups"]}

        lookups: dict[tuple[str, str], LookupValue] = {}
        for md_key, list_key in LIST_KEYS.items():
            defs = md["def"].get(md_key, {})
            for i, value in enumerate(md[md_key]):
                lookups[(list_key, value)] = LookupValue.objects.create(
                    list_key=list_key,
                    value=value,
                    definition=defs.get(value, ""),
                    sort_order=i + 1,
                    semantic=SEMANTICS.get((list_key, value), ""),
                )

        members = {
            m["name"]: GroupMember.objects.create(name=m["name"], work_group=groups[m["wg"]])
            for m in md["members"]
            if m.get("wg") in groups
        }

        directions = {}
        for row in dirs:
            obj = Direction(code=row["id"], work_group=groups[row["wg"]], title=row["t"], meaning=row["m"])
            obj.save()
            directions[row["id"]] = obj

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
                sub_objective=lk("sub_objective", t.get("sub")),
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

        self.stdout.write(
            self.style.SUCCESS(
                f"Loaded {len(groups)} work groups, {len(members)} group members, {len(directions)} directions, "
                f"{len(tasks)} tasks, "
                f"{len(activities)} activities."
            )
        )

    def _users(self):
        User = get_user_model()
        password = os.environ.get("DEMO_USER_PASSWORD")
        generated = False
        if not password:
            password, generated = secrets.token_urlsafe(12), True
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
            user.groups.set([Group.objects.get(name=role)])
            self.stdout.write(f"{'Created' if created else 'Exists '} user {username:<17} {role}")
        if generated:
            self.stdout.write(self.style.WARNING(f"DEMO_USER_PASSWORD was not set. New users got: {password}"))
