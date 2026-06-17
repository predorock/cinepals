# 02 — Architecture

Cinepals is a single Node/Express service that serves three things from one process:

1. a **REST API** (`/api/*`) used by the configure-page SPA,
2. the **Stremio addon protocol** (`/u/:token/*`) consumed by Stremio clients,
3. the **static SPA** itself (`public/`, served at `/` and `/configure`).

State lives in PostgreSQL via Prisma. Title metadata comes from TMDB and is cached
in the database.

---

## Tech stack

| Concern | Choice |
|---------|--------|
| Language | TypeScript (CommonJS, target ES2022) |
| HTTP | Express 4 |
| Validation | Zod |
| ORM / DB | Prisma 5 + PostgreSQL 16 |
| Auth | Stateless JWT session in an httpOnly cookie + email magic-link |
| Email | Resend (prod) / SMTP-Mailpit (dev) / console fallback — `nodemailer` for SMTP |
| Metadata | TMDB v3 API, cached in `title_cache` |
| Frontend | Vanilla JS SPA (no framework), `public/app.js` |
| Tests | Playwright (e2e) — see [Testing](07-testing.md) |
| Tooling | pnpm, `just`, Docker Compose |

---

## Project structure

```
src/
├── server.ts              # entrypoint: app.listen + graceful shutdown
├── app.ts                 # express app: middleware, route mounts, static SPA
├── config.ts              # centralized env-derived config
├── db.ts                  # Prisma client singleton
├── types.ts               # shared types + Express req.user augmentation + Stremio types
├── middleware/
│   └── auth.ts            # requireAuth, setSession, clearSession (JWT cookie)
├── lib/
│   ├── email.ts           # sendEmail (Resend/SMTP/console), emailLayout
│   ├── tmdb.ts            # search, popular, meta-by-imdb, title cache
│   └── tokens.ts          # random URL-safe token generator
├── routes/
│   ├── authRoutes.ts      # /api/auth
│   ├── friendRoutes.ts    # /api/friends
│   ├── suggestionRoutes.ts# /api/suggestions
│   ├── searchRoutes.ts    # /api/search
│   └── internalRoutes.ts  # /internal (CRON_SECRET-guarded digest trigger)
├── addon/
│   ├── router.ts          # /u/:token Stremio protocol router
│   ├── manifest.ts        # dynamic manifest (per-friend catalogs)
│   ├── catalog.ts         # builds catalogs from received suggestions
│   └── meta.ts            # title detail metadata
└── services/
    ├── userService.ts     # users, shadow users, addon tokens
    ├── authService.ts     # magic-link request/consume
    ├── friendService.ts   # friend requests, accept/decline, friends list
    └── suggestionService.ts# create/list suggestions, status updates, titles, daily digest

public/                    # SPA: index.html, app.js, style.css
prisma/schema.prisma       # data model
e2e/                       # Playwright specs + helpers
scripts/seed-fake.ts       # dev seed
```

Layering: **routes** (HTTP + Zod validation) → **services** (business logic) →
**Prisma** (persistence). `lib/` holds cross-cutting integrations (email, TMDB, tokens).

---

## Data model

Defined in [`prisma/schema.prisma`](../prisma/schema.prisma):

- **User** — `id`, `email` (unique), `displayName?`, `addonToken` (unique), `createdAt`.
  "Shadow" users are created on demand when you invite an email that has no account yet.
- **LoginToken** — single-use magic-link token: `token`, `userId`, `expiresAt`, `usedAt?`.
- **Friendship** — `requesterId` + `addresseeId`, `status` (`pending|accepted|declined|blocked`),
  unique per pair.
- **Suggestion** — `fromUserId` + `toUserId` + `imdbId` (unique triple), `contentType`
  (`movie|series`), `note?`, `status` (`new|seen|watched|dismissed`), `notifiedAt?`
  (set once the suggestion has been included in a digest email — keeps digests idempotent).
- **TitleCache** — keyed by `imdbId`: cached `name`, `poster`, `background`, `description`,
  `releaseInfo`. Populated at search time and on metadata lookups so the UI/addon avoid
  repeated TMDB calls.

---

## Authentication flow (magic link)

```
Browser (SPA)            Server                         Email
   │  POST /api/auth/request {email}                      │
   ├─────────────────────────►  create/find user          │
   │                            create LoginToken          │
   │                            sendEmail(verify link) ───►│
   │  ◄── {ok:true} (always, to not leak existence)        │
   │                                                       │
   │  GET /api/auth/verify?token=…                         │
   ├─────────────────────────►  consume token (one-shot)   │
   │  ◄── 302 /configure + httpOnly session cookie (JWT)   │
```

- Session is a **stateless JWT** signed with `JWT_SECRET`, stored in the
  `cinepals_session` cookie (`httpOnly`, `sameSite=lax`, `secure` in prod), TTL 30 days.
- `requireAuth` (`middleware/auth.ts`) verifies the cookie and sets `req.user`.
- Magic-link tokens expire after 15 minutes and are single-use.

---

## Stremio addon flow

Each user has a personal, secret `addonToken` embedded in their addon URL
(`/u/:token/manifest.json`). Stremio fetches:

1. **manifest** — dynamic; includes aggregate "from friends" catalogs (movie/series)
   plus one catalog per friend. Marked `configurable` so Stremio's Configure button
   opens `/u/:token/configure` (the SPA).
2. **catalog** — built from the user's received, non-dismissed suggestions of that type
   (optionally filtered by friend or search term). Empty + no friends → a "popular titles"
   welcome catalog. Each title's metadata is resolved via `getMetaByImdbId` (TitleCache → TMDB).
3. **meta** — title detail by IMDb id.

The addon URL is per-user and secret (it carries the token), so it is shared by URL,
not published to Stremio's central addon directory.

---

## Notifications (daily digest)

Suggestions are **not** emailed one-by-one. Instead a single **daily digest** is sent
to each recipient bundling all of their pending suggestions:

1. `createSuggestion` just stores the row (with `notifiedAt = null`).
2. `sendDailyDigests()` finds all un-notified, non-dismissed suggestions, groups them by
   recipient, sends **one email each** (titles resolved via the cache), and stamps
   `notifiedAt`. It's idempotent — a re-run sends nothing new, and a failed send is
   retried next time.
3. It's triggered by `POST /internal/run-digest` (guarded by a `CRON_SECRET` bearer
   token), called daily by the GitHub Actions workflow
   [`.github/workflows/digest.yml`](../.github/workflows/digest.yml) at **18:00
   Europe/Rome** (it fires at 16:00 & 17:00 UTC and gates on the Rome hour to stay correct
   across DST). The app on Render's free tier sleeps when idle, so an external scheduler
   pinging the endpoint is more reliable than an in-process cron.

---

Next: [Configuration](03-configuration.md) · [API Reference](04-api-reference.md)
