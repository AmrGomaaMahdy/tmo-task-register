# Deploying on Render (free, without Docker)

A temporary deployment for demos and trials, using Render's native Python and static-site
runtimes. The `render.yaml` Blueprint at the root of the repository creates everything.

| Resource | Type | What it does |
|---|---|---|
| `task-register-db` | Render Postgres, free | The database. 1 GB; **expires 30 days after creation**, deleted 14 days later. No backups. |
| `task-register-api` | Web Service, Python 3, free | Django + DRF API, Django admin, `/healthz`. Sleeps after 15 idle minutes; the next visit wakes it in about a minute. |
| `task-register` | Static Site, free | The React app. Forwards `/api`, `/admin` and `/static` to the API, so the browser sees one address. |

## One-click setup

1. Push the repository to GitHub (with `render.yaml`, `backend/` and `frontend/` at the root).
2. Sign in at [render.com](https://render.com) with GitHub and give Render access to the repository.
3. **New → Blueprint**, pick the repository and branch, then **Apply**.
4. Render asks for **`DEMO_USER_PASSWORD`**: the password of the trial users. Use a strong one.
5. Wait until all three resources are live (the first build takes a few minutes).
6. Open `https://task-register-api.onrender.com/healthz` (it answers `{"status": "ok"}`), then
   `https://task-register.onrender.com` and sign in, for example as `tmo.officer` or `admin`.

On start the API applies the migrations, sets up the roles and permissions, and loads the demo
data once (`seed_demo` skips what is already there). To start with an empty register, remove
`&& python manage.py seed_demo` from `startCommand` in `render.yaml`.

## If a service name is taken

The public addresses follow the service names (`<name>.onrender.com`). When a name is already
taken, Render adds a suffix, for example `task-register-api-x1y2.onrender.com`. Then:

1. In `render.yaml`, change the three `https://task-register-api.onrender.com/...` route destinations
   to the API's real address, and `DJANGO_ALLOWED_HOSTS` / `DJANGO_CSRF_TRUSTED_ORIGINS` to the
   front end's real address.
2. Commit and push: Render syncs the Blueprint and redeploys.

The API's own address never needs setting: Render passes it in `RENDER_EXTERNAL_HOSTNAME` and the
settings add it to the allowed hosts.

## Updates

Every push to the linked branch rebuilds the API and the front end (`autoDeployTrigger: commit`).
Migrations run on each start.

## Before the free database expires

Download a backup from **Backup → Download backup** in the app. After creating a new free database
(delete the old one first: one free database per workspace), sync the Blueprint again and restore
the file on the Backup page.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Sign-in says CSRF failed / 403 | `DJANGO_CSRF_TRUSTED_ORIGINS` must be exactly `https://` + the front end's address, without a trailing slash. |
| `Bad Request (400)` | The address in the browser is missing from `DJANGO_ALLOWED_HOSTS`. |
| The page loads but data never arrives | The API is waking up: wait a minute and refresh, or open `/healthz` first. |
| Sign-in shows *Unexpected token '<', "<!DOCTYPE"… is not valid JSON* | The web app got an HTML page instead of the API's answer. From 1.18.2 the sign-in page shows the real reason instead; deploy it to **both** services (front end and API). The usual causes: **(1)** *The security check refused the request (Origin checking failed …)*: `DJANGO_CSRF_TRUSTED_ORIGINS` of **task-register-api** (dashboard → Environment, not only `render.yaml`) must be exactly the address in the browser, e.g. `https://task-register-elty.onrender.com`; save, and the API redeploys. **(2)** *The API does not accept requests for this address*: add the front end's address to `DJANGO_ALLOWED_HOSTS` (without `https://`). **(3)** *The server is not answering yet*: the free API was asleep; the sign-in waits up to 90 seconds, or open `https://task-register-api.onrender.com/healthz` first. **(4)** The API service has another address (a suffix such as `task-register-api-x1y2`): change the `/api`, `/admin` and `/static` rewrites of the static site. **(5)** The API failed to start: task-register-api → Logs. |
| Python build error | Set `PYTHON_VERSION` to a full version, e.g. `3.12.11`. |
