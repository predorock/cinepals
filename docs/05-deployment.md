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

## Render (Blueprint)

[`render.yaml`](../render.yaml) declares a free **web service** + free **Postgres**:

- **Build:** `corepack pnpm install --prod=false && corepack pnpm run build && corepack pnpm exec prisma db push --accept-data-loss`
  Schema is synced at build time because the free tier has no `preDeployCommand`; `db push` is idempotent.
- **Start:** `node dist/server.js`
- **Health check:** `/health`

> The build uses `corepack pnpm …` (not `corepack enable`): `enable` symlinks into
> `/usr/bin`, which is read-only on Render (EROFS). `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`
> keeps the non-interactive build from prompting.

### Steps

1. Push the repo to GitHub.
2. On Render: **New → Blueprint**, select the repo. It creates the web service + database.
3. Set the `sync: false` env vars (Render leaves these for you to fill):
   - `PUBLIC_URL` — the service's public URL, e.g. `https://cinepals.onrender.com`
   - `TMDB_API_KEY`
   - `RESEND_API_KEY`
   - `EMAIL_FROM`
   - `DATABASE_URL` is wired from the managed Postgres; `JWT_SECRET` is auto-generated; `NODE_ENV=production`.
4. Each push to the deploy branch auto-builds and redeploys. HTTPS is automatic
   (satisfies Stremio's HTTPS requirement). See [Configuration](03-configuration.md) for
   what each variable does.

> Custom domain: point it at the service and set `PUBLIC_URL` to it. `https` is enforced
> automatically for non-local hosts (see `resolvePublicUrl` in `src/config.ts`).

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

## Notes

- **Migrations vs. push:** the repo uses `prisma db push` (schemaless sync) for speed.
  To use migration files instead, create them locally (`corepack pnpm exec prisma migrate dev --name init`),
  commit, and switch the deploy step to `prisma migrate deploy` (`pnpm prisma:deploy`).
- **Addon privacy:** the personal addon URL contains a secret token — share by URL, do
  **not** publish to Stremio's central addon directory.

---

Next: [Contributing](06-contributing.md) · [Testing](07-testing.md)
