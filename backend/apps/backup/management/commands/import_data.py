import sys
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from apps.backup import services


class Command(BaseCommand):
    help = "Replace ALL application data with a backup file. Without --yes it only checks the file."

    def add_arguments(self, parser):
        parser.add_argument("file", help="Backup file, or - to read from standard input")
        parser.add_argument("--yes", action="store_true", help="Really replace the current data")

    def handle(self, *args, **options):
        try:
            raw = sys.stdin.buffer.read() if options["file"] == "-" else Path(options["file"]).read_bytes()
            inspection = services.inspect_backup(raw)
        except (OSError, services.BackupError) as exc:
            raise CommandError(str(exc)) from exc
        info = inspection.summary
        self.stdout.write(f"Backup of {info['created_at']} by {info['created_by']} (version {info['app_version']})")
        for label, count in info["counts"].items():
            self.stdout.write(f"  {label:<24} {count}")
        if not options["yes"]:
            self.stdout.write(self.style.WARNING("Checked only. Run again with --yes to replace all current data."))
            return
        for note in info["notes"]:
            self.stdout.write(note)
        point = services.create_restore_point(
            f"Before restoring the backup of {services.describe_time(info['created_at'])} (command line)"
        )
        services.restore_backup(inspection)
        self.stdout.write(
            self.style.SUCCESS(f"Restore complete. The previous data is kept as restore point {point.id}.")
        )
