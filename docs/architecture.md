# Architecture and code layout

```
backend/                      Django project (config/) and four apps
  config/settings.py          All settings from environment variables (django-environ)
  apps/core/                  Audit log, pagination, error handling, health check
  apps/accounts/              roles.py (all permission rules; per group "<CODE> Team Leader / Coordinator / Member"), role_names.py (1.16 renames), sign-in API, Entra ID backend
  apps/masterdata/signals.py  Creates, renames and removes a work group's three roles with it
  apps/masterdata/membership.py  Keeps a member's type (Leader / Coordinator / Member) and their account's role in step
  apps/masterdata/initial.py  Loads initial_data/initial_data.json (command load_initial_data)
  apps/masterdata/            Work groups, directions, group members (GroupMember), configurable lists (LookupValue)
  apps/register/              Tasks, activities, partner rows and contributions (up to twenty of each per task), leader decisions
    visibility.py             Who sees which tasks and links (teams: own register + shared part only)
    services/checks.py        The automatic check: one place, used by the API, the Check page and the live form check
    management/commands/      seed_demo (demo data and trial users)
  apps/backup/                Full backup / restore (services.py), restore points (models.py), Excel export, export_data and import_data
  tests/                      pytest: check rules, permissions, authentication
frontend/
  src/api/                    Typed API client (CSRF aware), types, React Query hooks
  src/auth/                   Session state and the client-side mirror of the edit rules
  src/components/             Layout, shared UI (tooltips, pager, modal), Gantt, charts, drill-down window, activity form
  src/pages/                  Overview, Register (table and Gantt), Governance, Task, Task form, Activities, Links, Check, Master Plan, Configuration, Backup
  src/i18n/                   English / Arabic: the dictionary (ar.ts, extra.ts) and the provider that translates the rendered
                              interface, turns the page right to left and switches the month names
  src/lib/                    Field definitions, help texts, formatting, entrance animation, drill-down helpers
  docker/                     nginx config and security headers
```

## Main API endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/login/`, `POST /api/auth/logout/`, `GET /api/auth/me/` | Session sign-in; `me` lists `work_groups` (groups the user may change) and `view_groups` (every group they belong to, with their role) |
| `POST /api/auth/password/` | Change one's own password (`current_password`, `new_password`) |
| `GET/POST /api/tasks/`, `GET/PATCH/DELETE /api/tasks/{id}/` | Register (filters: `work_group`, `status`, `direction`, `workstream`, `check=ok/not_ok`, `search`) |
| `POST /api/tasks/{id}/transition/` | Change the status (the Master Plan include and release are TMO only) |
| `POST /api/tasks/check-draft/` | Live check of unsaved form data |
| `GET /api/tasks/summary/` | Figures for the Overview and Check pages, and `drill`: the tasks behind each figure (`rows`, and `sets` from a figure to task ids) |
| `GET /api/tasks/master-plan/` | Consolidated plan with activities and what each task waits for (Admin, TMO, Global Viewer) |
| `GET /api/tasks/timeline/` | The register's tasks for the Gantt view (same filters as the list; teams see their own groups) |
| `GET /api/tasks/governance/?work_group=` | The leader's desk: the group's Direct tasks with their approval, and the links other groups record with it, with `pending` counts |
| `POST /api/tasks/{id}/approval/` | The leader's decision on a Direct task (`approved`, `rejected`, `clarification`, with a note) |
| `GET /api/audit/` (filters `actor`, `action`, `entity`, `entity_id`, `work_group`, `date_from`, `date_to`, `q`), `GET /api/audit/{id}/`, `GET /api/audit/facets/`, `GET /api/audit/export/` | The audit trail with values before and after; CSV export |
| `GET /api/system-events/` (filters `level`, `source`, `resolved`, `q`), `GET …/summary/`, `POST …/{id}/resolve/`, `POST …/{id}/reopen/`, `POST …/resolve-all/` | System issues (Admins) |
| `POST /api/client-errors/` | The web app reports an error in the user's browser |
| `GET /api/tasks/directory/` | Code and title of tasks, to choose "their task" for a link |
| `/api/activities/` | Activities (sheet 4) of the visible registers (filters `task`, `task__work_group`); each row carries its task, owner and owner group. The owner must be a member of the task's work group |
| `GET /api/partners/`, `GET /api/contributions/` | Partner and contribution rows for the Links page (filter `involves=<group>`). They are saved with the task: the `partners` and `contributions` lists in the task body (up to twenty each). `POST …/{id}/review/`: the leader of the group the row names decides (`approved`, `rejected`, `clarification`, `timeline` with `proposed_date`; a note is required except for approval) |
| `GET /api/work-groups/leader-candidates/` | Active users who can lead a group (Admin, TMO) |
| `/api/work-groups/`, `/api/directions/`, `/api/members/`, `/api/lookups/` | Configuration (members: teams read their own groups only) |
| `GET /api/audit/` | Audit log |
| `GET /api/backup/export/`, `GET /api/backup/export-excel/`, `POST /api/backup/restore/` | Backup, Excel export, restore (Admins only). The check (`dry_run`) returns the backup's counts with the current ones |
| `GET /api/backup/restore-points/`, `GET …/{id}/download/`, `POST …/{id}/restore/` | Restore points kept before every restore (the last five) |

The full OpenAPI description is at `/api/schema/`, with a browsable version at `/api/docs/`.

## Security modules

| File | What it does |
|---|---|
| `backend/apps/accounts/lockout.py`, `backends.py`, `signals.py` | Sign-in lockout (also for the admin), session start time, sign-in events |
| `backend/apps/core/middleware.py` | Idle and absolute session limits; security headers on API answers |
| `backend/apps/core/security.py` | The `security` log and the client address behind trusted proxies |
| `backend/apps/core/audit.py`, `backend/apps/register/auditing.py` | Audit entries with request context and before / after snapshots |
| `backend/apps/core/events.py` | Logging handler that stores server errors and security warnings for System issues |
| `backend/apps/core/exceptions.py` | JSON errors; `code: not_authenticated` for ended sessions; refused requests logged |
| `frontend/src/api/client.ts` | CSRF header, ended-session event; no tokens in browser storage |

SECURITY.md maps every control to its OWASP Top 10 category.

## Save-time validation

`apps/register/validation.py` holds the rules the API enforces when a task or activity is saved (`TaskSerializer.validate`, `ActivitySerializer.validate`); the same rules run in the browser (`frontend/src/lib/dates.ts`) so the forms can show them first:

- every planned date within `REGISTER_DATE_MIN`–`REGISTER_DATE_MAX` (settings, from the environment);
- task: planned finish on or after planned start; when the dates change, every activity still inside them;
- activity: finish on or after start, inside the task's planned dates, after its predecessors finish and before its successors start; the task must have both dates;
- task title and activity name: trimmed, at least 3 characters with a letter; their task numbers like `HR-T012`; contributions to another group; no newly picked inactive group or member.

The live check (`POST /api/tasks/check-draft/`) reports these as errors instead of refusing.

## The check

`check_task(task, partners=None, contributions=None)` returns a list of issues, each with a field, a label, a message and a level (`error` or `warning`). The form's live check passes the rows as typed. A task is OK when it has no errors and no "before ready" warnings. The rules follow sheet 5 (Check) of the Simplified Task Register:

- Required: task, direction, main workstream, owner role, readiness status. Before Ready: planned start and finish.
- The direction belongs to the task's own work group; the planned finish is not before the start.
- Each partner (up to twenty): a role, what we need, when, and their task number written as `<GROUP>-T000` of that partner group; a group is named once and is never the task's own group.
- An Enable or Support task has at least one contribution and up to twenty; each one names the group it helps (another group), what it delivers, when they need it, and their task number of that group.
- Governance: a Direct task waiting for its leader, or with a question, is a warning; a rejected one is an error. On links, another group's leader rejecting is an error; a question or a proposed new date is a warning.
- Activities (sheet 4): inside the task dates, finish after start, predecessors of the same task, start after each predecessor finishes, and an owner who is a member of the task's own work group.

## Languages

The interface is written in English. `LanguageProvider` keeps the chosen language (English or Arabic) in the browser and remounts the app when it changes. In Arabic it sets `dir="rtl"`, switches the month names used by `lib/format.ts`, and a `MutationObserver` translates every rendered text, tooltip, placeholder and label through `src/i18n/ar.ts` (exact phrases, then patterns for text with numbers or codes). Content people type is never translated. Timelines and charts keep time running left to right. To translate a new interface text, add it to `src/i18n/extra.ts`.
