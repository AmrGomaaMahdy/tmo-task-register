# Changelog

## 1.28.3 — 2026-11-23
- **Everything on one Azure VM**: new `docker-compose.azure-db.yml`, used together with `docker-compose.azure.yml`, runs PostgreSQL 16 as a container next to the application, reachable only inside the VM, its files in `PG_DATA_DIR` (a data disk, e.g. `/datadisk/postgres`).
- **`deploy/azure/backup-local-db.sh`**: nightly database dump plus the application export, 30 days kept on the VM, copied to an Azure Storage container with azcopy; stops before deleting old copies if a dump comes out empty.
- **Azure Portal guide, Part B**: the one-VM layout step by step: VM size, the data disk (format and mount), a storage account for off-VM backups, `.env`, start, backups and restore, updates, alerts and a go-live checklist.

## 1.28.2 — 2026-11-23
- **TMO Action Center text at the same size as the other pages.** Task titles, IDs, details, waiting days and approvers now use the type scale of the tables on Leader approvals and the Task Register (12.5px titles, 11.5px details, IDs in the usual blue mono without underline), with tighter cards, so more tasks fit on the screen.

## 1.28.1 — 2026-11-21
- **Azure VM deployment brought up to date** (`docker-compose.azure.yml`): every setting the application reads is passed through (`EMAIL_USE_SSL`, `EMAIL_TIMEOUT`, `DJANGO_HSTS_PRELOAD`, `REGISTER_DATE_MIN` / `MAX`, `SEED_DEMO_RESET`); `APP_PUBLIC_URL` defaults to `https://<APP_DOMAIN>`; Caddy starts once the frontend is healthy; comments on what System settings overrides and what the secret key protects.
- **`APP_STAGE`** in `.env` for builds on the VM; the GitHub images take the repository variable `APP_STAGE`. `off` (or empty) hides the *Under development* mark.
- **New guide: [docs/deploy-azure-portal.md](docs/deploy-azure-portal.md)**, the whole Azure setup step by step in the Azure Portal (network, PostgreSQL Flexible Server with private access, VM, DNS, SSH, Defender, budget, alerts). The CLI guide now points to *User access* and *System settings* instead of the Django admin.

## 1.28.0 — 2026-11-20
- **Management board** (was *Management report*; the old address still works): one page with **four reports** for the board, picked from cards at the top, each previewed as A4 pages and saved as PDF in one click, in English or Arabic:
  - **Board summary**: the two pages of 1.27.
  - **Master Plan timeline** (landscape): every task in the Master Plan by work group, with direction, dates, working days and a bar on a month scale, today marked, and coloured by finished / running / still to start.
  - **Work group scorecards**: one page per group, with its leader, figures, readiness, what it needs from other groups and what they need from it (agreed, waiting, rejected), the groups it works with, and its tasks with stage, check and finish date.
  - **Dependencies and decisions**: a matrix of who depends on whom (coloured by how far the links are agreed), the open links (rejected first, with the reviewer's note), and every decision of the last 30 days: leaders on tasks and links, the TMO including or sending back.
- **Board pack**: all four reports in one PDF, after a cover page with the contents.
- Every report follows the work group chosen in the side menu; each download is recorded in the audit trail with the report's name. New endpoint `GET /api/reports/dependencies/`.

## 1.27.0 — 2026-11-20
- **TMO Action Center** (new page for TMO Officers and administrators, with a count in the menu): every task its work group leader approved, the longest waiting first, with its plan dates, direction, partners, activities, who approved it and the days it has waited (amber from 7 days, red from 14). Filter by *Ready to include*, *To fix first* or *Waiting 7+ days*, or search; include a task, send it back with a reason, or tick several tasks whose check is OK and **include them at once**. Below, the TMO's decisions of the last 30 days (included, or sent back with the reason). `GET /api/tmo-desk/`.
- **Management report** (new page for administrators, the TMO and Global Viewers): the board summary on two A4 pages, with headline figures, readiness by stage, the Master Plan (planned progress, running now, plan window), links between groups, what needs attention, every work group (leader, stages, share approved, Not OK, progress) and what finishes in the next 30 days, with a line for the reviewer's signature. **Download PDF** saves it in one click, in English or Arabic as on screen; choosing a work group in the side menu gives that group's own summary. Each download is recorded in the audit trail. `GET /api/reports/board-summary/`.
- *Programme overview* is now **Overview**.
- The *Under development* mark is no longer on the sign-in page (it stays beside the page titles).
- The Master Plan's Gantt timeline no longer has its own full-screen button; the page's *Full screen* button above it shows the whole schedule. The Task Register's Gantt keeps its own.
- **Reference data**: each list now has one short line under its title; the full explanation moved to the (i) beside the title.
- Arabic for all of it, and the user guide covers the two new pages.

## 1.26.0 — 2026-11-20
- **Account menu in the page header.** The signed-in person's name (with initials) now sits at the top right, after *+ New task*. It opens a menu with the full name, email and roles, the four themes, *Change password* and *Sign out*; Esc or a click outside closes it. The bottom of the side menu no longer carries these, so the menu has more room for pages.
- **"Under development" mark**: an amber tag with a pulsing dot beside every page title and on the sign-in page, with a tooltip saying that features may change and the data may be sample data. It comes from `VITE_APP_STAGE` at build time (`APP_STAGE` in Docker Compose): empty hides it, another word (for example *Pilot*) replaces it.
- **Notifications stay until the work is done.** Confirmed in the browser and covered by a new test: opening an item from the bell and leaving without approving, rejecting or changing the status keeps it in the list (and in the count); it leaves the list only once the action is taken (by that person or anyone else who can take it). Opening the bell only clears the *New* marks.
- Arabic for the new texts; the user guide describes the account menu and the mark.

## 1.25.0 — 2026-11-20
- **System settings page** (administrators, *Administration › System settings*), every policy with its own on/off switch, saved at once and recorded in the audit trail:
  - **Outgoing email**: the SMTP server, port, security (STARTTLS / SSL / none), user, password (stored encrypted, never shown again) and sender, with a test message to any address. Off: the server's environment (`EMAIL_HOST` …) is used, if set.
  - **Email code at sign-in** (moved here from Configuration), with the code's validity.
  - **Password expiry** after 60, 90 or 180 days: when it is due, the application shows only a password form until a new one is chosen. The count starts when the rule is switched on, so nobody is asked at once; Microsoft sign-in accounts are not affected.
  - **Minimum password length** (8–16 characters; 12 by default). Common, all-digit and name-like passwords are refused in any case, and a new password must differ from the current one.
  - **Automatic sign-out** after inactivity (15 minutes to 8 hours) and a **maximum session length** (8 hours to 7 days), each switchable.
- **User access page** (*Administration › User access*), instead of the Django admin site: every account with its email, roles and status; search and filters (no email, locked, must change password, by role or work group); create an account (with a temporary password shown once, to be changed at the first sign-in); edit names and email; deactivate; give or remove the programme roles (Admin, TMO Officer, Global Viewer) and one role per work group (Leader, Focal Point, Member), kept in step with the group's member list and leader; reset a password; unlock an account locked by failed sign-ins (from every address). An administrator cannot remove their own Admin role or deactivate themselves, and one active administrator always remains.
- **Clearer page names**, and an *Administration* part in the menu: Overview → **Programme overview**, Activities → **Task activities**, Data Quality → **Data quality check**, Governance → **Leader approvals**, Configuration → **Reference data** (at `/reference-data`; the old address still works), System issues → **System errors & alerts**. The user guide follows (and covers the new pages).

## 1.24.0 — 2026-11-20
- **Email code at sign-in (multi-factor), off by default.** An administrator switches it on in **Configuration › Sign-in security** (with the code's validity, 5–30 minutes, and a test email). After the password, a 6-digit code in English and Arabic goes to the person's email; the sign-in page asks for it, submits it as soon as six digits are in, and can send a new one after 30 seconds. Codes are kept only as a keyed hash, work once, expire, and 5 wrong ones end the attempt (counting towards the lockout). The page refuses to switch it on without outgoing email and names the accounts without an address. `manage.py signin_code off` turns it off from the server. New settings: `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS`, `DEFAULT_FROM_EMAIL`, `APP_PUBLIC_URL`.
- **Delegates for absent leaders.** On the Governance desk a leader (or an administrator) names a person of the group, for up to 90 days. While it runs, the delegate gets the group's approvals in the bell and on the Governance desk, with a banner naming whom they stand in for, and approves or rejects in the leader's place; they read the group's register but do not edit it. One delegation at a time per group; the leader can cancel it at once; the delegate is told by email; the audit trail records it.
- **User guide** in English and Arabic at `/guide`, for everyone (even before signing in): getting started, roles, the way of a task, a part for Focal Points, Team Leaders and the TMO, the pages, notifications, and questions. Searchable, with role shortcuts, a contents list that follows the reading, a phone layout and a clean print (or PDF). Linked from the page header and the sign-in page.
- A group member's email (Configuration › Group members) now becomes the email of their account.

## 1.23.0 — 2026-11-20
- **Full screen for the Gantt timelines:** the Task Register's *Gantt timeline* (and the Master Plan's, which uses the same view) opens full screen with its grouping and stage colours; Esc or *Exit full screen* goes back.
- The **Full screen** button now sits on the same line as the status colours, at the end of the tools, on the Gantt timelines and on the *Activity timeline*, in English and Arabic.

## 1.22.0 — 2026-11-20
- **Leaders approve or reject, nothing else.** The *Remove* button is gone from the Governance desk and the task page: a leader decides on a link from another group (Direct, Enable or Support task) by approving it or rejecting it with a reason, and the other group changes its own task. The `POST …/remove/` API is withdrawn.
- **Links with other groups: the orbit diagram is back**, made clearer: the busiest groups sit at the top; each circle carries its total and a ring split amber (we need from them) / blue (we deliver to them); under each code, ↓ and ↑ give the two numbers; a line above the diagram names the group you point at with its numbers; two headline figures (needed from / delivered to other groups); a legend with the arrow styles. The diagram and the *Links by group* chart sit side by side again. Full screen keeps the card of the picked group (no "Pick a group" prompt).
- **Notification bell:** a round blue medallion with a filled bell and ringing waves while work waits (plain when nothing does); the count is a standard red badge, larger, bold and ringed so it reads on any theme; the bell swings and the badge pulses when something new arrives.

## 1.21.0 — 2026-11-20
- **Action centre (notifications).** A bell in the page header shows how many things wait for the signed-in person; its panel lists them, most urgent first, grouped as *Sent back to you*, *Waiting for your decision* and *To complete*, each with the task, who acted, when, and the reason when work was returned. People with several roles can filter by role (Focal Point, Leader, TMO).
  - **Focal Point:** tasks rejected by the leader or sent back by the TMO (with the reason), links the other group's leader rejected, other tasks in Needs completion.
  - **Team Leader:** the group's tasks Ready to include (approve or reject), links other groups record with the group waiting for review.
  - **TMO Officer:** Leader Approved tasks (include in the Master Plan or send back).
  - Clicking an item opens the task (or the Governance row for a link) with a hint saying what to do there and the place to act highlighted; if someone already did it, the page says so.
  - Items are worked out from the register, so they leave the list by themselves once done. Items that arrived since the list was last opened are marked **New**; the bell rings once for them, a short note appears when new work arrives while the app is open, and the browser tab shows the count. Refreshed every minute, on returning to the window and after every change.
  - New API `GET /api/notifications/` and `POST /api/notifications/seen/`; new table `register_notificationstate` (migration 0013). English and Arabic, right-to-left, phone layout, keyboard (arrows, Esc) and reduced motion supported.

## 1.20.0 — 2026-11-20
- **Leader decisions are Approve or Reject only**, on the group's own tasks and on the links other groups record with it. *Ask to clarify* and *Change the timeline* are gone; the reason is optional for both (still required to remove a link). Older clarification and timeline decisions stay visible and can be decided again; the Governance filter shows them only while some remain.
- **Status workflow on every task:** the task page and the edit form show the readiness flow as an animated stepper — Prepared (Draft / Needs completion) → Ready to include → Leader Approved → In Master Plan — with who took each step, their role and when; the current step pulses, and a task sent back shows who returned it and why. The task page adds the full history of steps with every decision's reason. New API `GET /api/tasks/{id}/workflow/`, built from the audit trail and completed from the task's fields for data loaded before it. Reduced motion, Arabic and right-to-left supported.
- Demo data: old sample decisions are mapped (questions → waiting, new dates → approved with their note).

## 1.19.0 — 2026-11-19
- **New readiness flow:** Draft / Needs completion (the Focal Point prepares) → **Ready to include** (submitted to the leader) → **Leader Approved** (new status, for the TMO) → **In Master Plan**.
  - The **Team Leader** decides on every task of the group once it is Ready to include, whatever its type: approve → *Leader Approved*; reject or ask to clarify → *Needs completion*, with the note. The leader's desk (Governance › *Our tasks to approve*) lists only tasks that are Ready to include.
  - The **TMO** decides on Leader Approved tasks (Master Plan › *TMO decisions*): include → *In Master Plan*, or **send back** → *Needs completion* with a required reason. A task in the plan can also be sent back, with a reason. The reason shows on the task and in its check.
  - The **Focal Point** edits and deletes tasks (and their activities, partners and contributions) only while they are **Draft** or **Needs completion**; it can withdraw a task to Draft until the leader decides. Submitting again resets the leader's decision.
- **"Coordinator" is now "Focal Point"** everywhere: the role *`<CODE>` Team Focal Point* (renamed, users kept), the member type, Entra ID `TaskRegister.FocalPoint.<CODE>` (old names still work), Arabic *نقطة الاتصال*.
- **Overview:** new charts (tasks by readiness, check results, tasks by work group or by type, planned finishes per month); paging for *Coverage by direction* and *Coming up*; *Recent changes* removed (it remains in the audit trail).
- **Task Register:** the *Table* view is named **List**. A task's page and its edit form have **Back to Task Register**, returning to the list as it was left.
- **Deleting a task** says how many activities are deleted with it and takes an optional reason, kept in the audit trail.
- **Activities:** the *Activity timeline* comes right after the figures and opens **full screen**; *Workload by owner* pages its rows; new charts: activities by status, and activities by work group (or by task).
- **Links with other groups:** the diagram is now a standard **flow (Sankey) diagram**, full width: partners on the left, the group in the middle, receivers on the right, ribbons as thick as their rows. Picking a group enlarges and highlights it with its numbers. Full screen shows only the diagram.
- **Check** is renamed **Data Quality**, comes right after Activities in the menu, and every section pages its rows (old links to `/check` still work; `/data-quality` too).
- Confirmation dialogs can ask for a reason (required for the TMO's send back, optional for deleting).
- Migrations `accounts 0004`, `masterdata 0009`, `register 0012`; backup format 9 (older backups restore into the new flow). Demo data covers every stage.

## 1.18.2 — 2026-11-18
- **Fix: sign-in behind Render's forwarding could still fail with *Unexpected token '<'*.** Under `/api/`, every error is now JSON with its reason, never one of Django's HTML pages: a refused security check (CSRF), an address not in `DJANGO_ALLOWED_HOSTS`, an unknown address and a server error. The sign-in page shows the reason and the setting to change, for example *"The address in the browser (https://task-register-elty.onrender.com) is not in DJANGO_CSRF_TRUSTED_ORIGINS of the API"*. Refused checks are written to the security log with the browser's address.
- The web app retries only when the API cannot be reached (502/503/504, no connection, or a "loading" page); any other web page shows its HTTP status instead of a parse error.
- Render guide: the causes of this message and where to fix each.

## 1.18.1 — 2026-11-18
- **Fix: sign-in on Render showed *Unexpected token '<', "<!DOCTYPE"… is not valid JSON*.** When the free API is asleep, Render answers with its own HTML page while the API starts. The app now recognises such a page. Reads and the sign-in steps wait and try again for up to 90 seconds; the sign-in button shows *Starting the server…* with a short note, and signs in on its own once the API is up. If the API still does not answer, a plain message says so. Changes (saves, deletes) are never sent twice.
- Render guide: troubleshooting for this message (sleeping API, a different API address, an API that failed to start).

## 1.18.0 — 2026-11-18
- **A richer demo for the board:** the sample now has **55 tasks in all 13 work groups** (was 20, mostly ICT) and **149 activities**, from the new file `backend/apps/register/fixtures/demo_more.json`.
- **Governance in action:**
  - *Other groups asking ICT:* HR, Finance, Construction, Engineering and Others have tasks that need something from ICT. Eight wait for the ICT Team Leader's decision (`shadi.alghanim`), while others show an approval, a request for clarification, a proposed new date and a rejection with its reason.
  - *ICT asking others:* ICT tasks that need HR, Finance, Supply Chain, Equipment, Support Services or Project Management wait for those leaders, or carry their answer (for example Finance rejects the disaster-recovery budget for 2027; HR proposes a new date for awareness training).
  - *Between other groups:* Project Management, Construction, Finance, Equipment, Production, Supply Chain, Support Services and Bidding & Commercial also link with each other.
  - *Direct tasks:* every approval state: approved, waiting, asked to clarify (PM-T006) and rejected (SS-T011). Each decision names the leader of the group that made it.
- Tasks the ICT register already pointed to (CM-T005, CM-T011, ENG-T007, FIN-T002, FIN-T009, SCM-T003, SCM-T006, SS-T004, SS-T009) now exist, so those links are agreed in both registers.
- Every Ready or Master Plan task in the sample passes the automatic check; a few drafts and tasks that need completion keep their issues, so the Check page has something to show.
- `seed_demo --core-only` loads only the first 20 tasks (used by the tests). New tests cover the whole sample.
- To see it on an existing demo: `python manage.py seed_demo --reset` (on Render: set `SEED_DEMO_RESET=true` for one deploy).
- No database change.

## 1.17.0 — 2026-11-18
- **Links between work groups, redesigned:** circles sized by their number of links, curved arcs that flow, a glowing centre. **Clicking a group enlarges and highlights it** (gold, with a pulsing ring), shows the number of rows on each of its arcs, and fades the others; the tables below follow the pick. Hovering previews the same highlight.
- **Full screen** for the diagram (button above it, Esc to leave), with a card for the picked group (what we need, what we deliver, all links, *Show the rows*) or, with no pick, the groups with the most links.
- **Configuration, every list:** paging (10, 20 or 50 rows), and search across each list's main fields (work groups: code, name, mission, leader; directions: ID, group, title, meaning; members: name, group, type, account, job title, email, phone; lists: value, definition, group). All words typed must match.
- **Add and edit in a dialog** for work groups (code, name, weight, mission, leader), directions, members and every list value. After saving, the table refreshes at once, jumps to the saved row and highlights it.
- **Confirmation before anything that cannot be undone or that others will see**, in one dialog that names what is affected: every delete (tasks, activities, work groups, directions, members, list values), removing a task or a link, rejecting, releasing a task from the Master Plan, sending a task back to draft, going back to a restore point, resolving all issues. **Cancel with unsaved changes** (task form, activity, configuration dialogs) asks before discarding.
- **Sign-in page:** the work groups circling the sign-in card on two slow orbits, a light travelling around the card, *Show password* and a Caps Lock warning. Built so that it draws faster than before (no blur filters while things move; the moving dots are left to the graphics card), and it stands still for people who prefer reduced motion.
- Arabic for all the new text, and for the work-group names of the initial data.
- No database change.

## 1.16.0 — 2026-11-18
- **Initial data of the organisation**, loaded on start (`load_initial_data`, file `backend/apps/masterdata/initial_data/initial_data.json`):
  - the 13 work groups with the names, **mission** and **weight** from *Directions from Leadership – Group-Wise*, and their **103 directions** with what each means;
  - **78 sub-objectives**, each assigned to its work group as in *13 Groups Subobjectives* (Bidding & Commercial has none);
  - **75 group members (69 people)** from *Task Register Group Focal Points* (sheet *Final*), each a **Leader**, **Coordinator** or **Member** as noted in front of the name (no note: Member), and **one sign-in account per person** with the matching role in each of their groups.
- **Roles renamed and extended** (users keep their roles): *Administrator* → **Admin**, *Viewer* → **Global Viewer**, *`<CODE>` Team* → **`<CODE>` Team Coordinator** (adds, edits and removes the group's tasks), *`<CODE>` Group Leader* → **`<CODE>` Team Leader** (full control of the group, including governance: approve, reject, clarification, timeline, remove). New **`<CODE>` Team Member**: reads the group's whole register, changes nothing. All three are created, renamed and removed with the work group.
- **Group members:** new *Type* (Leader, Coordinator, Member) and *Account* columns, a type filter, and the type in the member dialog. The type sets the account's role; one Leader per group, kept in step with the leader in Configuration › Work groups and with the role in the admin site. A Team Leader may edit the contact details of the group's members.
- **Sub-objectives belong to a work group:** the task form offers only the task's own group's; another group's is refused on save. Configuration › Sub-objectives shows and filters by group.
- **Work groups:** mission and weight (%) shown and editable in Configuration.
- **Change password** in the menu, for every user.
- Entra ID: `TaskRegister.Coordinator.<CODE>` and `TaskRegister.Member.<CODE>` (the older `TaskRegister.Team.<CODE>` still gives the Coordinator role).
- Settings `LOAD_INITIAL_DATA` (default true), `INITIAL_USER_PASSWORD`; on Render `SEED_DEMO_RESET=true` reloads everything once. The demo now uses the real groups and people; demo users: `admin`, `tmo.officer`, `committee.viewer`, `ict.team`, `hr.team`, `fin.team` (Coordinators) and `hr.member` (HR Team Member).
- Migrations `accounts 0003` (role renames) and `masterdata 0008`. Backup format version 8; older backups restore with their roles renamed. The Excel export adds the mission, weight, member type and account.

## 1.15.0 — 2026-11-18
- **Group Leader role:** every work group now has its own role, `<CODE> Group Leader` (for example *HR Group Leader*, *FIN Group Leader*), created, renamed and removed with the group like the team role. Give it in the Django admin site like any role, through Microsoft Entra ID (`TaskRegister.Leader.<CODE>`), or by picking the leader in Configuration › Work groups; the two always agree, and each group has one leader (giving the role to someone else moves it).
- A Group Leader does everything the group's team does, plus governance:
  - the group's **own Direct tasks**: approve, reject, ask to clarify, or remove them;
  - **other groups' Direct and Enable / Support tasks that involve the group** (their partner rows naming it, their contributions to it): approve, reject, ask to clarify, change the timeline, or **remove** the link from their task.
- **Remove:** takes the link out of the other group's task, with a required reason; not for tasks already in the Master Plan (the TMO releases them first). The removal is in the audit trail, and the other group sees it, with the reason, in its recent changes.
- Governance page: the second tab is now *Other groups' tasks with us*, shows each task's type (Direct, Enable, Support) and filters by it. The Remove button is also on the task page next to the leader's decisions.
- Team members now also see audit entries about their own work groups' tasks (for example a removal by another group's leader), not only their own actions.
- Migrations `masterdata 0007` (creates the leader roles and gives each one to the group's current leader) and `core 0005`. Backup format version 7; older backups restore and get their leader roles.

## 1.14.1 — 2026-11-18
- **Fix: work group list in the side menu.** The selector had a see-through background, so on some systems (notably Chrome on Windows) the opened list showed white names on a white background. It now has a solid background, and the list shows dark text on white with the current group highlighted, in every theme (contrast 10:1 or better).

## 1.14.0 — 2026-11-18
- **Task description:** an optional description next to the task name (scope, expected result, what partner groups or the TMO should know; up to 3,000 characters, line breaks kept). It shows under the title on the task page, on a line in the Task Register (full text on hover), in the shared view of partner groups, in search, and in the Excel export. Changing it sends an approved Direct task back to its leader, like the other task fields.
- **Group member details:** job title, email and phone (all optional) in Configuration › Group members, edited in a dialog with checks: a complete email address, used by one member only, and a phone number written with digits. Email and phone are links in the list; the job title appears next to the name when choosing an activity owner. Excel export includes them.
- **Audit trail page** (Administrators, the TMO and the committee): everything that happened, with who, when, which record and work group, from which address and browser, and **the values before and after** for every changed field (tasks with their partner rows and contributions, activities, configuration, leader decisions and link reviews, readiness changes). Failed sign-ins and changes made in the Django admin site are included. Filter by user, action, record type, work group, dates and free text (searching the changed values too), open an entry for its details, and download the filtered trail as CSV (formula-safe).
- **System issues page** (Administrators): server errors with their traceback, errors in users' browsers (a page that failed to draw, a script error), and security warnings (failed sign-ins, lockouts, refused requests, rate limits, CSRF failures). The same problem is counted on one row; each row shows when it was first and last seen, the request, user, address and browser. Mark issues resolved with a note, reopen them, or resolve all shown. The menu shows the number of open errors. Events are kept for 90 days (`SYSTEM_EVENT_RETENTION_DAYS`).
- **A page that fails no longer goes blank:** it shows a message with *Reload the page* and *Go to the overview*, and the error reaches the System issues page.
- Dialogs open above the sticky page header.
- Migrations `core 0004` (audit details, system events; existing entries keep their author's user name), `masterdata 0006`, `register 0011`. Backup format version 6 (versions 2 to 5 still restore). The Excel export adds an *Audit trail* sheet (latest 5,000 entries).

## 1.13.0 — 2026-11-18
**Security (OWASP Top 10)** — see SECURITY.md for every control by category.
- **Account lockout** after 5 failed sign-ins (per user name and client; 20 from anywhere), for 15 minutes, also on the Django admin sign-in. Same answer for unknown user names. Settings `LOGIN_LOCKOUT_ATTEMPTS`, `LOGIN_LOCKOUT_MINUTES`.
- **Session limits:** ends after 60 idle minutes and at the latest 10 hours after sign-in (`SESSION_IDLE_MINUTES`, `SESSION_ABSOLUTE_HOURS`); the app returns to sign-in with a notice. On HTTPS the cookies are `__Host-sessionid` / `__Host-csrftoken`.
- **Passwords** need at least 12 characters (was 10). Existing passwords keep working.
- **Security log** (`security` logger): sign-ins, failures, lockouts, sign-outs, ended sessions, refused requests, rate limits, backups and restores, with user and client address, never secrets. Sign-outs are also in the audit log.
- **Headers:** API answers carry `Cache-Control: no-store`, a deny-all Content-Security-Policy, `Permissions-Policy` and `Cross-Origin-Resource-Policy`. The Render static site now sends the same strict CSP and security headers as the Docker nginx; the Render API redirects to HTTPS with HSTS.
- **Excel export:** text that starts with `=`, `+`, `-` or `@` is written as text, never as a formula (formula injection).
- **API description** (`/api/docs/`, `/api/schema/`) for Administrators only; `API_DOCS_ENABLED=false` removes it.
- Restore accepts `.json` files only. Rate limits and lockouts count real clients behind proxies (`DJANGO_NUM_PROXIES`: 1 for Docker, 2 for Azure with Caddy). Rate-limit and lockout counters live in a shared database cache table (migration `core 0003`).
- **Dependencies:** React Router 7, Vite 7; CI job *Dependencies* runs `pip-audit` and `npm audit` on every push. No known vulnerability in shipped packages.

**Look and feel**
- New palette aligned with the Al-Ayuni logo blue, with survey gold for what is current. The side menu is a drafting sheet with a fine grid and a gold line on the current page. Dark, Desert gold and Aurora night themes are kept.
- The intended fonts are now bundled (Archivo for titles and figures, IBM Plex Sans for text, IBM Plex Mono for codes); before, English fell back to system fonts.
- Sticky page header with one line saying what each page is for; sentence-case labels; calmer panels, tables with row highlight, clearer focus rings on fields.
- **Confirmations:** a short toast after each change (*Task saved.*, *Decision recorded.*, *Changes saved.*, *Removed.*).
- No dead ends: a page the user cannot use explains why and offers the way back (for example *Back to ICT-T030*); a friendlier page-not-found.
- Task Register table fits without cutting the Readiness and Check columns: partner codes wrap and planned dates stack.
- Faster first load: pages load when first opened (the main bundle is 18% smaller). A *Skip to content* link for keyboard users.

## 1.12.0 — 2026-11-18
**Data validation**: the API refuses data that breaks these rules, and the forms show the problem next to the field before saving (in English and Arabic).
- **Task dates:** the planned finish is on or after the planned start (the same day is fine). Both dates fall in the register's range, 2024-01-01 to 2035-12-31 by default (`REGISTER_DATE_MIN` / `REGISTER_DATE_MAX`), which catches typing slips like 0207 for 2027.
- **Task dates hold their activities:** when a task's dates change, every activity must still fit inside them; the message names the activities that would fall outside. A task with activities cannot lose its planned dates.
- **Activity dates:** the finish is on or after the start; the start is on or after the task's planned start and the finish on or before the task's planned finish; an activity starts after its predecessors finish, and an activity cannot be moved to finish on or after the start of an activity that follows it. A task without planned dates gets no activities until its dates are set. Partial edits are checked against the saved values.
- **Text fields:** the task title and the activity name are trimmed and need at least 3 characters with words (not just spaces, digits or dashes).
- **Links:** their task numbers must be written like `HR-T012`; a contribution goes to another work group; a group or member that was made inactive cannot be newly picked (rows already pointing to it keep working).
- **Proposed dates** in a leader's *Change timeline* decision fall in the same range.
- The date pickers only offer allowed dates (the task's dates in the activity form; the start before the finish). The task form's live check shows the date rules as errors and Save goes to the step with the problem.
- `/api/auth/me/` returns `date_range`. Error messages from the API now read as sentences instead of starting with the field's code.

## 1.11.0 — 2026-11-18
Governance by **work group leaders**, a Gantt view of the register, and up to twenty partners and contributions per task.
- **Work group leader (new role):** each work group has one leader (Configuration › Work groups › *Leader*, picked from active users) and one or more team members. The leader is also a member of the group's team and shows as *`<CODE>` Leader* in the user's roles. Migration `masterdata 0005` adds `WorkGroup.leader`.
- **Leader approval of Direct tasks:** every Direct task carries the leader's decision: *Waiting for review*, *Approved*, *Needs clarification* or *Rejected*, with a note, who decided and when. A Direct task cannot go into the Master Plan until its leader approves it. When a team member changes what was approved (title, direction, workstream, sub-objective, owner role, dates), the approval goes back to *Waiting for review*. The leader can also remove a task that is not valid.
- **Leader review of dependencies:** the leader sees every link other groups record with the group, partner rows that name it (*they need from us*) and contributions to it (*they deliver to us*), and answers each with *Approve*, *Reject*, *Needs clarification* or *Change timeline* (with a proposed date). The other group sees the answer on its task, on the Links page and in its check: a rejection is an error, a question or a new date a warning. A row that is saved unchanged keeps its review; a changed row is reviewed again.
- **Governance page:** the leader's desk, with two tabs: *Direct tasks* and *Dependencies from other groups*, each with the number waiting and a filter by decision. The menu item shows the count waiting for the leader. The TMO, administrators and the committee see every group's decisions, read-only.
- **Register: Table or Gantt timeline.** The Register page has two tabs: the table as before, and a Gantt timeline of the same tasks (the same filters apply), grouped by direction, workstream, lifecycle stage or work group. The tab is kept in the address (`?view=gantt`).
- **Up to twenty** partner groups and twenty contributions per task (was five), in the form, the API and the check.
- API: `GET /api/tasks/governance/?work_group=`, `POST /api/tasks/{id}/approval/`, `POST /api/partners/{id}/review/`, `POST /api/contributions/{id}/review/`, `GET /api/tasks/timeline/`, `GET /api/work-groups/leader-candidates/`. Migration `register 0010` adds the decision fields.
- **Backup:** format version 5 (with leaders and decisions); versions 2 to 4 still restore. The Excel export adds the leader's approval and the review of each partner row and contribution.
- Trial users `ict.leader`, `hr.leader` and `fin.leader`; the sample data carries approved tasks and links, one question and one proposed new date.

## 1.10.0 — 2026-11-16
- **Links page charts:** *Links between work groups*, a diagram with the selected group (or ALL) in the centre, amber arrows for what our tasks need from each group and teal arrows for what we deliver to it (arrow width = number of rows); click a group to filter both tables to it. *Links by group* counts the same links per group as bars; click a bar to see its tasks. The summary API returns them as `links_by_group`, with drill sets `need_from:<code>` and `deliver_to:<code>`.
- **Master Plan Gantt grouped your way:** group the timeline by **Direction**, **Workstream**, **Lifecycle** stage or **Work group**, and show all tasks or only those in the Master Plan. Bars are coloured by lifecycle stage, with a legend; the choice is remembered per browser. The master-plan API accepts `?all=1` and returns each task's direction title and workstream.
- **Sign-in page:** renamed *TMO Task Register*, with a moving background (soft lights and a faint grid), the Al-Ayuni logo, what the register is for, the road to 2027, and a glass sign-in card. Works in Arabic and on phones.
- **No version numbers on the pages:** the side menu shows *TMO Task Register* instead of a version badge. The browser tab reads *TMO Task Register*.
- **Smoother pages:** pages fade in; data stays fresh for 30 seconds so going back shows it at once; loading places keep the page's shape.
- **A calmer task form (new and edit):** a progress bar over the steps; each step slides in and starts at the top; the steps and the live check stay in view while a long step scrolls; the Cancel / Back / Next / Save bar stays at the bottom of the screen; larger inputs with a clear focus ring; partner and contribution rows ease in; the live check shows when it is checking, with each problem's label above its message; an *Unsaved changes* marker, a warning before leaving with unsaved changes, and **Ctrl + S** to save from any step.

## 1.9.1 — 2026-11-16
- **Render Blueprint:** `render.yaml` creates a free Postgres database, the Django API (native Python runtime) and the React static site in one step, without Docker. The static site forwards `/api`, `/admin` and `/static` to the API, so sign-in cookies and the CSRF check work as on one address. Guide in `docs/render.md`.
- Settings: on Render the API's public host name (`RENDER_EXTERNAL_HOSTNAME`) is added to the allowed hosts automatically.

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
