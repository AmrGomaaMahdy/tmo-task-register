import json

import pytest
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.backup import services
from apps.masterdata.models import GroupMember, WorkGroup
from apps.register.models import Activity, Task

from .conftest import PASSWORD

User = get_user_model()


def _upload(doc: dict | bytes) -> SimpleUploadedFile:
    raw = doc if isinstance(doc, bytes) else json.dumps(doc).encode()
    return SimpleUploadedFile("backup.json", raw, content_type="application/json")


@pytest.mark.parametrize("username", ["tmo.officer", "ict.team", "committee.viewer"])
def test_only_administrators_reach_backup(client_for, username):
    c = client_for(username)
    assert c.get("/api/backup/export/").status_code == 403
    assert c.get("/api/backup/export-excel/").status_code == 403
    assert c.post("/api/backup/restore/", {"file": _upload(b"{}")}, format="multipart").status_code == 403


def test_backup_contains_everything_but_no_plain_passwords(client_for):
    response = client_for("admin").get("/api/backup/export/")
    assert response.status_code == 200
    assert response["Content-Disposition"].startswith('attachment; filename="task-register-backup-')
    doc = json.loads(response.content)
    assert doc["counts"]["register.task"] == 20
    # The trial users and one account per person of the focal points list.
    assert doc["counts"]["auth.user"] == User.objects.count() > 70
    assert doc["counts"]["auth.group"] == Group.objects.count()
    assert PASSWORD not in response.content.decode()
    users = [o for o in doc["data"] if o["model"] == "auth.user"]
    assert all(u["fields"]["password"].startswith("md5$") for u in users)  # hashes only


def test_excel_export_has_a_sheet_per_table(client_for):
    from io import BytesIO

    from openpyxl import load_workbook

    response = client_for("admin").get("/api/backup/export-excel/")
    assert response.status_code == 200
    wb = load_workbook(BytesIO(response.content))
    assert {"Task Register", "Partners", "Contributions", "Activities", "Users"} <= set(wb.sheetnames)
    assert wb["Task Register"].max_row == 21  # header + 20 tasks
    assert wb["Partners"].max_row == 20  # header + 19 partner rows
    assert wb["Contributions"].max_row == 8  # header + 7 contributions


def test_restore_round_trip(client_for):
    admin = client_for("admin")
    doc = json.loads(admin.get("/api/backup/export/").content)
    preds_before = Activity.objects.filter(predecessors__isnull=False).count()

    # Lose data after the backup
    Task.objects.all().delete()
    WorkGroup.objects.create(code="TMP", name="Created after the backup")

    preview = admin.post("/api/backup/restore/", {"file": _upload(doc)}, format="multipart")
    assert preview.status_code == 200 and preview.json()["restored"] is False
    assert Task.objects.count() == 0  # a check changes nothing

    refused = admin.post("/api/backup/restore/", {"file": _upload(doc), "dry_run": False}, format="multipart")
    assert refused.status_code == 400

    done = admin.post(
        "/api/backup/restore/", {"file": _upload(doc), "dry_run": False, "confirm": "RESTORE"}, format="multipart"
    )
    assert done.status_code == 200 and done.json()["restored"] is True
    assert Task.objects.count() == 20
    assert not WorkGroup.objects.filter(code="TMP").exists()
    assert not Group.objects.filter(name="TMP Team").exists()
    assert Group.objects.filter(name="ICT Team Focal Point").exists()
    assert list(User.objects.get(username="ict.team").groups.values_list("name", flat=True)) == ["ICT Team Focal Point"]
    assert Activity.objects.filter(predecessors__isnull=False).count() == preds_before
    # New records continue after the restored ones
    wg = WorkGroup.objects.create(code="NEW", name="After restore")
    assert wg.pk > max(o["pk"] for o in doc["data"] if o["model"] == "masterdata.workgroup")


def test_tampered_or_foreign_files_are_refused(client_for):
    admin = client_for("admin")
    doc = json.loads(admin.get("/api/backup/export/").content)
    doc["data"][0]["fields"]["name"] = "Edited"
    r = admin.post("/api/backup/restore/", {"file": _upload(doc)}, format="multipart")
    assert r.status_code == 400 and "checksum" in r.json()["detail"]
    r = admin.post("/api/backup/restore/", {"file": _upload(b"not json")}, format="multipart")
    assert r.status_code == 400


def test_backup_without_an_administrator_is_refused(seeded):
    doc = services.build_backup()
    doc["data"] = [o for o in doc["data"] if not (o["model"] == "auth.user" and o["fields"]["is_superuser"])]
    doc["sha256"] = services._checksum(doc["data"])
    with pytest.raises(services.BackupError, match="no active administrator"):
        services.inspect_backup(json.dumps(doc).encode())


def test_command_line_export_and_import(seeded, tmp_path):
    import io

    from django.core.management import call_command

    call_command("export_data", "-o", str(tmp_path), stdout=io.StringIO())
    [backup] = list(tmp_path.glob("task-register-backup-*.json"))
    Task.objects.all().delete()
    call_command("import_data", str(backup), stdout=io.StringIO())
    assert Task.objects.count() == 0  # check only
    call_command("import_data", str(backup), "--yes", stdout=io.StringIO())
    assert Task.objects.count() == 20


def _v2(doc: dict) -> dict:
    """The same data as a v1.5 / v1.6 backup: group members as a plain 'person' list."""
    data = []
    for item in doc["data"]:
        if item["model"] == "masterdata.groupmember":
            data.append(
                {
                    "model": "masterdata.lookupvalue",
                    "pk": 900 + item["pk"],
                    "fields": {
                        "list_key": "person",
                        "value": item["fields"]["name"],
                        "definition": "",
                        "sort_order": item["pk"],
                        "semantic": "",
                    },
                }
            )
        elif item["model"] == "register.activity":
            f = dict(item["fields"])
            f["owner"] = 900 + f["owner"] if f.get("owner") else None
            data.append({**item, "fields": f})
        else:
            data.append(item)
    return {**doc, "schema_version": 2, "app_version": "1.5.0", "data": data, "sha256": services._checksum(data)}


def test_backup_v4_holds_group_members(client_for):
    doc = json.loads(client_for("admin").get("/api/backup/export/").content)
    assert doc["schema_version"] == 9
    assert doc["counts"]["masterdata.groupmember"] == GroupMember.objects.count() == 75


def test_a_v2_backup_is_upgraded_on_restore(client_for):
    from apps.masterdata.models import GroupMember

    admin = client_for("admin")
    doc = _v2(json.loads(admin.get("/api/backup/export/").content))
    check = admin.post("/api/backup/restore/", {"file": _upload(doc)}, format="multipart").json()
    # A v1.5 person list holds each name once: one member per person (69 people in 75 member rows).
    people = GroupMember.objects.values("name").distinct().count()
    assert check["counts"]["masterdata.groupmember"] == people and check["notes"]
    assert check["current_counts"]["register.task"] == 20
    done = admin.post(
        "/api/backup/restore/", {"file": _upload(doc), "dry_run": "false", "confirm": "RESTORE"}, format="multipart"
    )
    assert done.status_code == 200
    essam = GroupMember.objects.get(name="Essam Essmat")
    assert essam.work_group.code == "ICT"  # the group of the tasks he owns activities on
    before = json.loads(admin.get("/api/backup/export/").content)  # after the restore: same owners as saved
    owned = [o for o in before["data"] if o["model"] == "register.activity" and o["fields"]["owner"] == essam.pk]
    assert Activity.objects.filter(owner=essam).count() == len(owned) > 0


def test_every_restore_keeps_a_restore_point_that_can_be_restored(client_for):
    admin = client_for("admin")
    doc = json.loads(admin.get("/api/backup/export/").content)
    Task.objects.filter(code="ICT-T001").delete()
    done = admin.post(
        "/api/backup/restore/", {"file": _upload(doc), "dry_run": "false", "confirm": "RESTORE"}, format="multipart"
    ).json()
    assert Task.objects.filter(code="ICT-T001").exists()
    points = admin.get("/api/backup/restore-points/").json()
    assert points[0]["id"] == done["restore_point"] and points[0]["counts"]["register.task"] == 19
    assert admin.get(f"/api/backup/restore-points/{points[0]['id']}/download/").status_code == 200
    refused = admin.post(f"/api/backup/restore-points/{points[0]['id']}/restore/", {"confirm": ""}, format="json")
    assert refused.status_code == 400
    back = admin.post(f"/api/backup/restore-points/{points[0]['id']}/restore/", {"confirm": "RESTORE"}, format="json")
    assert back.status_code == 200 and not Task.objects.filter(code="ICT-T001").exists()
    assert len(admin.get("/api/backup/restore-points/").json()) == 2
    assert client_for("tmo.officer").get("/api/backup/restore-points/").status_code == 403


def test_a_v3_backup_keeps_its_one_contribution_per_task(client_for):
    """v1.7 backups have no contribution number: each task's single contribution becomes number 1."""
    from apps.register.models import Contribution

    admin = client_for("admin")
    doc = json.loads(admin.get("/api/backup/export/").content)
    data, seen = [], set()
    for item in doc["data"]:
        if item["model"] == "register.contribution":
            if item["fields"]["task"] in seen:
                continue  # v1.7 kept one per task
            seen.add(item["fields"]["task"])
            item = {**item, "fields": {k: v for k, v in item["fields"].items() if k != "slot"}}
        data.append(item)
    v3 = {**doc, "schema_version": 3, "app_version": "1.7.0", "data": data, "sha256": services._checksum(data)}
    done = admin.post(
        "/api/backup/restore/", {"file": _upload(v3), "dry_run": "false", "confirm": "RESTORE"}, format="multipart"
    )
    assert done.status_code == 200, done.content
    assert Contribution.objects.count() == len(seen) == 6
    assert set(Contribution.objects.values_list("slot", flat=True)) == {1}
