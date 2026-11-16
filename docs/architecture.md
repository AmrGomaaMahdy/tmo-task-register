# Architecture and code layout

```
backend/                      Django project (config/) and four apps
  config/settings.py          All settings from environment variables (django-environ)
  apps/core/                  Audit log, pagination, error handling, health check
  apps/accounts/              roles.py (all permission rules; team roles "<CODE> Team"), sign-in API, Entra ID backend
  apps/masterdata/signals.py  Creates, renames and removes a work group's team role with it
  apps/masterdata/            Work groups, directions, group members (GroupMember), configurable lists (LookupValue)
  apps/register/              Tasks, activities, partner rows and contributions (up to five of each per task)
    visibility.py             Who sees which tasks and links (teams: own register + shared part only)
    services/checks.py        The automatic check: one place, used by the API, the Check page and the live form check
    management/commands/      seed_demo (demo data and trial users)
  apps/backup/                Full backup / restore (services.py), restore points (models.py), Excel export, export_data and import_data
  tests/                      pytest: check rules, permissions, authentication
frontend/
  src/api/                    Typed API client (CSRF aware), types, React Query hooks
  src/auth/                   Session state and the client-side mirror of the edit rules
  src/components/             Layout, shared UI (tooltips, pager, modal), Gantt, charts, drill-down window, activity form
  src/pages/                  Overview, Register, Task, Task form, Activities, Links, Check, Master Plan, Configuration, Backup
  src/i18n/                   English / Arabic: the dictionary (ar.ts, extra.ts) and the provider that translates the rendered
                              interface, turns the page right to left and switches the month names
  src/lib/                    Field definitions, help texts, formatting, entrance animation, drill-down helpers
  docker/                     nginx config and security headers
```

## Main API endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/login/`, `POST /api/auth/logout/`, `GET /api/auth/me/` | Session sign-in |
| `GET/POST /api/tasks/`, `GET/PATCH/DELETE /api/tasks/{id}/` | Register (filters: `work_group`, `status`, `direction`, `workstream`, `check=ok/not_ok`, `search`) |
| `POST /api/tasks/{id}/transition/` | Change the status (the Master Plan include and release are TMO only) |
| `POST /api/tasks/check-draft/` | Live check of unsaved form data |
| `GET /api/tasks/summary/` | Figures for the Overview and Check pages, and `drill`: the tasks behind each figure (`rows`, and `sets` from a figure to task ids) |
| `GET /api/tasks/master-plan/` | Consolidated plan with activities and what each task waits for (Administrator, TMO, Viewer) |
| `GET /api/tasks/directory/` | Code and title of tasks, to choose "their task" for a link |
| `/api/activities/` | Activities (sheet 4) of the visible registers (filters `task`, `task__work_group`); each row carries its task, owner and owner group. The owner must be a member of the task's work group |
| `GET /api/partners/`, `GET /api/contributions/` | Partner and contribution rows for the Links page (filter `involves=<group>`). They are saved with the task: the `partners` and `contributions` lists in the task body (up to five each) |
| `/api/work-groups/`, `/api/directions/`, `/api/members/`, `/api/lookups/` | Configuration (members: teams read their own groups only) |
| `GET /api/audit/` | Audit log |
| `GET /api/backup/export/`, `GET /api/backup/export-excel/`, `POST /api/backup/restore/` | Backup, Excel export, restore (Administrators only). The check (`dry_run`) returns the backup's counts with the current ones |
| `GET /api/backup/restore-points/`, `GET …/{id}/download/`, `POST …/{id}/restore/` | Restore points kept before every restore (the last five) |

The full OpenAPI description is at `/api/schema/`, with a browsable version at `/api/docs/`.

## The check

`check_task(task, partners=None, contributions=None)` returns a list of issues, each with a field, a label, a message and a level (`error` or `warning`). The form's live check passes the rows as typed. A task is OK when it has no errors and no "before ready" warnings. The rules follow sheet 5 (Check) of the Simplified Task Register:

- Required: task, direction, main workstream, owner role, readiness status. Before Ready: planned start and finish.
- The direction belongs to the task's own work group; the planned finish is not before the start.
- Each partner (up to five): a role, what we need, when, and their task number written as `<GROUP>-T000` of that partner group; a group is named once and is never the task's own group.
- An Enable or Support task has at least one contribution and up to five; each one names the group it helps (another group), what it delivers, when they need it, and their task number of that group.
- Activities (sheet 4): inside the task dates, finish after start, predecessors of the same task, start after each predecessor finishes, and an owner who is a member of the task's own work group.

## Languages

The interface is written in English. `LanguageProvider` keeps the chosen language (English or Arabic) in the browser and remounts the app when it changes. In Arabic it sets `dir="rtl"`, switches the month names used by `lib/format.ts`, and a `MutationObserver` translates every rendered text, tooltip, placeholder and label through `src/i18n/ar.ts` (exact phrases, then patterns for text with numbers or codes). Content people type is never translated. Timelines and charts keep time running left to right. To translate a new interface text, add it to `src/i18n/extra.ts`.
