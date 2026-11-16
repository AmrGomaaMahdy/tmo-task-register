# Changelog

## 1.9.0 — 2026-11-16
Brings the application in line with the TMO Task Register prototype v1.9.
- **Right-to-left timelines in Arabic:** the Master Plan Gantt and the Activities timeline start on the right with the first month and run leftwards; the task column sits on the right and bars grow from the right. The month bar charts are mirrored too, with their value axis on the right. English task names in the Gantt are cut at their end, not their start.
- **Two new themes:** the side menu now has a theme picker with four swatches: Light, Dark, **Desert gold** (warm sand and copper, gradient menu, soft dunes behind the page) and **Aurora night** (deep indigo with green and violet lights, glass-like panels). The choice is kept per browser; without one the app follows the device's light or dark setting.
- **Menu icons:** each menu item has a line icon instead of a number; the current page's icon is highlighted in gold. The collapsed menu shows the icons alone, and phones show them in the scrolling menu.
- The Gantt opens near today only when today is well into the plan, so the start of the plan stays in view otherwise.

## 1.8.0 — 2026-11-16
Brings the application in line with the TMO Task Register prototype v1.8.
- **Partners, up to five:** in the task form (step 2, Who it involves) partner rows are added with *+ Add partner* and removed with *✕ Remove*, up to five per task, with an "N of 5" counter. A group already named on another row is not offered again; a row without a group stops the save and is flagged by the live check.
- **Contributions, up to five:** an Enable or Support task records its contributions with *+ Add contribution*, each with the group it helps, what it delivers, when they need it and their task number. The check asks for at least one. `Contribution` is now a list per task (`contributions` in the API, with a `slot` number); migration 0009 keeps every existing contribution as contribution 1.
- **No more "table A / table B":** the app, the check messages, the Excel export (sheets *Partners* and *Contributions*, partner groups 1 to 5 and a contributions count) and the docs say Partners and Contributions. The task's Links tab shows "N / 5" for each list.
- **Brand:** the Al-Ayuni logo in the side menu and on the sign-in page, and an animated **Final Mile to 2027** strip: a shining title over a road that fills to today's share of the program (1 Sep 2026 to 31 Oct 2027), with a runner, the 2027 flag and a tooltip with the days to go. Animations stop when reduced motion is requested; the collapsed menu shows a small logo only.
- **Backup:** format version 4. Version 3 (1.7) and version 2 (1.5) backups still restore.
- Arabic: the interface strings follow the prototype v1.8; saved times (audit log, last change, backups) use Arabic month names too.

## 1.7.0 — 2026-11-15
Brings the application in line with the TMO Task Register prototype v1.7 (the version number follows the prototype).
- **English / العربية:** a language switch in the header and on the sign-in page. Arabic shows the whole interface right to left, with Arabic month names and a self-hosted Arabic font (the strict content security policy is unchanged).
- **Group members belong to a work group** (new `GroupMember` model, `/api/members/`, Configuration › Group members). Activity owners are picked from the task's own group; the API refuses an owner from another group and the check flags an owner moved to another group. Migrations 0006 to 0008 (register) and 0003 to 0004 (masterdata) convert the old list of names.
- **Activities page** (sheet 4): counts, activities finishing per month, workload by owner, a timeline grouped by task, and the activity register with filters. Activities can now be **edited** (here and on the task page), not only added and removed.
- **Clickable numbers:** counts on the Overview, Check, Activities, Master Plan and Configuration pages, and the bars and segments of charts, open the tasks or activities behind them. The summary API returns these lists (`drill`).
- **Master Plan:** planned progress by today, running tasks, progress rings, plan by work group, next finishes, active tasks per month and activities finishing per month; Gantt bars have full tooltips. Short entrance animations (bars grow, numbers count up), off when reduced motion is requested.
- **Check page:** readiness donut; every summary figure opens its tasks.
- **Backup:** format version 3 (with group members); version 2 backups (v1.5) are upgraded while restoring. A **restore point** of the current data is kept on the server before every restore; the last five can be downloaded or restored. The restore check shows the backup's figures next to the current ones. The Excel export adds the owner's work group, the activity check and a Group members sheet.
- Fix: lists of work groups, directions and members are sorted again (an aggregate query ignored the default order).

## 1.5.0 — 2026-11-15
- **Simplified Task Register v1.7.** The task form has the template's four steps and its columns only: task, direction, main workstream, sub-objective, owner role, partner groups 1 to 3 with their role, planned start and finish, readiness. Duration and activity counts are calculated.
- **Table A:** each partner row carries what we need, when, and their task number. **Table B:** an Enable or Support task records the group it helps, what it delivers, when, and their task number (one row per task). Both are saved with the task; the Links page lists them, with "agreed both sides" when the registers point to each other.
- Check rules and messages from the template (sheet 5), including link rows and activities; the Check page shows the template's summary counts, direction gaps, workstreams and sub-objectives.
- Master Plan: the schedule sits under the stats and opens in **full screen**; "waits for" comes from table A. Cost and milestones are gone.
- Removed: milestones, separate dependencies, and the task type, output type, target, guidelines, acceptance, oversight, responsible person, profile, capability, control, cost, effort, capacity and requirements fields, with their lists. Migrations 0002 to 0005 convert existing data (see README, Upgrading from 1.4).
- Backup format version 2; the Excel export follows the template's sheets.
- Fix: a team user's new task could not be marked Ready in the form (it still looked for the retired Group Lead role).

## 1.4.0 — 2026-11-14
- **Team visibility.** A `<CODE> Team` user sees only their own work group's register in full. Of other groups they see only the shared part: links on either side (dependencies, contributions, partnerships), and a short **shared view** of a linked task (identity, status, dates and the links with their group). Unlinked tasks of other groups are hidden. This is enforced by the API in `apps/register/visibility.py`.
- **Master Plan** is limited to Administrators, the TMO and the committee (Viewer): it is hidden from the menu, its route redirects, and the API answers 403 for teams.
- Teams add, edit and delete links only on their own tasks; links can point to another group's task, picked from a list of codes and titles (`/api/tasks/directory/`).
- The Links page shows both directions for the selected group (`?involves=`).
- Summaries, directions and task counts are limited to the team's own groups.
- A task that is not available to the user shows a clear message, without retrying.

## 1.3.1 — 2026-11-14
- Fix: Docker Compose now passes the database settings as separate variables (`DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`) instead of building a URL. Passwords with special characters (`@ : / # % ?`) previously broke the connection.
- New `wait_for_db` startup step: waits for PostgreSQL and, on `password authentication failed`, explains the cause (the database volume keeps its first password) and the fix.
- Azure: the same separate variables (`DB_SSLMODE=require`); `DATABASE_URL` still works.

## 1.3.0 — 2026-11-14
- **Backup & restore** (Administrators only): download a full backup (JSON, with a checksum), download an Excel copy (one sheet per table), and restore from a backup after a check and a typed confirmation. Downloads and restores are audited.
- Command-line `export_data` / `import_data` for scheduled backups (files or standard input/output).
- Adding a task is refused with 403 for users without a team role, before their data is checked.
- Azure guide: nightly backup job.

## 1.2.0
- One role per work group: **`<CODE> Team`** (for example ICT Team, HR Team), created, renamed and removed with the work group. A user may hold several. Replaces Group Lead and Group Editor (migrated automatically).

## 1.1.0
- Azure VM deployment with Azure Database for PostgreSQL (`docker-compose.azure.yml`, Caddy HTTPS).
- Group Editor merged into Group Lead.

## 1.0.0
- First release: registers per work group, links and dependencies, automatic check, Master Plan, configuration, roles, Docker and CI.
