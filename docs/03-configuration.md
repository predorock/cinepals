# 03 — Configuration

All runtime configuration is read from environment variables and centralized in
[`src/config.ts`](../src/config.ts). Locally, variables live in `.env.local`
(template: [`.env.example`](../.env.example)); in production they are set on the host
(Render — see [Deployment](05-deployment.md)).

---

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | no | `8990` | HTTP port the server listens on. |
| `NODE_ENV` | no | `development` | `production` enables secure cookies, error-only DB logs, and the strict magic-link rate limit. |
| `PUBLIC_URL` | recommended | `http://127.0.0.1:8990` | Public base URL. Used to build magic-links and the personal addon URLs. **`https` is forced for any non-local host**; `localhost`/`127.0.0.1` stay on `http`. Trailing slash is stripped. |
| `DATABASE_URL` | **yes** | — | PostgreSQL connection string. |
| `JWT_SECRET` | **yes** (prod) | `dev-insecure-secret` | Secret used to sign session JWTs. Set a long random value in production. |
| `TMDB_API_KEY` | for search | — | TMDB v3 API key. Without it, search/metadata fall back to a small curated list and log a warning. |
| `RESEND_API_KEY` | for real email | — | Resend API key. When set, transactional email is sent via the Resend HTTP API. |
| `SMTP_URL` | dev email | — | SMTP URL (e.g. `smtp://127.0.0.1:1025` for Mailpit). Used only when `RESEND_API_KEY` is empty. |
| `EMAIL_FROM` | no | `Cinepals <noreply@example.com>` | From address/name for outgoing email. |
| `MAILPIT_URL` | tests only | `http://127.0.0.1:8025` | Mailpit REST base used by the e2e suite to read magic-links. |

> Values not visible in the source are marked `[TO VERIFY]`. None apply here — every
> variable above is read in `src/config.ts`, `src/lib/email.ts`, or `playwright.config.ts`.

---

## Email provider precedence

`sendEmail` ([`src/lib/email.ts`](../src/lib/email.ts)) picks a transport in this order:

1. **`RESEND_API_KEY` set** → send via the Resend HTTP API (production path).
2. **else `SMTP_URL` set** → send via SMTP (local Mailpit/MailHog trap).
3. **else** → print the message (including magic-link) to the server console.

This means local development needs no email credentials: links land in Mailpit or the console.

---

## Internal (non-env) constants

Also defined in `src/config.ts`, not configurable via environment:

| Constant | Value | Meaning |
|----------|-------|---------|
| `sessionCookieName` | `cinepals_session` | Name of the session cookie. |
| `sessionTtlDays` | `30` | Session lifetime. |
| `magicLinkTtlMinutes` | `15` | Magic-link validity window (single use). |

---

## Config files

| File | Purpose |
|------|---------|
| [`.env.example`](../.env.example) | Template for `.env.local`. |
| [`docker-compose.yml`](../docker-compose.yml) | Local Postgres + app + Mailpit + Adminer. |
| [`Dockerfile.dev`](../Dockerfile.dev) | Dev image (Node 22 Alpine) used by Compose. |
| [`render.yaml`](../render.yaml) | Render Blueprint: web service + Postgres, env var declarations. |
| [`prisma/schema.prisma`](../prisma/schema.prisma) | Data model + `DATABASE_URL` datasource. |
| [`tsconfig.json`](../tsconfig.json) | TypeScript config (compiles `src/**` to `dist/`). |
| [`playwright.config.ts`](../playwright.config.ts) | E2E config; loads `.env.local`, forces the dev profile. |

---

Next: [API Reference](04-api-reference.md) · [Deployment](05-deployment.md)
