# 06 — Contributing

Thanks for helping improve Cinepals. This document covers the local workflow,
conventions, and checks expected before opening a pull request.

---

## Local setup

See [Getting Started](01-getting-started.md). The fastest path:

```bash
just setup    # deps + .env.local + Postgres + schema
just dev      # run with hot-reload + mail trap
```

---

## Before you open a PR

Run the checks locally — they must pass:

```bash
corepack pnpm run typecheck   # tsc --noEmit
corepack pnpm run build       # prisma generate && tsc
just test                     # Playwright e2e suite (see 07-testing.md)
```

`just predeploy` runs typecheck + build together.

---

## Conventions

- **Language:** TypeScript, strict mode. Match the surrounding style — small focused
  functions, route → service → Prisma layering, Zod for input validation at the route edge.
- **Comments:** explain *why*, not *what*; keep the existing density.
- **Validation:** never trust request input — parse it with a Zod schema in the route.
- **Secrets:** never commit real keys. `.env.local` is gitignored; use `.env.example`
  for new variables and document them in [Configuration](03-configuration.md).
- **Database changes:** edit `prisma/schema.prisma`, then `just push` locally. If the
  project adopts migration files, generate one with `prisma migrate dev`.

---

## Branching & commits

- `main` is the deploy branch — pushing to it triggers a production deploy on Render.
  Prefer a feature branch + PR; avoid committing directly to `main` for non-trivial work.
- Write clear, imperative commit subjects (e.g. `friends: fix accept ("request not found")`),
  with a body explaining the rationale when the change isn't obvious.
- Keep PRs focused; update the relevant `docs/` file when behavior or config changes.

---

## Adding features safely

- **New API endpoint** → add the route (with Zod), put logic in a service, and add an
  e2e spec covering the flow.
- **New env var** → read it in `src/config.ts`, add it to `.env.example` and
  [Configuration](03-configuration.md), and to `render.yaml` if it's needed in production.
- **Frontend change** → the SPA is `public/app.js` (vanilla JS); keep API field names in
  sync with the service DTOs (a past bug came from a frontend/DTO mismatch).

---

Next: [Testing](07-testing.md)
