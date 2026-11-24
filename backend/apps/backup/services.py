"""
Full backup and restore of the application data.

A backup is one JSON document:

    {
      "format": "task-register-backup",
      "schema_version": 5,
      "app_version": "1.11.0",
      "created_at": "...", "created_by": "admin",
      "counts": {"register.task": 20, ...},
      "sha256": "<checksum of the data array>",
      "data": [ Django-serialised objects, in load order ]
    }

It holds every user (with password hashes, never plain passwords), the roles, the
configuration, all registers and links, and the audit log. Primary keys are kept, so
references between records survive a restore. Sessions are not included.

Format versions: 5 = v1.11 (work group leaders, approvals of Direct tasks, reviews of links; older
backups restore with no leader and every decision pending); 4 = v1.8 to v1.10 (several contributions per task); 3 = v1.7
(group members belong to a work group), read as is since its one contribution per task becomes
contribution 1; 2 = v1.5 and v1.6, which this version still reads by turning the plain list of
member names into group members; 1 = v1.0 to v1.4.
Every restore first keeps a restore point of the current data (see RestorePoint).
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from dataclasses import dataclass, field

from django.apps import apps
from django.conf import settings
from django.contrib.auth.models import Group
from django.core import serializers
from django.core.management.color import no_style
from django.db import connection, transaction
from django.utils import timezone

from apps.accounts.role_names import upgrade_role_names
from apps.accounts.roles import sync_team_roles
from apps.masterdata import leaders
from apps.masterdata.models import WorkGroup

FORMAT = "task-register-backup"
# 9 = v1.19 (Leader Approved status, the TMO's decision; "Team Focal Point" roles);
# 8 = v1.16 (role names, member types, sub-objectives by group, missions);
# 7 = v1.15 (group leader roles); 6 = v1.14 (descriptions, contacts, audit details);
# 5 = v1.11 (leaders, approvals, reviews); 4 = v1.8 to v1.10; 3 = v1.7; 2 = v1.5 and v1.6; 1 = v1.0 to v1.4
SCHEMA_VERSION = 9
READABLE_VERSIONS = {2, 3, 4, 5, 6, 7, 8, 9}
MAX_BACKUP_BYTES = 50 * 1024 * 1024

# (model label, fields to keep or None for all). Order = load order; deletion runs in reverse.
MODELS: list[tuple[str, tuple[str, ...] | None]] = [
    ("auth.group", ("name",)),  # roles; Django permissions are not used, so they are left out
    (
        "auth.user",
        (
            "password",
            "last_login",
            "is_superuser",
            "username",
            "first_name",
            "last_name",
            "email",
            "is_staff",
            "is_active",
            "date_joined",
            "groups",
        ),
    ),
    ("masterdata.workgroup", None),
    ("masterdata.groupmember", None),
    ("masterdata.direction", None),
    ("masterdata.lookupvalue", None),
    ("register.task", None),
    ("register.activity", None),
    ("register.taskpartner", None),
    ("register.contribution", None),
    ("core.auditlog", None),
]
ALLOWED = {label for label, _ in MODELS}


class BackupError(ValueError):
    """The file is not a usable backup. The message is safe to show to the user."""


def _model(label: str):
    return apps.get_model(label)


def _checksum(data: list) -> str:
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def build_backup(user=None) -> dict:
    data: list = []
    counts: dict[str, int] = {}
    for label, fields in MODELS:
        qs = _model(label).objects.all().order_by("pk")
        items = json.loads(serializers.serialize("json", qs, fields=fields))
        data.extend(items)
        counts[label] = len(items)
    return {
        "format": FORMAT,
        "schema_version": SCHEMA_VERSION,
        "app_version": settings.APP_VERSION,
        "created_at": timezone.now().isoformat(),
        "created_by": getattr(user, "username", None) or "command line",
        "counts": counts,
        "sha256": _checksum(data),
        "data": data,
    }


def describe_time(iso: str | None) -> str:
    """'2026-11-14T16:32:41+00:00' -> '2026-11-14 19:32' in the server's time zone."""
    from datetime import datetime

    try:
        return f"{timezone.localtime(datetime.fromisoformat(iso or '')):%Y-%m-%d %H:%M}"
    except (TypeError, ValueError):
        return iso or "unknown date"


def backup_filename(prefix: str = "task-register-backup", ext: str = "json") -> str:
    return f"{prefix}-{timezone.localtime():%Y%m%d-%H%M}.{ext}"


@dataclass
class Inspection:
    document: dict
    counts: dict[str, int]
    notes: list[str] = field(default_factory=list)

    @property
    def summary(self) -> dict:
        doc = self.document
        return {
            "app_version": doc.get("app_version"),
            "schema_version": doc.get("schema_version"),
            "created_at": doc.get("created_at"),
            "created_by": doc.get("created_by"),
            "counts": self.counts,
            "current_counts": current_counts(),
            "notes": self.notes,
        }


def current_counts() -> dict[str, int]:
    return {label: _model(label).objects.count() for label, _ in MODELS}


def upgrade_to_v9(data: list) -> list:
    """
    Backups before 1.19: every task now goes to its leader once Ready, then to the TMO (the same rules as
    migration register 0012). Role names are renamed after loading (upgrade_role_names).
    """
    for item in data:
        if not isinstance(item, dict) or item.get("model") != "register.task":
            continue
        f = item.get("fields", {})
        if f.get("status") == "ready" and f.get("approval") == "approved":
            f["status"] = "leader_approved"
        elif f.get("status") == "ready" and f.get("approval") in ("rejected", "clarification"):
            f["status"] = "needs_completion"
        elif f.get("status") == "in_master_plan":
            f["approval"] = "approved"
    return data


def upgrade_v2(data: list) -> list:
    """
    v1.5 and v1.6 kept group members as values of a 'person' list. Each one becomes a group member
    of the work group whose tasks they own most activities on (else the first work group); the
    activities keep pointing to the same id, which the new member takes over.
    """
    tasks = {i["pk"]: i["fields"].get("work_group") for i in data if i.get("model") == "register.task"}
    owned: dict[int, Counter] = {}
    for i in data:
        if i.get("model") == "register.activity" and i["fields"].get("owner") is not None:
            owned.setdefault(i["fields"]["owner"], Counter())[tasks.get(i["fields"].get("task"))] += 1
    groups = sorted(
        (i for i in data if i.get("model") == "masterdata.workgroup"), key=lambda g: g["fields"].get("code", "")
    )
    first = groups[0]["pk"] if groups else None
    out, members, seen, same = [], [], {}, {}
    for i in data:
        if i.get("model") == "masterdata.lookupvalue" and i["fields"].get("list_key") == "person":
            counter = owned.get(i["pk"])
            group = counter.most_common(1)[0][0] if counter else first
            key = (i["fields"]["value"], group)
            if key in seen:  # one member per name and group: a repeat points to the first one
                same[i["pk"]] = seen[key]
                continue
            seen[key] = i["pk"]
            if group is not None:
                members.append(
                    {
                        "model": "masterdata.groupmember",
                        "pk": i["pk"],
                        "fields": {"name": i["fields"]["value"], "work_group": group, "is_active": True},
                    }
                )
            continue
        out.append(i)
    known = {m["pk"] for m in members}
    for i in out:
        if i.get("model") == "register.activity":
            owner = same.get(i["fields"].get("owner"), i["fields"].get("owner"))
            i["fields"]["owner"] = owner if owner in known else None
    at = next((n for n, i in enumerate(out) if i.get("model") == "masterdata.workgroup"), -1)
    while at + 1 < len(out) and out[at + 1].get("model") == "masterdata.workgroup":
        at += 1
    return out[: at + 1] + members + out[at + 1 :]


def create_restore_point(reason: str, user=None):
    """Keep the current data as a restore point (the last five are kept)."""
    from .models import KEEP, RestorePoint

    doc = build_backup(user)
    point = RestorePoint.objects.create(
        created_by=getattr(user, "username", "") or "",
        reason=reason[:300],
        counts=doc["counts"],
        document=json.dumps(doc, ensure_ascii=False),
    )
    for old in RestorePoint.objects.all()[KEEP:]:
        old.delete()
    return point


def inspect_backup(raw: bytes) -> Inspection:
    """Parse and validate a backup file without changing anything."""
    if len(raw) > MAX_BACKUP_BYTES:
        raise BackupError("The file is larger than 50 MB.")
    try:
        doc = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BackupError("The file is not a Task Register backup (it is not valid JSON).") from exc
    if not isinstance(doc, dict) or doc.get("format") != FORMAT:
        raise BackupError("The file is not a Task Register backup.")
    version = doc.get("schema_version")
    if version not in READABLE_VERSIONS:
        raise BackupError(
            f"This backup uses format version {version}, which this version cannot read."
            + (" Restore it on v1.4, upgrade, then take a new backup." if version == 1 else "")
        )
    data = doc.get("data")
    if not isinstance(data, list):
        raise BackupError("The backup has no data section.")
    if doc.get("sha256") != _checksum(data):
        raise BackupError("The backup is damaged or was edited: its checksum does not match.")
    notes: list[str] = []
    if version == 2:
        data = upgrade_v2(data)
        doc = {**doc, "data": data}
        notes.append(
            "This backup comes from v1.5 or v1.6: each group member is given the work group whose activities they own."
        )
    if version < 9:
        data = upgrade_to_v9(data)
        doc = {**doc, "data": data}
        notes.append(
            "This backup comes from a version before 1.19: Ready tasks the leader approved become Leader Approved, "
            "and the coordinator roles are renamed Focal Point."
        )
    counts: dict[str, int] = {label: 0 for label, _ in MODELS}
    for item in data:
        label = item.get("model") if isinstance(item, dict) else None
        if label not in ALLOWED:
            raise BackupError(f"The backup contains data this application does not accept ({label!r}).")
        counts[label] += 1
    if not any(
        item["model"] == "auth.user" and item.get("fields", {}).get("is_superuser") and item["fields"].get("is_active")
        for item in data
    ):
        raise BackupError("The backup has no active administrator, so nobody could sign in after restoring it.")
    return Inspection(doc, counts, notes)


def _reset_sequences() -> None:
    models = [_model(label) for label, _ in MODELS]
    models.append(_model("register.activity").predecessors.through)
    models.append(_model("auth.user").groups.through)
    statements = connection.ops.sequence_reset_sql(no_style(), models)
    with connection.cursor() as cursor:
        for sql in statements:
            cursor.execute(sql)


@transaction.atomic
def restore_backup(inspection: Inspection) -> dict[str, int]:
    """Replace ALL application data with the backup. All or nothing."""
    for label, _ in reversed(MODELS):
        _model(label).objects.all().delete()
    Group.objects.all().delete()  # team roles removed with their work groups are recreated from the backup

    payload = json.dumps(inspection.document["data"])
    # Load exactly what was saved, then give every work group its roles and put each group's leader
    # field and "<CODE> Group Leader" role in step (backups before 1.15 have the field only).
    with leaders.paused(), connection.constraint_checks_disabled():
        for obj in serializers.deserialize("json", payload):
            obj.save()
    connection.check_constraints()
    _reset_sequences()
    # Older backups carry older role names ("HR Team", "Administrator"…): rename them, keeping every user's roles.
    upgrade_role_names(Group, WorkGroup)
    sync_team_roles()
    leaders.sync_all()
    return inspection.counts
