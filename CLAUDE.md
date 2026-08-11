# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Operational context for working in this repo. Everything here was verified against the
code; when it disagrees with the code, the code wins — fix this file.

## What this is

A **Stremio addon**: users add friends by email and recommend movies/series to each
other; received suggestions appear as **catalogs inside Stremio**. One Express service
serves the REST API, the Stremio protocol, and the vanilla-JS SPA.

Docs (kept current, prefer them over duplicating detail here):
`README.md` · `docs/01-getting-started.md` → `docs/07-testing.md` · `PIANO.md` (original
technical plan, some URLs in it are historical).

## Core design (read first)

Stremio addons are stateless HTTP services and Stremio **never sends the user's
identity**. So each user installs a personalized URL with a token in the path:

```
<PUBLIC_URL>/u/<addonToken>/manifest.json
```

The backend resolves token → user → returns *their* suggestions. The SPA at `/configure`
(and `/u/<token>/configure`) handles login, friends, and sending suggestions. Auth is
passwordless magic-link → JWT in an httpOnly cookie (`cinepals_session`, 30 days;
magic-link TTL 15 min).

## Stack

TypeScript (CommonJS, ES2022) · Express 4 · Zod · Prisma 5 + PostgreSQL 16 ·
TMDB v3 (metadata, cached in `title_cache`) · Playwright (e2e) · pnpm 10 via corepack ·
Node 22 (`.node-version`; `engines` says `>=18`) · `just` · Docker Compose.

Email has **three paths**, chosen at runtime in `src/lib/email.ts:16`:
`RESEND_API_KEY` → Resend HTTP API (plain `fetch`, no SDK dependency) ·
else `SMTP_URL` → nodemailer to the local Mailpit trap · else printed to the console.

Repo: `git@github.com:predorock/cinepals.git`, branch `main`.

## Layout

```
src/
  config.ts            env config; appVersion read from package.json; resolvePublicUrl forces https for non-local hosts (config.ts:24)
  db.ts                Prisma singleton
  types.ts             shared + Stremio protocol types + Express req.user augmentation
  app.ts               express app: /health, /api/*, /internal, /u/:token, static SPA; dev request logger; trust proxy 1
  server.ts            bootstrap
  lib/
    email.ts           sendEmail (Resend | SMTP | console) + emailLayout (shared footer: credits, repo, Buy Me a Coffee)
    tmdb.ts            searchTitles, getPopularTitles, getMetaByImdbId, cacheTitle + KEYLESS fallback (Metahub art + curated list)
    tokens.ts          generateToken
  middleware/auth.ts   requireAuth, setSession, clearSession
  services/
    userService.ts     find/create (shadow) user, getUserByAddonToken, updateDisplayName, regenerateAddonToken
    authService.ts     requestMagicLink, consumeMagicLink
    friendService.ts   listFriends, listPendingRequests, sendFriendRequest, respondToRequest, removeFriend, areFriends
    suggestionService.ts  createSuggestion, sendDailyDigests, listReceived/Sent, updateSuggestionStatus, getReceivedByType, withTitles
  routes/
    authRoutes.ts      /api/auth: POST request (rate-limited), GET verify, GET addon-info/:token (public),
                       POST logout, GET me, PATCH me (displayName), POST me/regenerate-token, DELETE me
    friendRoutes.ts    /api/friends: GET /, GET /requests, POST /request, POST /:id/accept, POST /:id/decline, DELETE /:otherUserId
    suggestionRoutes.ts /api/suggestions: GET /received, GET /sent, POST /, PATCH /:id
    searchRoutes.ts    /api/search?q=&type=
    internalRoutes.ts  POST /internal/run-digest (CRON_SECRET bearer, timing-safe)
  addon/
    manifest.ts        buildManifest(token) — dynamic: 2 aggregate catalogs + 2 per friend (id "cinepals-friend-<friendId>")
    catalog.ts         buildCatalog(token, type, searchQuery?, friendId?)
    meta.ts            buildMeta
    router.ts          /u/:token protocol router + CORS; parseFriendId; Cache-Control max-age=60
public/                index.html, app.js, style.css — vanilla SPA (no build step)
e2e/                   Playwright specs + helpers (auth, friends, mailpit)
docs/                  01…07 guides
scripts/seed-fake.ts   fake friends + suggestions (`just seed [email]`)
prisma/schema.prisma   User, LoginToken, Friendship(enum), Suggestion(enum), TitleCache — NO migrations dir (db push)
.github/workflows/     ci.yml (typecheck+build, e2e w/ Postgres+Mailpit services) · digest.yml (daily digest cron)
playwright.config.ts · docker-compose.yml · Dockerfile.dev · justfile · render.yaml · .env.example · .env.local (gitignored)
```

## Local dev

`.env.local` exists (gitignored) with a working `TMDB_API_KEY`, a generated `JWT_SECRET`,
`PORT=8990`, `PUBLIC_URL=http://127.0.0.1:8990`, local `DATABASE_URL` (Postgres on host
port **5555**), `SMTP_URL` (Mailpit) and a commented-out `RESEND_API_KEY`.
It has **no `CRON_SECRET`** — export one to call `/internal/run-digest` by hand.

`just` loads `.env.local` automatically:

```
just setup    # install + env + db + schema
just dev      # starts Postgres + Mailpit, then tsx watch on 8990
just push     # prisma db push
just seed     # fake friends/suggestions (default demo@example.com)
just test     # e2e (brings up db + mailpit, pushes schema, runs Playwright)
just up       # full Docker stack (app 8990, db 5555, mailpit 1025/8025, adminer 8080)
just deploy   # typecheck + build + git push origin main
just mail-open  # Mailpit inbox at http://127.0.0.1:8025
```

`just test` (alias for `test-e2e`) takes **`*args` passed straight to Playwright**, so use
it for a single spec or case — it still starts Postgres + Mailpit and pushes the schema
first, which running `playwright test` bare does not:

```
just test e2e/auth.spec.ts             # one spec file
just test e2e/digest.spec.ts:42        # one case by line
just test -g "sends a digest"          # one case by title
just test --headed --debug             # step through in a real browser
just test-e2e-ui                       # interactive Playwright UI
```

Without `just`: `node --env-file=.env.local node_modules/.bin/tsx watch src/server.ts`.
Build/verify: `pnpm run build` (= `prisma generate && tsc`) · `pnpm run typecheck`
(also `just typecheck` · `just build` · `just predeploy` = typecheck + build).

## Data model notes

- `Suggestion` is unique on `(fromUserId, toUserId, imdbId)`; statuses `new|seen|watched|dismissed`
  (the recipient can set `seen|watched|dismissed` only).
- `Suggestion.notifiedAt` drives digest idempotency: `null` = pending, stamped after a
  successful send.
- `Friendship` is unique on `(requesterId, addresseeId)`; a reversed pending request is
  auto-accepted when the other side also invites (`friendService.ts:117`).
- `TitleCache` is populated at search time and on meta cache-misses; `withTitles` batches
  a single DB read and only falls back to TMDB for genuine misses.

## Behavior worth knowing

- **Manifest is cached by Stremio at install time.** New per-friend catalogs appear only
  after **reinstalling** (the "🔄 Update in Stremio" button reopens the install deep-link).
  Catalog *content* updates live.
- `behaviorHints.configurationRequired` is `!token` (`manifest.ts:61`) — with a token the
  addon installs directly. Don't set it always-true or Stremio won't install.
- **Welcome catalog**: an empty **aggregate** catalog with no search falls back to popular
  titles (`catalog.ts:52`); per-friend catalogs never do.
- **Keyless mode**: without `TMDB_API_KEY`, popular titles and meta fall back to a curated
  list + Stremio Metahub artwork. **Search returns nothing without a real key** —
  `tmdbFetch` bails early (`tmdb.ts:73`).
- **Suggestions send no immediate email.** The recipient gets **one daily digest**
  (`sendDailyDigests`, `suggestionService.ts:91`) bundling all pending, non-dismissed,
  not-yet-notified suggestions. A failed send leaves `notifiedAt` null so it retries.
- Digest schedule: `.github/workflows/digest.yml` fires at **16:00 and 17:00 UTC** and
  gates on the Rome local hour, so exactly one firing runs per DST season at 18:00
  Europe/Rome. `workflow_dispatch` bypasses the gate. GitHub cron can be delayed several
  minutes and is disabled after ~60 days of repo inactivity.
- Rate limiting exists on **`POST /api/auth/request` only**: 5 / 15 min in production,
  1000 outside it so the e2e suite isn't throttled (`authRoutes.ts:36`).
- `PUBLIC_URL` is normalized to **https** for any non-local host (`config.ts:24`), so
  magic-links are always secure regardless of how the env var was entered.
- `/u/:token/configure` is registered **before** the addon router in `app.ts:52` — order
  matters, otherwise the protocol router would swallow it.
- `web.stremio.com` (HTTPS) blocks `http://127.0.0.1` addons (mixed content) — use the
  **desktop app** locally. Production over HTTPS works in the web client.
- `manifest.logo` points at `/logo.png`, which **does not exist** (`public/` has only
  index.html, app.js, style.css) — a harmless 404. Adding `public/logo.png` fixes it.
- `areFriends` is duplicated: the exported one in `friendService.ts:217` and a private
  copy in `suggestionService.ts:18` (deliberate — keeps the service dependency-free).

## Testing

Playwright e2e only, no unit tests. `playwright.config.ts` loads `.env.local`, forces
`NODE_ENV=development`, deletes `RESEND_API_KEY` (never a real send), pins
`CRON_SECRET=test-cron-secret`, runs **single-worker/serial**, and starts the server
itself via `tsx src/server.ts` against `/health`. Tests read magic-links and invites out
of Mailpit's REST API. Specs: auth, account deletion, profile, friends, suggestions,
addon (incl. `manifest.version === package.json version`), digest (401 without token,
delivery, idempotency).

Serial by design (`workers: 1`, `fullyParallel: false`): flows mutate shared server state
(friendships/suggestions), though each test uses unique emails. Timeouts 60s per test /
15s per assertion; `retries: 1` and `forbidOnly` in CI only.

**Gotcha — `reuseExistingServer: !CI`.** Locally Playwright adopts whatever already
listens on 8990 instead of starting its own. A `just dev` server left running is used
as-is, with `.env.local` values rather than the overrides `playwright.config.ts` sets on
`process.env` — so `CRON_SECRET` isn't `test-cron-secret` (digest specs fail on 401) and
`RESEND_API_KEY` isn't deleted (a populated one would send **real** email; it's commented
out in `.env.local` today). Stop `just dev` before a test run.

CI (`ci.yml`) runs typecheck+build and the e2e job against Postgres + Mailpit service
containers. The e2e job needs a **`TMDB_API_KEY` repo secret** for the search/suggestion
specs.

## Deploy

Render blueprint (`render.yaml`): free web service `cinepals` (Oregon / us-west-2).
**Postgres is on Neon**, not Render — `render.yaml` has no `databases:` block. The free
Render DB expired after 90 days (it was `cinepals-db`); Neon's free tier doesn't expire,
it scales to zero instead.

- Build: `corepack pnpm install --prod=false && corepack pnpm run build && DATABASE_URL="${DIRECT_URL:-$DATABASE_URL}" corepack pnpm exec prisma db push --accept-data-loss`.
  `corepack pnpm` (not `corepack enable`, which hits EROFS on Render); `--prod=false`
  forces devDeps in; the free tier has no `preDeployCommand`, hence `db push` in build.
- Start: `node dist/server.js`. Health check: `/health`.
- **Two Neon URLs**: `DATABASE_URL` = pooled (`-pooler` in the host) + `&pgbouncer=true`,
  used by the app; `DIRECT_URL` = Neon's direct string copied as-is (no `pgbouncer=true` —
  it would make Prisma treat a real session as pooled and drop the `migrate` advisory
  lock), used *only* by the build-time `db push`. Neon's own params (`sslmode`,
  `channel_binding`) are fine to keep — verified working with Prisma 5.22.
- `schema.prisma` has **no `directUrl`** — it reads only `DATABASE_URL`. The pooled/direct
  swap lives entirely in the `render.yaml` build command, so `DIRECT_URL` is inert
  everywhere else (local, CI, Docker, `just push`). Deliberate: those all run a plain
  Postgres with no pooler, and a `directUrl` in the schema would make `DIRECT_URL`
  mandatory for every Prisma CLI invocation.
- Env vars to set manually (`sync: false`): `DATABASE_URL`, `DIRECT_URL`, `PUBLIC_URL`,
  `TMDB_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `CRON_SECRET`. Only `JWT_SECRET` is
  wired automatically (`generateValue`) — and only at first creation, so it survives
  blueprint re-syncs.
- **The DB vars are build-critical now.** They were `fromDatabase` (always present at
  build time); as `sync: false` they fail the *whole deploy* rather than just starting a
  broken app. Two observed signatures: unset → `P1012 … DATABASE_URL resolved to an empty
  string` (the `${DIRECT_URL:-$DATABASE_URL}` expansion always *sets* the var, so it's
  "empty", never "not found"); stale/dead host → `P1001: Can't reach database server`.
  Set them before the first build.
- **Dropping `databases:` does not repoint an existing service.** Render *preserves* the
  current value of a `sync: false` var on re-sync, so the live service keeps the old
  Render connection string until `DATABASE_URL` is overwritten by hand in the dashboard.
- `CRON_SECRET` must match the GitHub Actions repo secret of the same name.
- The digest workflow targets **`https://cinepals.xyz/internal/run-digest`** (hardcoded in
  `digest.yml`) — that's the live host, so `PUBLIC_URL` should match it. If the domain
  changes, update the workflow too.
- Free tier: the web service still sleeps when idle — which is why the digest is triggered
  externally rather than by an in-process cron. Neon compute also suspends after 5 min
  idle, adding a few hundred ms to the first query after a lull.
- Local dev, CI and Docker all run a plain Postgres with no pooler, so they set only
  `DATABASE_URL` — the pooled/direct split is Neon-specific and confined to `render.yaml`.

## Open items

1. **Prisma migrations**: still `db push`, no `prisma/migrations/`. For production
   correctness run `prisma migrate dev --name init`, commit, and switch the deploy step to
   `prisma migrate deploy` (`pnpm prisma:deploy` already exists).
2. Add `public/logo.png` (manifest 404).
3. Rate-limit more endpoints (only the magic-link request is limited today).
4. No unit tests — the friend → suggestion → catalog logic is covered only end-to-end.
