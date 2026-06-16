# 04 — API Reference

Two surfaces:

- **REST API** under `/api/*` — JSON, used by the configure-page SPA. Authenticated
  endpoints use the `cinepals_session` httpOnly cookie (set by the magic-link flow).
- **Stremio addon protocol** under `/u/:token/*` — public JSON consumed by Stremio
  clients; CORS is fully open as the protocol requires.

Base URL: `PUBLIC_URL` (locally `http://127.0.0.1:8990`).

---

## Conventions

- Request/response bodies are JSON. Inputs are validated with Zod; invalid input → `400 {"error":"invalid input"}`.
- Authenticated endpoints return `401 {"error":"not authenticated"}` without a valid session cookie.
- Auth endpoints that could leak account existence intentionally return a generic `{"ok":true}`.

---

## Health

```http
GET /health  →  200 {"status":"ok"}
```

## Auth — `/api/auth`

| Method | Path | Auth | Body / Query | Response |
|--------|------|------|--------------|----------|
| POST | `/request` | — | `{ "email": string }` | `{ "ok": true }` (always; sends magic-link email). Rate-limited: 5/15min per IP in production. |
| GET | `/verify` | — | `?token=…` | `302` → `/configure`, sets session cookie. Invalid → `302 /configure?error=invalid_link`. |
| GET | `/me` | ✓ | — | `{ id, email, displayName, addonToken, addonUrl, manifestUrl, installUrl }` |
| PATCH | `/me` | ✓ | `{ "displayName": string \| null }` (≤60 chars) | `{ id, email, displayName }` |
| POST | `/me/regenerate-token` | ✓ | — | `{ addonToken, manifestUrl }` (old addon URL stops working) |
| DELETE | `/me` | ✓ | — | `{ ok: true }` (deletes account, clears session) |
| POST | `/logout` | — | — | `{ ok: true }` |
| GET | `/addon-info/:token` | — | — | `{ email, displayName }` for the addon's owner, or `404`. |

Example — request a magic link:

```bash
curl -X POST http://127.0.0.1:8990/api/auth/request \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com"}'
# → {"ok":true}   (open the link from Mailpit / the server console in dev)
```

## Friends — `/api/friends` (all require auth)

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/` | — | `{ friends: [{ id, email, displayName }] }` |
| GET | `/requests` | — | `{ incoming: PendingRequest[], outgoing: PendingRequest[] }` |
| POST | `/request` | `{ "email": string }` | `{ status: "sent" \| "already_friends" \| "already_pending" \| "self" }` |
| POST | `/:id/accept` | — | `{ ok: true }` or `404 {"error":"request not found"}` |
| POST | `/:id/decline` | — | `{ ok: true }` or `404` |
| DELETE | `/:otherUserId` | — | `{ ok: true }` (removes friendship both directions) |

`PendingRequest` shape: `{ friendshipId, user: { id, email, displayName }, createdAt }`.
Inviting an unknown email creates a "shadow" user and emails them an invite.

## Suggestions — `/api/suggestions` (all require auth)

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/received` | — | `{ suggestions: [...] }` — non-dismissed, newest first, with `fromUser` + resolved `name`/`poster`/`year`. |
| GET | `/sent` | — | `{ suggestions: [...] }` — with `toUser` + resolved title fields. |
| POST | `/` | `{ toUserId, imdbId, contentType?, note? }` | `{ status: "created" \| "not_friends" \| "duplicate" \| "self" }` |
| PATCH | `/:id` | `{ status: "seen" \| "watched" \| "dismissed" }` | `{ ok: true }` or `404` |

- `contentType` ∈ `movie` (default) \| `series`; `note` ≤ 500 chars.
- You can only suggest to an accepted friend; the `(fromUser, toUser, imdbId)` triple is unique.

## Search — `/api/search` (requires auth)

```http
GET /api/search?q=<query>&type=movie|series
```

Returns TMDB results resolved to IMDb ids (titles without an IMDb id are dropped, as
Stremio requires them). Results are cached in `title_cache` on first lookup.

```jsonc
// → 200
{ "results": [
  { "imdbId": "tt1375666", "type": "movie", "name": "Inception",
    "year": "2010", "poster": "https://image.tmdb.org/...", "description": "…" }
]}
```

---

## Stremio addon protocol — `/u/:token`

`:token` is the user's secret `addonToken`. All responses are JSON with open CORS.

| Method | Path | Response |
|--------|------|----------|
| GET | `/manifest.json` | Addon manifest (`id`, `version`, `name`, `resources: ["catalog","meta"]`, `types`, dynamic `catalogs`, `behaviorHints.configurable`). |
| GET | `/catalog/:type/:id.json` | `{ metas: StremioMetaPreview[] }` for the friend/aggregate catalog. |
| GET | `/catalog/:type/:id/:extra.json` | Same, with a `search=<q>` filter encoded in `:extra`. |
| GET | `/meta/:type/:id.json` | `{ meta: StremioMeta \| null }` — title detail by IMDb id. |
| GET | `/configure` | Serves the SPA (Stremio's Configure button target). |

Catalog ids: `cinepals-friends` (aggregate) and `cinepals-friend-<friendId>` (per friend).
`:type` ∈ `movie` \| `series`. Example:

```bash
curl http://127.0.0.1:8990/u/<addonToken>/manifest.json
curl http://127.0.0.1:8990/u/<addonToken>/catalog/movie/cinepals-friends.json
```

---

Next: [Deployment](05-deployment.md) · [Contributing](06-contributing.md)
