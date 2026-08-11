# 05 — Deployment

The project ships as a Node web service backed by PostgreSQL. The reference target is
[Render](https://render.com) via the Blueprint in [`render.yaml`](../render.yaml), but
any host that runs Node 22 + Postgres works.

---

## Build & run (any host)

```bash
corepack pnpm install --prod=false   # build needs prisma + typescript (devDeps)
corepack pnpm run build              # prisma generate && tsc → dist/
corepack pnpm exec prisma db push    # sync schema (or `prisma migrate deploy` with migrations)
node dist/server.js                  # start (reads env from the environment)
```

The server listens on `PORT` (default `8990`) and exposes a health check at `/health`.

---

## Render (Blueprint) + Neon (Postgres)

[`render.yaml`](../render.yaml) declares a free **web service** only. Postgres is hosted
on **[Neon](https://neon.tech)**, not Render: Render's free database expires after 90 days
and is then unreachable, while Neon's free tier has no expiry (it scales to zero when
idle instead).

- **Build:** `corepack pnpm install --prod=false && corepack pnpm run build && DATABASE_URL="${DIRECT_URL:-$DATABASE_URL}" corepack pnpm exec prisma db push --accept-data-loss`
  Schema is synced at build time because the free tier has no `preDeployCommand`; `db push` is idempotent.
  It runs against `DIRECT_URL` — see [Neon connection strings](#neon-connection-strings) below.
- **Start:** `node dist/server.js`
- **Health check:** `/health`

### Neon connection strings

Neon hands out two strings for the same database, and the split matters:

| Env var | Neon string | Used by |
|---------|-------------|---------|
| `DATABASE_URL` | **pooled** — hostname contains `-pooler` — **plus `&pgbouncer=true`** | the running app |
| `DIRECT_URL` | **direct** — exactly as Neon gives it, **no `pgbouncer=true`** | `prisma db push` at build time |

The pooled endpoint is PgBouncer in transaction mode, so append **`&pgbouncer=true`** to
`DATABASE_URL` — it stops Prisma from using prepared statements, which don't survive a
pooled connection. Neon's other params (`sslmode`, `channel_binding`) can be left as-is.

Schema changes need a real session, hence the direct string for `db push`. Copy that one
from Neon separately rather than editing the pooled string: dropping `-pooler` but leaving
`pgbouncer=true` on it makes Prisma treat a real session as pooled, which suppresses the
migration advisory lock if the repo ever moves to `prisma migrate deploy`.

Create the Neon project in a region close to the Render service — **us-west-2 (Oregon)**
for the default Render region — since every query is a round-trip.

> The build uses `corepack pnpm …` (not `corepack enable`): `enable` symlinks into
> `/usr/bin`, which is read-only on Render (EROFS). `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`
> keeps the non-interactive build from prompting.

### Steps

1. Push the repo to GitHub.
2. On [Neon](https://console.neon.tech): create a project in **us-west-2 (Oregon)** and
   copy both connection strings (see [above](#neon-connection-strings)).
3. On Render: **New → Blueprint**, select the repo. It creates the web service.
4. Set the `sync: false` env vars (Render leaves these for you to fill):
   - `DATABASE_URL` — Neon's pooled string + `&pgbouncer=true`
   - `DIRECT_URL` — Neon's direct string
   - `PUBLIC_URL` — the service's public URL, e.g. `https://cinepals.onrender.com`
   - `TMDB_API_KEY`
   - `RESEND_API_KEY`
   - `EMAIL_FROM`
   - `CRON_SECRET` — bearer token for the daily digest endpoint (see [Scheduled jobs](#scheduled-jobs-daily-digest))
   - `JWT_SECRET` is auto-generated; `NODE_ENV=production`.
5. Each push to the deploy branch auto-builds and redeploys. HTTPS is automatic
   (satisfies Stremio's HTTPS requirement). See [Configuration](03-configuration.md) for
   what each variable does.

> **Fill `DATABASE_URL`/`DIRECT_URL` before the first build, then redeploy.** They are
> `sync: false`, so Render creates the service with them empty and the build's `db push`
> aborts with `P1012 … The environment variable DATABASE_URL resolved to an empty string`
> — the whole deploy fails rather than starting an app with no database. The first build
> after step 3 is expected to fail; the redeploy in step 5 is the one that succeeds.
> A stale value fails differently: `P1001: Can't reach database server`.

> Custom domain: point it at the service and set `PUBLIC_URL` to it. `https` is enforced
> automatically for non-local hosts (see `resolvePublicUrl` in `src/config.ts`).

### Migrating an existing service off Render Postgres

Removing the `databases:` block does **not** repoint a service that already exists. On
re-sync Render *preserves* the current value of a `sync: false` variable, so the service
keeps talking to the old Render database until you overwrite it by hand:

1. Create the Neon project and copy both strings.
2. In the Render dashboard, set `DATABASE_URL` to the pooled string (+ `&pgbouncer=true`)
   and add `DIRECT_URL`. **Overwrite** — don't rely on the blueprint to do it.
3. Redeploy. The build's `db push` creates the schema on the empty Neon database.
4. Delete the old Render database once the service is verified healthy.

> Moving the *data* requires the old database to be running. A free Render database that
> has expired is suspended and refuses connections from outside (TLS is closed
> immediately), so dump it *before* it expires — or restore it to a paid plan long enough
> to run `pg_dump`. Otherwise the Neon database starts empty and users re-register via
> magic link.

---

## Docker

A development stack is provided in [`docker-compose.yml`](../docker-compose.yml)
(app + Postgres + Mailpit + Adminer), built from [`Dockerfile.dev`](../Dockerfile.dev):

```bash
docker compose up           # full local stack
docker compose up --build   # rebuild images first
```

`Dockerfile.dev` targets local development (hot-reload via `tsx`). For a production
container, build with `pnpm run build` and run `node dist/server.js` on a Node 22 base
image with the production env vars set.

---

## Scheduled jobs (daily digest)

The daily suggestion digest is sent by an external scheduler, because Render's free tier
sleeps when idle (an in-process cron wouldn't fire reliably). The workflow
[`.github/workflows/digest.yml`](../.github/workflows/digest.yml) pings the
token-protected endpoint `POST /internal/run-digest` once a day at **18:00 Europe/Rome**
(it fires at 16:00 & 17:00 UTC and gates on the Rome local hour to stay correct across DST).

Setup:

1. Generate a strong secret, e.g. `openssl rand -hex 32`.
2. Set it as `CRON_SECRET` in **both** places (the values must match):
   - Render service env var (`CRON_SECRET`).
   - GitHub Actions repo secret: `gh secret set CRON_SECRET` (or Settings → Secrets and variables → Actions).
3. Trigger a one-off run any time with `gh workflow run digest.yml` (manual dispatch
   bypasses the time gate), or `curl -X POST https://<host>/internal/run-digest -H "Authorization: Bearer $CRON_SECRET"`.

The endpoint returns `{ ok, recipients, emails, suggestions }` and is idempotent
(suggestions already included in a digest are skipped via `notifiedAt`).

---

## Notes

- **Migrations vs. push:** the repo uses `prisma db push` (schemaless sync) for speed.
  To use migration files instead, create them locally (`corepack pnpm exec prisma migrate dev --name init`),
  commit, and switch the deploy step to `migrate deploy` — keeping the direct-URL prefix:
  `DATABASE_URL="${DIRECT_URL:-$DATABASE_URL}" corepack pnpm exec prisma migrate deploy`.
  The bare `pnpm prisma:deploy` script reads `DATABASE_URL`, which is the **pooled**
  endpoint; `migrate deploy` takes a Postgres advisory lock that transaction-mode pooling
  can't hold, so it would hang or error.
- **Addon privacy:** the personal addon URL contains a secret token — share by URL, do
  **not** publish to Stremio's central addon directory.

---

Next: [Contributing](06-contributing.md) · [Testing](07-testing.md)
