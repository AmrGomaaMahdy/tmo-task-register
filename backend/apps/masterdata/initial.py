"""
The organisation's initial data (initial_data/initial_data.json), built from three source files:

* Directions_from_Leadership_Group-Wise_v4.pptx  → each group's mission, weight and leadership directions
* 13_Groups_Subobjectives.ods                    → the sub-objectives and the group each belongs to
* Task_Register_Group_Focal_Points.xlsx ("Final") → each group's members and who is Leader or Coordinator (Focal Point)

load() creates what is missing and, with update=True, also overwrites names and texts with the file's.
With users=True every person gets a sign-in account (user name like "amr.gomaa") linked to their member
rows, so their type sets their role: Team Leader, Team Focal Point or Team Member of that group.
A person in several groups (for example the leader of three) has one account with a role in each.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

from django.contrib.auth import get_user_model
from django.db import transaction

from apps.accounts.roles import sync_team_roles

from .models import Direction, GroupMember, LookupValue, WorkGroup

DATA_FILE = Path(__file__).resolve().parent / "initial_data" / "initial_data.json"


@dataclass
class Result:
    groups: int = 0
    directions: int = 0
    sub_objectives: int = 0
    members: int = 0
    users_created: list[str] = field(default_factory=list)
    users_linked: int = 0

    def lines(self) -> list[str]:
        return [
            f"Work groups added: {self.groups}",
            f"Directions added: {self.directions}",
            f"Sub-objectives added: {self.sub_objectives}",
            f"Group members added: {self.members}",
            f"User accounts created: {len(self.users_created)}; member rows linked: {self.users_linked}",
        ]


def username_for(name: str) -> str:
    """ "Amr Gomaa" -> "amr.gomaa"; accents dropped, other characters removed."""
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    parts = [re.sub(r"[^a-z0-9]", "", p) for p in ascii_name.lower().split()]
    return ".".join(p for p in parts if p)[:150]


def read() -> dict:
    return json.loads(DATA_FILE.read_text(encoding="utf-8"))


@transaction.atomic
def load(update: bool = False, users: bool = True, password: str | None = None) -> Result:
    """Load the initial data. Safe to run again: existing records are kept (or updated with update=True)."""
    data = read()
    out = Result()
    User = get_user_model()
    accounts: dict[str, object] = {}

    for g in data["groups"]:
        wg, created = WorkGroup.objects.get_or_create(
            code=g["code"], defaults={"name": g["name"], "mission": g["mission"], "weight": g["weight"]}
        )
        out.groups += created
        if not created:
            changed = []
            for attr in ("name", "mission", "weight"):
                if (update or getattr(wg, attr) in ("", None)) and getattr(wg, attr) != g[attr]:
                    setattr(wg, attr, g[attr])
                    changed.append(attr)
            if changed:
                wg.save(update_fields=changed)

        for d in g["directions"]:
            code = f"{wg.code}-D{d['no']:02d}"
            obj = Direction.objects.filter(code=code).first()
            if obj is None:
                Direction(code=code, work_group=wg, title=d["title"][:200], meaning=d["meaning"]).save()
                out.directions += 1
            elif update and (obj.title != d["title"][:200] or obj.meaning != d["meaning"]):
                obj.title, obj.meaning = d["title"][:200], d["meaning"]
                obj.save(update_fields=["title", "meaning"])

        for i, value in enumerate(g["subobjectives"], start=1):
            obj = LookupValue.objects.filter(list_key=LookupValue.ListKey.SUB_OBJECTIVE, value=value).first()
            if obj is None:
                LookupValue.objects.create(
                    list_key=LookupValue.ListKey.SUB_OBJECTIVE, value=value, work_group=wg, sort_order=i
                )
                out.sub_objectives += 1
            elif obj.work_group_id is None or (update and obj.work_group_id != wg.id):
                obj.work_group = wg
                obj.save(update_fields=["work_group"])

        for m in g["members"]:
            row, created = GroupMember.objects.get_or_create(
                work_group=wg, name=m["name"], defaults={"member_type": m["type"]}
            )
            out.members += created
            # A row never linked to an account got its type from the 1.16 migration's default, not from a
            # person, so the file's type applies to it too (as it does with --update).
            fresh = users and row.user_id is None
            if not created and (update or fresh) and row.member_type != m["type"]:
                row.member_type = m["type"]
                row.save(update_fields=["member_type"])
            if users:
                user = accounts.get(m["name"])
                if user is None:
                    username = username_for(m["name"])
                    first, _, last = m["name"].partition(" ")
                    user, made = User.objects.get_or_create(
                        username=username, defaults={"first_name": first[:150], "last_name": last[:150]}
                    )
                    if made:
                        if password:
                            user.set_password(password)
                        else:  # no initial password: sign-in is off until an Admin sets one, or via Entra ID
                            user.set_unusable_password()
                        user.save()
                        out.users_created.append(username)
                    accounts[m["name"]] = user
                if row.user_id is None:
                    row.user = user
                    row.save()  # the member type now sets the account's role (apps/masterdata/membership.py)
                    out.users_linked += 1
    sync_team_roles()
    return out
