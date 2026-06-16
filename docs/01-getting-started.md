# 01 — Getting Started

Cinepals is a [Stremio](https://www.stremio.com/) addon: you add friends by email
and recommend movies and series to each other. Each user gets a personal addon URL
whose catalogs are built from the suggestions their friends sent them.

This guide covers prerequisites, installation, and running the project locally —
both with Docker (recommended) and without.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | `22` (LTS) | Pinned via [`.node-version`](../.node-version); `package.json` `engines` allows `>=18`. |
| pnpm | `10.24.0` | The repo pins it through `packageManager`; use `corepack` (`corepack enable` or `corepack pnpm …`). |
| PostgreSQL | `16` | Provided by Docker Compose; or use any reachable Postgres 16 instance. |
| Docker + Docker Compose | recent | Optional but recommended — runs Postgres, the mail trap, and Adminer. |
| [`just`](https://github.com/casey/just) | recent | Optional task runner; every command has a raw equivalent. |
| TMDB API key (v3) | — | Needed for live search/metadata. Free at <https://www.themoviedb.org/settings/api>. Without it a small curated fallback list is used. |

External services:

- **TMDB** — movie/series metadata and posters.
- **Resend** (production) / **Mailpit** (local) — transactional email for magic-link sign-in and notifications. See [Configuration](03-configuration.md).

---

## Installation

```bash
# 1. Install dependencies (pnpm via corepack)
corepack pnpm install

# 2. Create your local env file from the template
cp .env.example .env.local
#   then set TMDB_API_KEY (and adjust DATABASE_URL if not using the Docker DB)
```

With `just`, steps 1–2 plus the database are bundled:

```bash
just setup   # install + create .env.local + start Postgres + sync schema
```

> `just` loads `.env.local` automatically for every recipe (`set dotenv-load`).
> Without `just`, export the variables yourself or run Node with `--env-file=.env.local`.

---

## First run

### With Docker (recommended)

Starts Postgres, the app with hot-reload, the Mailpit mail trap, and Adminer:

```bash
just dev          # db + mail trap + tsx watch
# or the full stack in containers:
docker compose up
```

Then open:

- App / configure page → <http://127.0.0.1:8990/configure>
- Mailpit inbox (catches sign-in emails) → <http://127.0.0.1:8025>
- Adminer (DB UI) → <http://127.0.0.1:8080> (server `db`, user/pass `postgres`, db `cinepals`)

### Without Docker

```bash
# Point DATABASE_URL at a running Postgres 16, then sync the schema:
corepack pnpm exec prisma db push

# Start the dev server (hot-reload):
corepack pnpm dev          # → http://127.0.0.1:8990
```

### Sign in (magic link)

1. Open <http://127.0.0.1:8990/configure> and enter any email.
2. The sign-in link is **not** sent for real in local dev: open the Mailpit inbox
   (<http://127.0.0.1:8025>) and click the link. If no mail trap is configured,
   the link is printed to the server console instead.
3. You land on the dashboard, where you can set a display name, add friends,
   search titles, send suggestions, and copy your personal Stremio addon URL.

### Seed demo data (optional)

```bash
just seed                 # seeds demo@example.com
just seed you@email.com   # seed a specific account with fake friends + suggestions
```

---

Next: [Architecture](02-architecture.md) · [Configuration](03-configuration.md)
