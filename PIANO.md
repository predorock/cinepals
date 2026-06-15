# Cinepals — Technical Plan

A Stremio addon that lets users add each other as friends by email, recommend movies to each other, and see the suggestions they receive as catalogs inside Stremio.

---

## 1. How Stremio addons work (and why a backend is needed)

A Stremio addon **is not an installed app**: it's a **stateless HTTP service** that exposes a `manifest.json` and responds to requests at well-defined URLs. Stremio queries these URLs and displays the results. Key concepts:

- **Manifest** (`/manifest.json`): a JSON document declaring what the addon does (resources, content types, catalogs).
- **Resources**: `catalog`, `meta`, `stream`, `subtitles`. We'll mainly use `catalog` and `meta`.
- **Handlers**: functions that respond to requests. `defineCatalogHandler` for catalogs (the lists), `defineMetaHandler` for the details of a title.
- **Technical requirements**: HTTPS mandatory (except for `127.0.0.1`), CORS enabled. The addon SDK apps are Node.js apps.

**The central problem:** Stremio **does not pass the user's identity** to the addon. All requests are anonymous. So a "pure" addon cannot know *who* is requesting the catalog, and therefore cannot show "the movies your friends suggested to you".

**The solution (official pattern):** embed a **user token in the addon's URL**. Instead of the standard URL `https://domain.com/manifest.json`, each user installs a personalized URL:

```
https://cinepals.onrender.com/u/{TOKEN}/manifest.json
```

The `TOKEN` identifies the user. When Stremio calls the catalog, the URL becomes `.../u/{TOKEN}/catalog/movie/friends-suggestions.json`, and the backend uses the token to figure out who the user is and return their suggestions. This, combined with a database and an email-based identity, is what makes the "friends" feature possible.

Sources at the bottom of the document.

---

## 2. System architecture

Three components that live in the same Node/Express process on Render:

```
┌─────────────────────────────────────────────────────────────┐
│                     Cinepals (Node + TS)              │
│                                                              │
│   ┌──────────────┐   ┌──────────────┐   ┌────────────────┐   │
│   │ Stremio Addon│   │   REST API   │   │  Web /configure│   │
│   │ /u/:token/*  │   │  /api/*      │   │  (login, friends,│ │
│   │ manifest,    │   │ (auth, friends,│ │   suggestions) │   │
│   │ catalog, meta│   │ suggestions) │   │   HTML page    │   │
│   └──────┬───────┘   └──────┬───────┘   └───────┬────────┘   │
│          └──────────────────┼───────────────────┘            │
│                             ▼                                │
│                    ┌─────────────────┐                       │
│                    │  Service layer  │ (domain logic)        │
│                    └────────┬────────┘                       │
│                             ▼                                │
│                    ┌─────────────────┐                       │
│                    │   PostgreSQL    │  (Render Postgres)    │
│                    └─────────────────┘                       │
│                                                              │
│        External services: TMDB (movie metadata), SMTP (email)│
└─────────────────────────────────────────────────────────────┘
```

1. **Stremio Addon** (`/u/:token/*`): speaks the Stremio protocol. Exposes the manifest, catalogs, and metadata personalized based on the token.
2. **REST API** (`/api/*`): used by the configuration web page for login, friend management, and sending suggestions.
3. **`/configure` web page**: interface where the user logs in, adds friends, sends suggestions, and copies the personalized URL to install in Stremio.

Movie metadata (poster, plot, year) come from **TMDB**. We'll use the standard **IMDb** IDs (`tt…`) as the title key, so the metadata stays compatible with the rest of the Stremio ecosystem and with the user's streaming addons.

---

## 3. Technology stack

| Layer | Choice | Notes |
|---|---|---|
| Language | **Node.js + TypeScript** | Types over manifest, DB schema, and API |
| Web framework | **Express** | Compatible with the addon SDK's `getRouter` |
| Addon | **stremio-addon-sdk** | `getRouter()` to mount the addon under `/u/:token` |
| Database | **PostgreSQL** (Render) | Relational: users, friendships, suggestions |
| DB access | **Prisma** (or Kysely) | Migrations + type-safety |
| Auth | **Email magic-link** + JWT/session | No passwords to manage |
| Movie metadata | **TMDB API** | Search + details; mapping to IMDb IDs |
| Email | **SMTP / Resend / Postmark** | Sending magic-links and notifications |
| Hosting | **Render** (Web Service + Postgres) | Automatic HTTPS, env vars |
| Validation | **Zod** | API input validation |

> Note on the SDK: the `stremio-addon-sdk` is designed for stateless addons. For per-user data we'll use `getRouter()`, mounting the addon on a route with a parameter (`/u/:token`), or we'll build the handlers manually with Express following the protocol. Both approaches are documented (the SDK's "Advanced Usage"). The plan assumes `getRouter` with the token in the path.

---

## 4. Data model (PostgreSQL)

```sql
-- Users identified by email
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT UNIQUE NOT NULL,        -- case-insensitive
  display_name  TEXT,
  addon_token   TEXT UNIQUE NOT NULL,          -- token in the addon URL
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Magic-link for email login
CREATE TABLE login_tokens (
  token       TEXT PRIMARY KEY,                -- random, single-use
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

-- Friendships: request -> acceptance (directed relationship + status)
CREATE TABLE friendships (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | declined | blocked
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at  TIMESTAMPTZ,
  UNIQUE (requester_id, addressee_id),
  CHECK (requester_id <> addressee_id)
);

-- Movie suggestions from one friend to another
CREATE TABLE suggestions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  imdb_id       TEXT NOT NULL,                 -- e.g. "tt0133093"
  content_type  TEXT NOT NULL DEFAULT 'movie', -- movie | series
  note          TEXT,                          -- optional message
  status        TEXT NOT NULL DEFAULT 'new',   -- new | seen | watched | dismissed
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (from_user_id, to_user_id, imdb_id)   -- no duplicates
);

-- Movie metadata cache (to avoid calling TMDB every time)
CREATE TABLE title_cache (
  imdb_id     TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  name        TEXT NOT NULL,
  poster      TEXT,
  background   TEXT,
  description TEXT,
  release_info TEXT,
  cached_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Useful indexes: `friendships(addressee_id, status)`, `suggestions(to_user_id, status)`, `suggestions(from_user_id)`.

**Friendship rule:** two users are friends if there is a `friendships` row with `status = 'accepted'` between them (in either direction). Only friends can send suggestions to each other.

---

## 5. REST API (used by the /configure page)

All under `/api`, authenticated via the session/JWT obtained with the magic-link.

**Authentication**
- `POST /api/auth/request` — body `{ email }`. Creates the user if they don't exist, generates a `login_token`, sends the email with the magic-link.
- `GET  /api/auth/verify?token=…` — validates the magic-link, opens the session, redirects to `/configure`.
- `POST /api/auth/logout`
- `GET  /api/me` — profile + `addon_token` + full URL to install.

**Friends**
- `GET  /api/friends` — list of accepted friends.
- `GET  /api/friends/requests` — pending incoming/outgoing requests.
- `POST /api/friends/request` — body `{ email }`. Creates a friend request; sends a notification/invite email (even if the friend is not yet registered → creates a "shadow" user and invites them).
- `POST /api/friends/:id/accept`
- `POST /api/friends/:id/decline`
- `DELETE /api/friends/:id` — removes a friendship.

**Suggestions**
- `GET  /api/suggestions/received` — movies suggested to me (with status).
- `GET  /api/suggestions/sent` — movies I've suggested.
- `POST /api/suggestions` — body `{ toUserId, imdbId, note }`. Creates a suggestion; notifies via email.
- `PATCH /api/suggestions/:id` — body `{ status }` (`watched` / `dismissed`).
- `GET  /api/search?q=…` — proxy to TMDB to search for the movie to suggest (returns title, year, poster, imdbId).

Input validation with Zod; rate-limit on `auth/request` and `friends/request` to avoid email spam.

---

## 6. Stremio addon components

### 6.1 Manifest (`/u/:token/manifest.json`)

```jsonc
{
  "id": "com.cinepals.addon",
  "version": "1.0.0",
  "name": "Cinepals",
  "description": "Movies and series suggested by your friends",
  "logo": "https://cinepals.onrender.com/logo.png",
  "resources": ["catalog", "meta"],
  "types": ["movie", "series"],
  "catalogs": [
    {
      "type": "movie",
      "id": "friends-suggestions-movie",
      "name": "Suggested by friends",
      "extra": [{ "name": "search", "isRequired": false }]
    },
    {
      "type": "series",
      "id": "friends-suggestions-series",
      "name": "Series from friends"
    }
  ],
  "behaviorHints": {
    "configurable": true,
    "configurationRequired": true
  }
}
```

- `configurationRequired: true` → installing without a token, Stremio sends the user to the `/configure` page to log in and get the personalized URL.
- The manifest is generated **based on the token**: you can create separate catalogs per friend (e.g. "Suggested by Luca", "Suggested by Anna") by reading the friends from the DB.

### 6.2 Catalog handler

When Stremio calls `/u/:token/catalog/movie/friends-suggestions-movie.json`:

1. Resolve `token → user`. If invalid, return an empty catalog.
2. Query: `suggestions` where `to_user_id = user.id`, type `movie`, status ≠ `dismissed`, ordered by date.
3. For each `imdb_id`, fetch the metadata from `title_cache` (or TMDB if absent) and build the `meta` preview objects:

```ts
{
  id: "tt0133093",
  type: "movie",
  name: "The Matrix",
  poster: "https://image.tmdb.org/.../poster.jpg",
  description: "Suggested by Luca: \"a must-watch\""
}
```

4. Return `{ metas: [...] }`.

**Appearing in a list** = exactly this: the suggested movies show up as a dedicated catalog on the home screen and in Stremio's Discover section, with posters and a note from whoever recommended them.

### 6.3 Meta handler

`/u/:token/meta/movie/tt0133093.json` → returns the title's full metadata (from cache/TMDB). The actual streaming is delegated to the streaming addons the user already has installed: we only provide the *curated list* with standard IMDb IDs, so Stremio's play buttons work with the other addons.

---

## 7. Main user flows

**Onboarding**
1. The user installs the addon (or opens the `/configure` page).
2. They enter their email → receive a magic-link → click → they're logged in.
3. The page shows their **personalized addon URL** with an "Install in Stremio" button (deep-link `stremio://…`).

**Adding a friend**
1. On the page, they enter the friend's email.
2. The backend creates the request. If the friend is registered → notification via email. If not → invitation email to sign up.
3. The friend accepts from their own `/configure` page. Now they're friends.

**Suggesting a movie**
1. The user searches for a movie (search → TMDB), picks the recipient friend, adds a note.
2. The suggestion is saved and the friend receives an email notification.

**Receiving and viewing suggestions**
1. In the friend's Stremio client, the "Suggested by friends" catalog populates automatically (Stremio re-queries the addon).
2. The friend opens the title, watches it with their streaming addons, and can mark it `watched`/`dismissed` from the web page.

---

## 8. Security and privacy

- **Addon token** = secret: whoever has the URL sees your suggestions. Long, random token (≥128 bits); ability to **regenerate it** (revoking the old URL).
- **Magic-link**: single-use, short expiration (e.g. 15 min).
- **Suggestion authorization**: you can suggest **only to accepted friends** (server-side check).
- **Anti-spam**: rate-limit on email sending (friend requests, magic-links).
- **CORS**: open on the addon routes (required by Stremio), restricted on the `/api` routes.
- **GDPR**: since emails are processed, provide for account deletion (`DELETE /api/me`) and data export.
- **Email privacy**: don't reveal whether an email is registered in response to friend requests (always respond with a generic success).

---

## 9. Deploy on Render

- **Web Service**: build `pnpm run build` (tsc), start `node dist/server.js`. Render provides automatic HTTPS → Stremio requirement satisfied.
- **Render PostgreSQL**: managed instance; `DATABASE_URL` in the env vars.
- **Environment variables**: `DATABASE_URL`, `TMDB_API_KEY`, `JWT_SECRET`, `SMTP_*` (or `RESEND_API_KEY`), `PUBLIC_URL` (to build the addon URLs and magic-links).
- **Migrations**: `prisma migrate deploy` as the pre-deploy/release command.
- **Health check**: `/health` route.
- **Publishing**: the addon stays private (installation via personalized URL). It should NOT be published on Addon Central, because the URL contains the user token and the catalog is per-user.

---

## 10. Phased roadmap

**Phase 0 — Setup (half a day)**
Repo, TypeScript, Express, Prisma, connection to a local Postgres (Docker), initial schema, `/health` route. Deploy a "hello world" on Render.

**Phase 1 — Basic stateless addon (1–2 days)**
Manifest + catalog handler that returns a **hardcoded** list of movies via TMDB. Verify that the addon installs and the posters appear in Stremio. *Goal: validate the protocol before adding the complexity of users.*

**Phase 2 — Identity and token (1–2 days)**
`users` table, magic-link via email, sessions, a minimal `/configure` page that shows the personalized URL `/u/:token/manifest.json`. The catalog handler reads the token (still an empty/demo list).

**Phase 3 — Friends (2 days)**
API and UI to request/accept/remove friends, email invites, management of pending requests.

**Phase 4 — Suggestions (2 days)**
Movie search (TMDB), sending suggestions to friends, email notifications, statuses (`watched`/`dismissed`). The catalog handler now returns the user's real suggestions. Metadata cache.

**Phase 5 — Polish (1–2 days)**
Per-friend catalogs, token regeneration, account deletion, rate-limit, error handling, logo, a polished configure page, `stremio://` deep-link.

**Phase 6 — Testing and verification**
End-to-end test with two real accounts (two emails), verifying that A suggests → B sees the movie in the list in Stremio. Test handlers with the `stremio-addon-sdk` linter/validator.

Rough total estimate: ~2 weeks of part-time development for a working MVP.

---

## 11. Risks and open decisions

- **The SDK and per-user data**: `stremio-addon-sdk` is optimized for stateless addons. If `getRouter` with the token in the path turns out to be awkward, the alternative is implementing the protocol endpoints directly in Express (documented as "usage without the SDK"). To be validated in Phase 1–2.
- **Catalog updates**: Stremio caches catalogs; a new suggestion might not appear instantly. Mitigation: short cache headers (`cacheMaxAge` low in the manifest/handler).
- **TMDB → IMDb mapping**: TMDB's `external_ids` is needed to get the `tt…`. Handle titles without an IMDb ID.
- **Email deliverability**: use a transactional provider (Resend/Postmark) to avoid the spam folder; configure SPF/DKIM.
- **Scalability**: Render's free tier goes to sleep after inactivity → slow first load. For real-world use, consider the paid plan.

---

## Sources

- [stremio-addon-sdk (GitHub)](https://github.com/Stremio/stremio-addon-sdk)
- [Getting Started](https://stremio.github.io/stremio-addon-sdk/)
- [Manifest format](https://stremio.github.io/stremio-addon-sdk/api/responses/manifest.html)
- [Advanced Usage — user data in the URL](https://stremio.github.io/stremio-addon-sdk/advanced.html)
- [Example addon protected with a key](https://github.com/Stremio/stremio-addon-with-key)
- [Deploying](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/deploying/README.md)
- [Addon Protocol & Manifests (DeepWiki)](https://deepwiki.com/Stremio/stremio-web/7.2-addon-protocol-and-manifests)
