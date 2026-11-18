# Security

## Reporting a problem
Please do not open a public issue. Email the repository owner with the details and the steps to reproduce.

## Controls by OWASP Top 10 (2021) category

Each control names the file where it lives, so it can be reviewed and tested. Security comments in the
code use the same category names (for example `OWASP A07`).

### A01 Broken Access Control
- Every API endpoint requires a signed-in user (`DEFAULT_PERMISSION_CLASSES`); anything else is opt-in.
- Role and work-group rules live in one module, `backend/apps/accounts/roles.py`, and are applied to every write, including object-level checks: team roles (one per work group), work group leaders, task status and the Master Plan lock.
- Row-level visibility: a team reads only its own register in full, and of other work groups only the records shared with it (`backend/apps/register/visibility.py`). Records outside a user's view answer 404, so their existence is not revealed.
- The Master Plan is limited to Admins, the TMO and Global Viewers; changes to a group's tasks to its *Team Coordinator* and *Team Leader* (a *Team Member* only reads them); leader decisions (including removing a link from another group's task) to the holder of the group's *Team Leader* role; backups and the API description (`/api/docs/`) to Administrators. `API_DOCS_ENABLED=false` removes the API description entirely.
- The web app hides controls the user cannot use, but the API always decides.

### A02 Cryptographic Failures
- Passwords hashed with Argon2id; older PBKDF2 hashes are upgraded at the next sign-in. Backups contain hashes only, never passwords.
- In production: HTTPS redirect, HSTS (optionally with preload, `DJANGO_HSTS_PRELOAD`), `Secure` cookies.
- On HTTPS the cookies are named `__Host-sessionid` and `__Host-csrftoken`: browsers then accept them only when `Secure`, for the whole site and without a `Domain`, so a neighbouring sub-domain cannot plant or overwrite them.
- Database connections can require TLS (`DB_SSLMODE=require`).

### A03 Injection
- All database access goes through the Django ORM (parameterised queries); there is no raw SQL built from input.
- React escapes everything it renders; the app uses no `dangerouslySetInnerHTML`, `eval` or inline scripts, and the Content-Security-Policy forbids inline scripts.
- **Excel export:** text typed by users (task names, notes) that starts with `=`, `+`, `-` or `@` is written as a text cell, never a formula, so opening the export cannot run a formula (`backend/apps/backup/excel.py`).
- Security log lines are built from single tokens, so a crafted user name cannot forge log entries (`backend/apps/core/security.py`).

### A04 Insecure Design
- Data validation on save: dates inside the register's range, finish on or after start, activities inside their task's dates and after their predecessors, task numbers in the `HR-T012` form (`backend/apps/register/validation.py`).
- Request size limits: 2 MB for ordinary requests (Django and nginx); only the restore upload accepts up to 50 MB, and only a `.json` file.
- A restore needs a dry run first and the typed word `RESTORE`; a restore point of the current data is kept automatically, and the restore is atomic.
- Rate limits: 60 requests a minute for anonymous clients, 10 sign-in attempts a minute per client, 1,200 requests a minute per user.

### A05 Security Misconfiguration
- `DEBUG` is off by default and `DJANGO_SECRET_KEY` is required whenever it is off. CI runs `manage.py check --deploy`.
- Response headers on every API answer (`backend/apps/core/middleware.py`): `Content-Security-Policy: default-src 'none'`, `Cache-Control: no-store` (register data and user details are not kept in browser or proxy caches), `Permissions-Policy`, `Cross-Origin-Resource-Policy`, plus Django's `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy` and `Cross-Origin-Opener-Policy`.
- The web app is served with a strict Content-Security-Policy (`default-src 'self'`, no inline scripts, `frame-ancestors 'none'`), by nginx in Docker (`frontend/docker/security-headers.conf`) and by the static site on Render (`render.yaml`). Fonts are self-hosted, so no third-party origin is needed.
- nginx hides its version; containers run as non-root with read-only file systems and no Linux capabilities.
- The trial-user hint on the sign-in page shows only in development builds.

### A06 Vulnerable and Outdated Components
- Python dependencies pinned in `requirements.txt`; npm dependencies locked in `package-lock.json`.
- CI job *Dependencies* runs `pip-audit --strict` and `npm audit --omit=dev` and fails the build on a known vulnerability. Dependabot proposes updates every week.
- Known, accepted: `picomatch` (a build-time dependency of Vite and the linter) has a ReDoS advisory without a fixed release. It only matches the project's own file patterns at build time and is never part of the shipped app.

### A07 Identification and Authentication Failures
- **Account lockout:** 5 failed sign-ins (`LOGIN_LOCKOUT_ATTEMPTS`) from one client lock that user name there for 15 minutes (`LOGIN_LOCKOUT_MINUTES`); 20 failures from anywhere lock the user name everywhere. The lock applies to the Django admin sign-in too, and to unknown user names alike, so it reveals nothing about which accounts exist (`backend/apps/accounts/lockout.py`). The counters live in a database cache table shared by all server workers.
- A failed sign-in shows the same message whatever went wrong, and the form clears the password.
- Passwords: at least 12 characters, not common, not all digits, not similar to the user name.
- Sessions: server-side, in an `HttpOnly`, `SameSite=Lax` cookie, never in browser storage. The session key changes at sign-in (no session fixation). A session ends after 60 idle minutes (`SESSION_IDLE_MINUTES`), at the latest 10 hours after sign-in (`SESSION_ABSOLUTE_HOURS`), and when the browser closes; the web app then returns to the sign-in page with a notice.
- CSRF protection on every state-changing request, including sign-out.
- Optional Microsoft Entra ID sign-in (OpenID Connect), with roles from Entra app roles and the organisation's MFA policies.

### A08 Software and Data Integrity Failures
- Backups are parsed as data (JSON, no code). A checksum detects edited or damaged files, only known tables are accepted, and a backup without an active administrator is refused.
- CI builds the images from the locked dependency files; GitHub Actions run with read-only repository permissions.

### A09 Security Logging and Monitoring Failures
- The `security` logger writes one key=value line per event: `login`, `login_failed`, `account_locked`, `login_refused_locked`, `logout`, `session_expired`, `permission_denied`, `throttled`, `backup_export`, `excel_export`, `backup_restore`, with user, client address, method and path. Passwords, session keys and tokens are never logged.
- **Change password** (menu): asks for the current password, applies the password rules, keeps the session signed in, is rate-limited like sign-in, and is recorded in the audit trail and the security log. Accounts created from the member list have no usable password unless `INITIAL_USER_PASSWORD` (or, on a demo, `DEMO_USER_PASSWORD`) is set.
- The **audit trail** records every create, update, delete, status change, decision, sign-in, sign-out, failed sign-in and Django admin change, with the field values before and after, the user, address, browser and request. Admins, the TMO and the committee read it in full (filters, CSV export); other users see only their own actions.
- The **System issues** page (Admins only) stores server errors with tracebacks, errors in users' browsers, and security warnings, grouped by problem, with resolve / reopen. Kept for `SYSTEM_EVENT_RETENTION_DAYS` (90). Browser reports need a signed-in user and are limited to 30 an hour each; their text is stored and shown as text, never run.
- Behind a reverse proxy set `DJANGO_NUM_PROXIES` (1 for the Docker nginx, 2 with Caddy in front) so logs, rate limits and lockouts see the real client address.

### A10 Server-Side Request Forgery
- The server never fetches a URL supplied by a user. Its only outbound calls are to the fixed Microsoft Entra ID endpoints when OIDC sign-in is enabled.

## Before going live
- [ ] `SEED_DEMO=false`, and trial users removed
- [ ] Unique `DJANGO_SECRET_KEY` and database password, kept in a secret store
- [ ] HTTPS settings on: `DJANGO_SECURE_COOKIES`, `DJANGO_SECURE_SSL_REDIRECT`, `DJANGO_HSTS_SECONDS`
- [ ] Real `DJANGO_ALLOWED_HOSTS` and `DJANGO_CSRF_TRUSTED_ORIGINS`
- [ ] `DJANGO_NUM_PROXIES` matches the proxies in front of the API
- [ ] Security log lines collected by the monitoring tool, with an alert on `account_locked` and repeated `permission_denied`
- [ ] Consider `API_DOCS_ENABLED=false` if the API description is not needed
- [ ] Database backups set up and tested; application backups stored in an access-controlled location
