# Security

## Reporting a problem
Please do not open a public issue. Email the repository owner with the details and the steps to reproduce.

## Controls in this application

**Authentication and sessions**
- Server-side Django sessions in an `HttpOnly`, `SameSite=Lax` cookie, set `Secure` in production (`DJANGO_SECURE_COOKIES=true`). No tokens are kept in browser storage.
- CSRF protection on every state-changing request: the web app sends the `csrftoken` cookie value back in `X-CSRFToken`.
- Passwords are hashed with Argon2. Validators require at least 10 characters, block common passwords, and block passwords similar to the user name.
- Sign-in is limited to 10 attempts per minute per client, and a failed sign-in shows the same message whatever went wrong.
- Optional Microsoft Entra ID sign-in (OpenID Connect) with roles taken from Entra app roles.

**Authorisation**
- Every API endpoint requires a signed-in user.
- Role and work-group rules live in one module (`backend/apps/accounts/roles.py`) and are applied to every write, including object-level checks: the user's team roles (one per work group), task status and the Master Plan lock.
- Row-level visibility: a team reads only its own register in full, and of other work groups only the records shared with it (`backend/apps/register/visibility.py`). The Master Plan is limited to Administrators, the TMO and Viewers.
- The web app hides controls the user cannot use, but the API always decides.

**Data integrity and audit**
- Foreign keys use `PROTECT`, so a value in use cannot be deleted. The API answers 409 Conflict with the number of records that use it.
- Every create, update, delete, status change and sign-in is written to an audit log, which only Administrators and the TMO can read in full.

**Backups**
- Only Administrators can download a backup or restore one; each action is audited.
- Backups hold password hashes, never passwords. A checksum detects edited or damaged files, only known tables are accepted, and a backup without an active administrator is refused.
- A restore is atomic: it is applied in full or not at all.

**Transport and headers**
- In production: HTTPS redirect, HSTS, and secure cookies (all set by environment variables).
- Django sends `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` and `Cross-Origin-Opener-Policy`.
- nginx sends a strict Content-Security-Policy for the web app (`default-src 'self'`, no inline scripts, `frame-ancestors 'none'`) and a `Permissions-Policy`, and hides its version.

**Containers**
- Both application containers run as non-root users, with read-only root file systems, all Linux capabilities dropped, and `no-new-privileges`.
- Only the web container publishes a port. The API and the database are on an internal network.
- Secrets come from `.env` or the hosting platform, never from the image. `DJANGO_SECRET_KEY` is required whenever `DEBUG` is off, and `DEBUG` is off by default.

**Supply chain**
- Python dependencies pinned in `requirements.txt`, and npm dependencies locked in `package-lock.json`.
- CI runs `manage.py check --deploy` and `npm audit`. Dependabot proposes updates every week.

## Before going live
- [ ] `SEED_DEMO=false`, and trial users removed
- [ ] Unique `DJANGO_SECRET_KEY` and database password, kept in a secret store
- [ ] HTTPS settings on: `DJANGO_SECURE_COOKIES`, `DJANGO_SECURE_SSL_REDIRECT`, `DJANGO_HSTS_SECONDS`
- [ ] Real `DJANGO_ALLOWED_HOSTS` and `DJANGO_CSRF_TRUSTED_ORIGINS`
- [ ] Database backups set up and tested
- [ ] Application backups stored in an access-controlled location
