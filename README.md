# Task Register — Al-Ayuni TMO

**Version 1.10.0** · see [CHANGELOG.md](CHANGELOG.md) · based on the TMO Task Register prototype v1.9

A web application in which each work group keeps its **register of tasks** (its business plan for the Final Mile to 2027), links its tasks with other groups, runs an **automatic check**, and in which the TMO builds the consolidated **Master Plan** from the tasks that are ready.

It covers registering and planning only. It does not track execution (progress or health).

The task form follows the **Simplified Task Register v1.7** template, in its four steps:

| Step | What the group fills in |
|---|---|
| 1. Describe the task | Task, direction, main workstream, sub-objective (optional) |
| 2. Who it involves | Owner role (Direct / Enable / Support); **Partners**: up to twenty partner groups, added with *+ Add partner*, each with its role and **what we need, when, and their task number**. An Enable or Support task also records its **Contributions**: up to twenty, added with *+ Add contribution*, each with **the group it helps, what it delivers, when, and their task number** |
| 3. Plan | Planned start and finish (working days are calculated, Friday and Saturday off); the activities of big tasks |
| 4. Readiness | Ready to include, or Needs completion |

The automatic check uses the template's rules and messages. On top of it, the API refuses data that cannot be right: a planned finish before its start, a date outside the register's range (2024–2035 by default, set with `REGISTER_DATE_MIN` / `REGISTER_DATE_MAX`), an activity outside its task's planned dates or starting before its predecessor finishes, and task dates that would leave an activity outside. The forms show these problems next to the field before saving. When both groups record each other's task number, the link shows as **agreed both sides**.

What else is in the app:

* **English / العربية.** The switch in the header (and on the sign-in page) shows the whole interface in Arabic, right to left, with Arabic month names and a self-hosted Arabic font. What people type (task names, directions, activities) stays as typed. The choice is remembered in the browser.
* **Group members belong to a work group.** An activity owner is picked from the members of the task's own group; the API refuses an owner from another group, and the check flags an activity whose owner was later moved to another group.
* **Activities page** (sheet 4): every activity with its owner, dates, predecessors and check, a timeline grouped by task, activities finishing per month and the workload of each owner. Activities can be added and edited there or on the task page.
* **Every count opens its rows.** Click a number on the Overview, Check, Activities, Master Plan or Configuration pages, or a bar or segment of a chart, to see the tasks or activities behind it; click a row to open the task. Every bar and segment has a tooltip that explains it.
* **Governance by work group leaders.** Each work group has one leader. The leader approves or rejects the group's tasks that are **Ready to include** (approved tasks go to the TMO for the Master Plan), and reviews every **dependency other groups record with the group** (what they need from us, what they deliver to us): **approve or reject**, with a reason when needed. Decisions show on the task, on the Links page and in the other group's check. Every task's page and edit form show its **status workflow**: an animated stepper of the readiness flow with who took each step and when, and the full history with every reason. See the **Governance** page.
* **Action centre.** A bell in the header counts what waits for you: for the Focal Point, tasks and links sent back with the reason and tasks to complete; for the Team Leader, tasks to approve or reject and links to review; for the TMO, tasks to include in the Master Plan. An item opens the task with what to do pointed out, and leaves the list once it is done.
* **Register as a table or a Gantt timeline**, with the same filters. Each task can carry a **description** (scope and expected result) next to its name.
* **Audit trail** page: every change with the values before and after, who made it, when and from where; failed sign-ins and admin-site changes too. Filters and CSV download.
* **System issues** page for administrators: server errors with technical details, errors in users' browsers, and security warnings, with resolve / reopen.
* **Group members** have optional job title, email and phone.
* **Master Plan at a glance:** planned progress by today (weighted by working days), the plan of each work group, what finishes in the next 45 days, active tasks per month and activities finishing per month, with short entrance animations (turned off when the device asks for reduced motion).

| Part | Technology |
|---|---|
| API | Python 3.12 · Django 5.2 LTS · Django REST Framework · drf-spectacular (OpenAPI) |
| Web app | React 18 · TypeScript (strict) · Vite · TanStack Query · React Router |
| Database | PostgreSQL 16 |
| Delivery | Three containers (nginx + React, gunicorn + Django, Postgres) · GitHub Actions → GHCR |
| Sign-in | Local accounts, plus optional Microsoft Entra ID (OpenID Connect) |

```
browser ──► frontend (nginx :8080) ──/api, /admin, /oidc, /static──► backend (gunicorn :8000) ──► db (postgres :5432)
                 └── serves the React build for every other path
```

Only the frontend container publishes a port. The API and the database sit on an internal Docker network.

---

## 1. Run it with Docker Desktop

You need Docker Desktop 4.x (with Compose v2) and Git.

```bash
git clone https://github.com/<you>/task-register.git
cd task-register
cp .env.example .env
```

Edit `.env` and replace every `CHANGE-ME` value:

* `DJANGO_SECRET_KEY`: generate it with `python -c "import secrets; print(secrets.token_urlsafe(50))"`
* `DB_PASSWORD`: any long random value
* `DEMO_USER_PASSWORD`: the password for the trial users below

Then start it:

```bash
docker compose up --build
```

Open **http://localhost:8080** and sign in with one of the trial users.

The first start runs the migrations, creates the roles and loads the **organisation's initial data**: the 13 work groups with their mission and weight, their 103 directions, 78 sub-objectives and 75 group members (69 people), each with a sign-in account and the role the focal-point sheet gives them (see [Initial data](#initial-data)). While `SEED_DEMO=true` it also loads the trial users and a sample register: 55 tasks across all 13 work groups with 149 activities, and links between groups at every governance state (waiting, approved, rejected). Sign in as `shadi.alghanim` (ICT Team Leader) and open **Governance › Other groups' tasks with us** to see the requests other groups made to ICT. Later starts keep your data, which lives in the `pgdata` volume.

* `INITIAL_USER_PASSWORD` (optional): first password of the accounts created for the group members. Without it, they cannot sign in with a password until an Admin sets one (or they use Entra ID). On a demo (`SEED_DEMO=true`) they get `DEMO_USER_PASSWORD`. Everyone can change their own password from the menu (**Change password**).

| Useful command | What it does |
|---|---|
| `docker compose logs -f backend` | Follow the API log (the trial users are listed there on first start) |
| `docker compose exec backend python manage.py createsuperuser` | Create a real administrator |
| `docker compose exec backend python manage.py seed_demo --reset` | Wipe the register and reload the initial and demo data |
| `docker compose exec backend python manage.py load_initial_data` | Add what is missing from the initial data (existing records are kept); `--update` also restores the file's names, texts and member types; `--no-users` adds no accounts |
| `docker compose down` | Stop the containers and keep the data |
| `docker compose down -v` | Stop and **delete** the database volume |

### If the backend stops with `password authentication failed for user "task_register"`

PostgreSQL takes `DB_PASSWORD` **only the first time** it creates the `pgdata` volume. If you started once and then changed `DB_PASSWORD` in `.env`, the database still expects the first password. The backend log says this in plain words. To fix it, do one of these:

* put the original `DB_PASSWORD` back in `.env` and run `docker compose up -d`; or
* start again with an empty database. **This deletes the data in it**, so download a backup first if you need it:
  ```bash
  docker compose down -v
  docker compose up --build
  ```

Other checks:
* `.env` must sit next to `docker-compose.yml`. Run `docker compose config` to see the values Compose actually uses.
* A password containing `$` must be wrapped in single quotes: `DB_PASSWORD='pa$word'`.

Other addresses:

* Django admin: http://localhost:8080/admin/ (Admin role)
* API docs (Swagger): http://localhost:8080/api/docs/
* Health check: http://localhost:8080/healthz

---

### Upgrading from 1.4

Start the new version as usual. The database migration converts the data:

* each dependency on another group becomes the row of that partner (what we need, when, their task number); a group that was not yet a partner is added, with its role left for the team to choose;
* one contribution per Enable / Support task is kept;
* milestones, the internal links between a group's own tasks, and the fields the simplified form dropped (task type, output type, target, guidelines, acceptance, oversight, responsible person, profiles, capability, control, cost, effort, capacity, requirements) are removed, together with their lists.

**Download a backup before upgrading** (Backup & restore page), and an Excel export if you want to keep the removed fields for reference. Backups from 1.4 cannot be restored on 1.5: restore them on 1.4, upgrade, then take a new backup.

### Upgrading from 1.5

Start the new version as usual. The migrations turn the old list of group members (plain names) into members of a work group: each person goes to the group whose tasks they own most activities on, and every activity keeps its owner. **A person who owned no activity is put in the first work group (by code)**, so open Configuration › Group members after the upgrade and move them to their own group. Backups made with 1.5 restore on 1.7 and later the same way.

### Quick trial on Render (free, no Docker)

The `render.yaml` Blueprint creates the database, the API and the front end on Render's free tier in one step (**New → Blueprint**). See [docs/render.md](docs/render.md). The free database expires after 30 days, so use it for demos and trials only.

### Upgrading from 1.24

Deploy as usual. Migration `accounts 0006` runs on start. Settings now live in the application (*Administration › System settings*); their first values match 1.24: email code off, password expiry off, minimum length 12, sign-out after 60 idle minutes and at the latest after 10 hours (from `SESSION_IDLE_MINUTES` / `SESSION_ABSOLUTE_HOURS` if you had changed them). Outgoing email can now be entered on that page instead of the `EMAIL_*` environment variables (those still work while the page's SMTP server is off). Accounts, emails and roles are managed on *Administration › User access*. *Configuration* is now *Reference data* (`/reference-data`).

### Upgrading from 1.23

Deploy as usual. Migration `accounts 0005` runs on start and adds the sign-in settings and the leaders' delegations. Nothing changes for users until an administrator turns something on:

* **Email code at sign-in** stays **off**. To use it, set the outgoing email variables (`EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `DEFAULT_FROM_EMAIL`; see [section 7](#7-sign-in-code-by-email-optional)), make sure every account has an email address (Configuration › Group members), then switch it on in **Configuration › Sign-in security**.
* Leaders can name a **delegate** on the Governance desk.
* The **User guide** is at `/guide`, linked from the page header and the sign-in page.

### Upgrading from 1.18

Deploy as usual. Migrations `accounts 0004`, `masterdata 0009` and `register 0012` run on start:

* the role *`<CODE>` Team Coordinator* is renamed **`<CODE>` Team Focal Point**, keeping its users (Entra ID: `TaskRegister.FocalPoint.<CODE>`; the old claim names still work);
* a new readiness status, **Leader Approved**: Ready tasks the leader already approved become Leader Approved (they now wait for the TMO); Ready tasks the leader rejected or questioned go back to Needs completion; tasks in the Master Plan count as approved. Other Ready tasks, Enable and Support ones included, now wait for their leader;
* a group can edit or delete a task only while it is Draft or Needs completion.

Backups from earlier versions restore the same way (backup format 9). To see the new flow on a demo, run `seed_demo --reset` once (on Render: `SEED_DEMO_RESET=true` for one deploy).

### Upgrading from 1.17

No database change. To see the larger sample on a demo, run `seed_demo --reset` once (on Render: `SEED_DEMO_RESET=true` for one deploy).

### Upgrading from 1.16

No database change: deploy as usual.

### Upgrading from 1.15

Deploy as usual. Migrations `accounts 0003` and `masterdata 0008` run on start, then the initial data is loaded:

* roles are **renamed, keeping their users**: *Administrator* → **Admin**, *Viewer* → **Global Viewer**, *`<CODE>` Team* → **`<CODE>` Team Coordinator**, *`<CODE>` Group Leader* → **`<CODE>` Team Leader**; a new **`<CODE>` Team Member** role is created for every group;
* work groups get their mission and weight, the directions and sub-objectives are added (each sub-objective now belongs to one group), and the group members from the focal-point sheet are added with their type and a sign-in account. Records you already have are kept; a member row that had no account yet takes the sheet's type;
* an existing task keeps its sub-objective; if that sub-objective now belongs to another group, the task form says so, and the task needs one of its own group's before it saves again.

Set `LOAD_INITIAL_DATA=false` to skip the initial data. On Render, set `SEED_DEMO_RESET=true` for one deploy to wipe the demo and reload everything, then set it back to `false`. Backups from earlier versions still restore; their roles are renamed the same way.

### Upgrading from 1.14

Deploy as usual: migration `masterdata 0007` creates a *`<CODE>` Group Leader* role (named *`<CODE>` Team Leader* from 1.16) for every work group and gives it to the leader already chosen in Configuration, so nothing changes for current leaders.

### Upgrading from 1.13

Deploy as usual: migrations `core 0004`, `masterdata 0006` and `register 0011` run on start. Existing audit entries keep their author. Backups from earlier versions still restore.

### Upgrading from 1.12

Deploy as usual: migration `core 0003` creates the cache table for rate limits and lockouts. New optional settings are listed in `.env.example` (lockout, session limits, `DJANGO_NUM_PROXIES`, `API_DOCS_ENABLED`); the Docker Compose files and `render.yaml` already set them. Everyone signs in again once, because on HTTPS the cookies get new names. New passwords need at least 12 characters.

### Upgrading from 1.11

No database change. The new rules apply when data is saved: an existing task or activity whose dates break them saves again once its dates are corrected (the automatic check already lists them).

### Upgrading from 1.10

Deploy as usual: migrations `masterdata 0005` and `register 0010` run on start. Then, in **Configuration › Work groups**, pick the **leader** of each group. Existing Direct tasks start as *Waiting for review*, so their leaders approve them on the **Governance** page; tasks already in the Master Plan stay there. Backups from 1.7 to 1.10 still restore.

### Upgrading from 1.8 or 1.9

No database change: deploy the new version as usual. Each person's theme choice is kept in their browser.

### Upgrading from 1.7

Start the new version as usual. Migration 0009 lets a task hold up to five contributions (each with its number) and up to five partners; every existing contribution becomes contribution 1 of its task. In the API a task now carries `contributions` (a list) instead of `contribution`. Backups made with 1.7 restore on 1.8 unchanged.

## 2. Roles and trial users

Roles are Django groups. There are three fixed roles (**Admin**, **TMO Officer**, **Global Viewer**) plus **three roles per work group**, named after its code: **`<CODE>` Team Leader**, **`<CODE>` Team Focal Point** and **`<CODE>` Team Member** (for example *HR Team Leader*, *HR Team Focal Point*, *HR Team Member*). They are created automatically when a work group is added (in Configuration or the admin), renamed if its code changes, and removed with the work group. A user can hold roles in several groups. All rules are enforced by the API (`backend/apps/accounts/roles.py`); the web app only hides the buttons that the API would refuse.

| Role | Registers | Master Plan | Changes |
|---|---|---|---|
| **Admin** | All, in full | Yes | Everything, including users, backup and restore |
| **TMO Officer** | All, in full | Yes | Configuration; decides on **Leader Approved** tasks: **include** them in the Master Plan, or **send them back** to the group with a reason (also a task already in the plan); full audit log |
| **Global Viewer** (the committee) | All, in full | Yes | None (read-only) |
| **`<CODE>` Team Leader** (for example **HR Team Leader**; one per group) | **Own group only** in full; of other groups, only the **shared part** | **No** | **Full control of the group**: everything the Focal Point does, plus governance: decides on the group's tasks that are **Ready to include** (any type): **approve** (→ *Leader Approved*, for the TMO) or **reject** (→ *Needs completion*, back to the Focal Point, with a reason when needed); and decides on **other groups' Direct and Enable / Support tasks that involve the group**: **approve or reject** (with a reason when needed). Also edits the contact details of the group's members |
| **`<CODE>` Team Focal Point** (for example **HR Team Focal Point**) | As the leader | **No** | **Adds** the group's tasks; **edits and deletes** them, with their partner rows, contributions and activities, while they are **Draft** or **Needs completion**; **submits** them to the leader (*Ready to include*) and may withdraw them to Draft until the leader decides |
| **`<CODE>` Team Member** (for example **HR Team Member**) | As the leader | **No** | None: reads the whole register of the group (read-only) |

**How people get these roles.** In Configuration › Group members, each person of a group is a **Leader**, **Focal Point** or **Member**. When the person has a sign-in account (shown in the *Account* column), the type gives the account that group's role, and changing the type changes the role. Each group has one leader: making someone Leader (here, by picking the leader in Configuration › Work groups, by giving the *Team Leader* role in the admin site, or through Entra ID `TaskRegister.Leader.HR`) moves the previous leader to Member. Roles can also be given directly in the admin site or through Entra ID (`TaskRegister.FocalPoint.HR`, `TaskRegister.Member.HR`; the older `TaskRegister.Coordinator.HR` and `TaskRegister.Team.HR` still give the Focal Point role).

### Readiness: from the Focal Point to the Master Plan

| Status | Who acts | What happens next |
|---|---|---|
| **Draft** / **Needs completion** | The group's **Focal Point** (or its leader) prepares the task and can edit or delete it | *Submit to the leader* → **Ready to include** |
| **Ready to include** | The **Team Leader** decides (Governance › *Our tasks to approve*); the Focal Point can still withdraw it to Draft | Approve → **Leader Approved**; reject → **Needs completion**, with the reason if given |
| **Leader Approved** | The **TMO** decides (Master Plan › *TMO decisions*) | Include → **In Master Plan**; send back → **Needs completion**, with the reason |
| **In Master Plan** | Locked; only the TMO can send it back to the group, with a reason | → **Needs completion** |

**Leader away?** On the Governance desk the leader (or an administrator) names a **delegate**: a person of the group, for up to 90 days. While it runs, the delegate gets the group's approvals in the bell and on the Governance desk and approves or rejects in the leader's place (reading the group's register, never editing it). The leader keeps their own rights and can cancel at any time; the delegate is told by email when email is set up, and every delegation is in the audit trail.

Every step is confirmed in a dialog; the leader's note and the TMO's reason show on the task and in its check until it is submitted again. Deleting a task deletes its activities, partner rows and contributions; the confirmation says how many activities go with it and takes an optional reason, kept in the audit trail.

### Initial data

`backend/apps/masterdata/initial_data/initial_data.json` holds the organisation's data, taken from the three files provided:

* **Work groups and directions** from *Directions from Leadership – Group-Wise*: 13 groups with their name, mission, weight (they add up to 100%) and directions with what each means (103 in total; IDs like `HR-D01`).
* **Sub-objectives** from *13 Groups Subobjectives*: 78, each assigned to its group. Bidding & Commercial has none in the file.
* **Group members** from *Task Register Group Focal Points* (sheet *Final*): 75 rows, 69 people (some sit in more than one group). The type comes from the note in front of each name: *Leader*, *Coordinator* (now named **Focal Point**), otherwise **Member**. Each person gets one account, named from their name (`amr.gomaa`, `rakan.alauni`, …), with the role of each group they are in.

`load_initial_data` runs on every start (unless `LOAD_INITIAL_DATA=false`) and only adds what is missing, so changes made in Configuration are kept.

Group members (the people who can own activities) are maintained by administrators and the TMO in Configuration. A team sees the members of its own groups only.

**What a team sees of other work groups.** Only what other groups have in common with it:

* the **Links with other groups** page lists every partner and contribution row on either side: its own, and those other groups recorded with it;
* opening another group's linked task shows a **shared view**: code, title, owner group, status and dates, plus the links with the team's group. The task's direction, workstream, activities and check stay hidden;
* another group's task with no link to the team is not shown at all;
* the Register, Overview and Check pages cover only the team's own register, and other groups' task counts are hidden;
* to record a link, the team picks "their task" from a list showing only each task's code and title.

All of this is enforced by the API (`backend/apps/register/visibility.py`), not only by the screens.

Upgrading from a version before 1.9? The database migration gives every user who had *Group Lead* or *Group Editor* the coordinator role of their work group, and `setup_roles` (run on every start) then removes the old roles.

Task lifecycle: **Draft → Needs completion → Ready → In Master Plan**.

* Only the TMO (or an administrator) moves a task into the Master Plan, and only when its check is OK and, for a Direct task, its leader has approved it.
* Once a task is in the Master Plan it is locked for the work group until the TMO releases it.
* Values in use (directions, list values, work groups) cannot be deleted. The core values that drive the rules can be renamed but not deleted.

Trial users (all with the password from `DEMO_USER_PASSWORD`). On a demo, the accounts of the real group members get the same password, so you can also sign in as them:

| User | Role | Work group |
|---|---|---|
| `admin` | Admin | — |
| `tmo.officer` | TMO Officer | — |
| `committee.viewer` | Global Viewer | — |
| `ict.team`, `hr.team`, `fin.team` | ICT / HR / FIN Team Focal Point | ICT, HR, FIN |
| `hr.member` | HR Team Member (read-only) | HR |
| `shadi.alghanim` | ICT Team Leader | ICT |
| `rakan.alauni` | HR Team Leader | HR |
| `hussam.eldien.salah` | FIN, SCM and SS Team Leader | FIN, SCM, SS |
| `amr.gomaa` | ICT Team Focal Point | ICT |

> Trial users and demo data are for testing only. In production set `SEED_DEMO=false`, create real users, and use Entra ID sign-in.

---

## 3. Backup and restore

Administrators have a **Backup & restore** page in the menu.

| Action | What you get |
|---|---|
| **Download backup** | One JSON file with *everything*: users (password hashes only), roles, work groups, directions, lists, all tasks with their partner rows, contributions and activities, and the audit log. A checksum inside detects damaged or edited files. |
| **Download Excel** | A readable workbook, one sheet per table, for reports and review. It cannot be restored. |
| **Restore** | Upload a backup and check it: the page shows what it holds next to the current figures (nothing changes yet). Type `RESTORE`, and all current data is replaced with the backup. All or nothing: if anything fails, the current data stays as it was. |
| **Restore points** | Before every restore the server keeps a full backup of the current data. The last five are listed on the page: download one, or go back to it (which keeps a new restore point first). |

Every download and restore is recorded in the audit log and shown on the page. Only the Admin role can use these functions; the API refuses everyone else.

**Scheduled backups** from the server's command line:

```bash
# Write a backup file on the host (the containers stay read-only)
docker compose exec -T backend python manage.py export_data -o - > backups/task-register-$(date +%F).json

# Check a backup file, then restore it
docker compose exec -T backend python manage.py import_data - < backups/task-register-2026-11-14.json
docker compose exec -T backend python manage.py import_data - --yes < backups/task-register-2026-11-14.json
```

Keep backup files somewhere safe and access-controlled: they contain users' password hashes. On Azure, the managed PostgreSQL's own automatic backups (point-in-time restore) remain your first line of defence. This feature adds a portable copy you control, which you can also move between environments, for example from test to production.

## 4. Push it to your GitHub repository

```bash
cd task-register
git init -b main
git add .
git commit -m "Task Register v1.5"
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

`.env` is in `.gitignore`. Never commit it.

On every push and pull request, the **CI** workflow (`.github/workflows/ci.yml`):

1. checks the backend: ruff lint and format, missing migrations, `manage.py check --deploy`, and the pytest suite against Postgres 16;
2. checks the frontend: ESLint, TypeScript, the production build and `npm audit`;
3. on pushes to `main` and on `v*` tags, builds both images and publishes them to GitHub Container Registry:
   * `ghcr.io/<you>/<repo>-backend`
   * `ghcr.io/<you>/<repo>-frontend`

To run the published images instead of building locally, set `IMAGE_PREFIX=ghcr.io/<you>/<repo>` and `IMAGE_TAG=latest` in `.env`, then run `docker compose pull && docker compose up -d`. Packages are private by default; make them public under **Packages → Package settings**, or sign in first with `docker login ghcr.io`.

Dependabot (`.github/dependabot.yml`) opens weekly update PRs for Python, npm, the base images and the Actions.

---

## 5. Develop without Docker

Backend (Python 3.12):

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
export DJANGO_DEBUG=true DJANGO_SECURE_COOKIES=false DEMO_USER_PASSWORD='Trial@Register2026'
python manage.py migrate && python manage.py setup_roles && python manage.py seed_demo
python manage.py runserver          # http://localhost:8000 (SQLite unless DATABASE_URL is set)
pytest && ruff check . && ruff format --check .
```

Frontend (Node 20):

```bash
cd frontend
npm ci
npm run dev                          # http://localhost:5173, proxies the API to :8000
npm run lint && npm run typecheck && npm run build
```

---

## 6. Microsoft Entra ID sign-in (optional)

1. In Entra ID, register an application with the web redirect URI `https://<your-host>/oidc/callback/`.
2. Create a client secret.
3. Under **App roles**, add these values and assign them to users or groups:
   `TaskRegister.Admin`, `TaskRegister.TMO`, `TaskRegister.Viewer`, and per work group `TaskRegister.Leader.<CODE>`, `TaskRegister.FocalPoint.<CODE>` (or the older `TaskRegister.Coordinator.<CODE>` and `TaskRegister.Member.<CODE>` (for example `TaskRegister.Leader.HR` gives *HR Team Leader*; the older `TaskRegister.Team.<CODE>` gives the Coordinator role).
4. Set the following in `.env`:
   `OIDC_ENABLED=true`, `OIDC_TENANT_ID`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`.

The sign-in page then shows **Sign in with Microsoft**. On each sign-in, the user's roles, including their team roles, are set from the app roles.

## 7. System settings, user access and the sign-in code

**Administration › System settings** (administrators) holds the sign-in and email policies, each with its own switch: outgoing email (SMTP), the email code at sign-in, password expiry (60/90/180 days), minimum password length, sign-out after inactivity and the maximum session length. **Administration › User access** creates accounts, sets their email, gives and removes roles, resets passwords and unlocks accounts, without the Django admin site.

The email code at sign-in (multi-factor) is **off by default**. To use it:

1. Set up outgoing email on **System settings › Outgoing email** (server, port, security, user, password, sender; for Microsoft 365: `smtp.office365.com`, port 587, STARTTLS, a mailbox allowed to send with SMTP AUTH) and send a test message. Alternatively set `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS`, `DEFAULT_FROM_EMAIL` in the environment. Set `APP_PUBLIC_URL` for links in emails.
2. Give every account an email address: **User access** (filter *No email*), or Reference data › Group members (a member's email becomes their account's email).
3. Switch **Email code at sign-in** on. You can also set how long a code stays valid (5 to 30 minutes).

After the password, the person receives a code (in English and Arabic) and enters it to finish signing in. A code works once; 5 wrong codes end the attempt and count towards the account lockout; a new code can be sent every 30 seconds. If email stops working, turn it off on the server with `python manage.py signin_code off`. People who sign in with Microsoft Entra ID are not asked for a code (Entra applies its own MFA).

---

## 8. Going to production

**Azure VM + Azure Database for PostgreSQL:** follow [docs/deploy-azure.md](docs/deploy-azure.md) (Azure CLI) or [docs/deploy-azure-portal.md](docs/deploy-azure-portal.md) (Azure Portal). It uses `docker-compose.azure.yml` (no database container, automatic HTTPS with Caddy). **Everything on one VM**, PostgreSQL included: add `docker-compose.azure-db.yml` (Part B of the Portal guide; nightly backups with `deploy/azure/backup-local-db.sh`).

In general:

* Put the frontend container behind HTTPS (Azure Container Apps, App Service, or a reverse proxy).
* Set `DJANGO_SECURE_COOKIES=true`, `DJANGO_SECURE_SSL_REDIRECT=true`, `DJANGO_HSTS_SECONDS=31536000`, and your real `DJANGO_ALLOWED_HOSTS` and `DJANGO_CSRF_TRUSTED_ORIGINS`.
* Use a managed PostgreSQL with backups, and keep the secrets in the platform's secret store.
* Set `SEED_DEMO=false`.
* The amber **Under development** mark beside the page title comes from `VITE_APP_STAGE` at build time. Build with `APP_STAGE=` (empty) or `APP_STAGE=off` to hide it once the application is live (for the images GitHub builds: the repository variable `APP_STAGE`), or set another word such as `APP_STAGE=Pilot`.

See [SECURITY.md](SECURITY.md) for the security controls, and [docs/architecture.md](docs/architecture.md) for the code layout.
