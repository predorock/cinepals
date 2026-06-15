# 🎬 Cinepals

A Stremio addon that lets you add friends by email, recommend movies and series to each other, and see them appear as your own personal catalog inside Stremio.

The full technical plan is in [`PIANO.md`](./PIANO.md).

## How it works

Stremio addons are **stateless** HTTP services: Stremio does not pass the user's identity. To have personal data (friends, suggestions), each user installs a **personalized URL** with a token:

```
https://<your-domain>/u/<TOKEN>/manifest.json
```

The backend uses the token to identify the user and return their suggestions as a catalog. Passwordless login via **magic-link** over email.

## Stack

Node.js + TypeScript · Express · Prisma · PostgreSQL · TMDB (metadata) · Resend (email) · deployed on Render.

## Structure

```
src/
  config.ts            Configuration from env
  db.ts                Prisma client (singleton)
  types.ts             Shared types (incl. Stremio protocol)
  server.ts / app.ts   Express bootstrap and router mounting
  lib/
    email.ts           Email sending (Resend or console in dev)
    tmdb.ts            Movie/series search and metadata (with DB cache)
    tokens.ts          Secure token generation
  middleware/
    auth.ts            requireAuth + JWT session in httpOnly cookie
  services/
    userService.ts     Users, addon tokens
    authService.ts     Magic-link
    friendService.ts   Friendships (requests, accept, remove)
    suggestionService.ts  Suggestions
  routes/
    authRoutes.ts      /api/auth
    friendRoutes.ts    /api/friends
    suggestionRoutes.ts /api/suggestions
    searchRoutes.ts    /api/search
  addon/
    manifest.ts        Stremio manifest
    catalog.ts         "Suggested by friends" catalog
    meta.ts            Title metadata
    router.ts          /u/:token router (Stremio protocol + CORS)
public/
  index.html / style.css / app.js   /configure page (SPA)
prisma/
  schema.prisma        Data model
```

## Quick commands with `just`

If you have [`just`](https://github.com/casey/just) installed (`brew install just`), the [`justfile`](./justfile) collects all the commands. It automatically loads `.env.local`.

```bash
just              # list all recipes
just setup        # install + .env.local + Postgres + schema
just dev          # start in development (hot-reload)
just up           # full stack in Docker (db + app + adminer)
just push         # sync the schema to the DB
just build        # production build
just deploy       # typecheck + build + git push (Render does the deploy)
```

## Setup with Docker (recommended)

The fastest way: Postgres + app with hot-reload + Adminer, all with one command.

1. (Optional but recommended) create a `.env` file in the root with at least the TMDB key:

   ```bash
   echo "TMDB_API_KEY=your-key" > .env
   ```

   `docker compose` reads it automatically. Without `RESEND_API_KEY`, magic-links are printed to the container logs.

2. Start:

   ```bash
   docker compose up
   ```

   On startup the app runs `prisma db push` (creates the tables) and starts in watch mode.

3. Open `http://127.0.0.1:8990/configure`. The login link appears in the logs (`docker compose logs -f app`).
   To inspect the DB: Adminer at `http://127.0.0.1:8080` (server `db`, user/pass `postgres`, database `cinepals`).

4. Stop: `docker compose down` (add `-v` to also delete the DB data).

## Local setup (without Docker)

1. **Requirements**: Node ≥ 18 and a local PostgreSQL (or Docker).

   ```bash
   docker run --name cinepals-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=cinepals -p 5555:5432 -d postgres:16
   ```

2. **Environment variables**: copy `.env.example` to `.env` and fill in the values (at least `DATABASE_URL`, `JWT_SECRET`, `TMDB_API_KEY`).

   The `TMDB_API_KEY` (v3) can be obtained for free at https://www.themoviedb.org/settings/api.
   Without `RESEND_API_KEY`, emails (magic-links included) are **printed to the console**: handy in development.

3. **Install and prepare the database**:

   ```bash
   pnpm install
   pnpm exec prisma migrate dev --name init   # creates the tables + generates the client
   ```

4. **Start in development** (loads .env, hot-reload):

   ```bash
   node --env-file=.env node_modules/.bin/tsx watch src/server.ts
   # or, if you have dotenv-cli: pnpm run dev
   ```

5. Open `http://127.0.0.1:8990/configure`, log in with your email, copy the login link from the console, and install the addon URL shown in Stremio.

## Production build

```bash
pnpm run build   # prisma generate && tsc
pnpm start       # node dist/server.js
```

## End-to-end tests

Playwright drives the real SPA through every flow (auth, display name, friends,
suggestions, addon, account deletion). Magic-link login is exercised for real by
reading the email out of the local **Mailpit** trap.

```bash
just test-e2e          # brings up Postgres + Mailpit, syncs the schema, runs the suite
just test-e2e-ui       # same, with the interactive Playwright UI
pnpm run test:e2e       # if Postgres + Mailpit are already running
```

Tests read config from `.env.local` (DB, `TMDB_API_KEY`, Mailpit), force the dev
profile, and start the app server themselves (see `playwright.config.ts`). Each
test uses unique emails, so runs are isolated without resetting the database.
Specs live in [`e2e/`](./e2e).

## Deploy on Render

1. Push the repo to GitHub.
2. On Render: **New → Blueprint** and select the repo (uses [`render.yaml`](./render.yaml)). It creates the web service + the Postgres database.
3. Set the `sync: false` env vars: `PUBLIC_URL` (= public URL of the service, e.g. `https://cinepals.onrender.com`), `TMDB_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`.
4. The `preDeployCommand` runs `prisma migrate deploy` (migration files are required: create the init locally with `pnpm exec prisma migrate dev --name init` and commit it).
5. HTTPS is automatic → Stremio requirement satisfied.

> Note: the addon should NOT be published on Addon Central, because the URL contains the personal token and the catalog is per-user. It is shared only via URL/configure.

## User flow

1. Log in with your email (magic-link) on the `/configure` page.
2. Add a friend by email → they accept from their own page.
3. Search for a movie and suggest it to a friend (with an optional note).
4. The movie appears in the "🎬 Suggested by friends" catalog inside the friend's Stremio.

## Main endpoints

| Area | Method | Path |
|---|---|---|
| Addon | GET | `/u/:token/manifest.json` |
| Addon | GET | `/u/:token/catalog/:type/:id.json` |
| Addon | GET | `/u/:token/meta/:type/:id.json` |
| Auth | POST | `/api/auth/request`, `/api/auth/logout` |
| Auth | GET | `/api/auth/verify`, `/api/auth/me` |
| Friends | GET/POST | `/api/friends`, `/api/friends/request`, `/api/friends/requests` |
| Suggestions | GET/POST/PATCH | `/api/suggestions`, `/api/suggestions/received`, `/api/suggestions/sent` |
| Search | GET | `/api/search?q=...&type=movie\|series` |

## Verification status

`tsc` passes clean apart from errors that depend exclusively on the generated Prisma client (`prisma generate`, run automatically by `pnpm run build`). All application-level type bugs have been resolved.
