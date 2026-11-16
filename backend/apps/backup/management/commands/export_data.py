import json
from pathlib import Path

from django.core.management.base import BaseCommand

from apps.backup import services


class Command(BaseCommand):
    help = "Write a full backup of the application data to a JSON file (same format as the web download)."

    def add_arguments(self, parser):
        parser.add_argument("--output", "-o", help="File or folder to write to, or - for standard output (default: .)")

    def handle(self, *args, **options):
        if options["output"] == "-":
            # For scheduled backups from the host: docker compose exec -T backend ... -o - > file.json
            self.stdout.write(json.dumps(services.build_backup(), ensure_ascii=False), ending="")
            return
        target = Path(options["output"] or ".")
        if target.is_dir():
            target = target / services.backup_filename()
        doc = services.build_backup()
        target.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
        self.stdout.write(self.style.SUCCESS(f"Backup written to {target} ({sum(doc['counts'].values())} records)"))
