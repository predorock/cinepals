# Cinepals

> A Stremio addon where you add friends by email and recommend movies & series to each other — each user gets a personal catalog built from their friends' suggestions.

[![CI](https://github.com/predorock/cinepals/actions/workflows/ci.yml/badge.svg)](https://github.com/predorock/cinepals/actions/workflows/ci.yml)
![version](https://img.shields.io/badge/version-1.0.0-blue)
![node](https://img.shields.io/badge/node-22-339933?logo=node.js&logoColor=white)
![license](https://img.shields.io/badge/license-MIT-green)

---

## Requirements

Node.js 22, pnpm 10 (via corepack), and PostgreSQL 16 (Docker Compose provides it).
A TMDB v3 API key is needed for live search/metadata; email uses Resend in production
and a local Mailpit trap in development.

→ [Full requirements](docs/01-getting-started.md#prerequisites)

## Installation

```bash
corepack pnpm install
cp .env.example .env.local   # then set TMDB_API_KEY (and DATABASE_URL if not using Docker)
```

→ [Complete installation guide](docs/01-getting-started.md#installation)

## Quick Start

```bash
just dev    # Postgres + Mailpit + hot-reload server
# open http://127.0.0.1:8990/configure, sign in (link lands in Mailpit at :8025)
```

→ [Step-by-step tutorial](docs/01-getting-started.md#first-run)

## Architecture

One Express/TypeScript service serves a REST API (`/api/*`) for the configure-page SPA,
the Stremio addon protocol (`/u/:token/*`), and the static SPA itself. State is in
PostgreSQL via Prisma; title metadata comes from TMDB and is cached. Auth is a magic-link
email flow with a stateless JWT session cookie. Friends' suggestions are emailed as a
single **daily digest** at 18:00 Europe/Rome (a scheduled workflow pings a token-protected
endpoint).

→ [Detailed architecture](docs/02-architecture.md)

## Configuration

Key variables: `DATABASE_URL` (required), `JWT_SECRET`, `PUBLIC_URL`
(default `http://127.0.0.1:8990`), `TMDB_API_KEY`, email vars
(`RESEND_API_KEY` / `SMTP_URL` / `EMAIL_FROM`), and `CRON_SECRET` (guards the digest job).

→ [Full configuration reference](docs/03-configuration.md)

## API

REST API under `/api/*` (cookie-authenticated) and the Stremio protocol under `/u/:token/*`.

```bash
curl -X POST http://127.0.0.1:8990/api/auth/request \
  -H 'Content-Type: application/json' -d '{"email":"you@example.com"}'
```

→ [Full API reference](docs/04-api-reference.md)

## Deployment

Deploys to Render via [`render.yaml`](render.yaml) (web service + Postgres). Any host works:

```bash
corepack pnpm run build && node dist/server.js
```

→ [Deployment guide](docs/05-deployment.md)

## Testing

End-to-end tests with Playwright drive the real SPA and read magic-links from Mailpit.

```bash
just test
```

→ [Testing guide](docs/07-testing.md)

## Contributing

Branch off `main`, run `pnpm run typecheck`, `pnpm run build`, and `just test`, then open a PR.

→ [Contributor guidelines](docs/06-contributing.md)

## License

[MIT](LICENSE)
