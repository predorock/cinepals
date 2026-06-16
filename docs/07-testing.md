# 07 — Testing

The project uses [Playwright](https://playwright.dev) for end-to-end tests that drive
the real SPA in a headless browser and exercise every user flow. Magic-link login is
tested for real by reading the email out of the local **Mailpit** trap — nothing is
mocked at the auth layer.

Specs live in [`e2e/`](../e2e).

---

## Running

```bash
just test                 # alias: brings up Postgres + Mailpit, syncs schema, runs the suite
just test-e2e             # same; accepts args, e.g. `just test-e2e friends` or `--headed`
just test-e2e-ui          # interactive Playwright UI

# If Postgres + Mailpit are already running:
corepack pnpm run test:e2e
corepack pnpm run test:e2e:ui
```

Playwright starts the app server itself (`webServer` in
[`playwright.config.ts`](../playwright.config.ts)), so you don't run `pnpm dev` separately.

---

## How it works

- **Env:** `playwright.config.ts` parses `.env.local` (DB, `TMDB_API_KEY`, Mailpit) and
  forces the dev profile (`NODE_ENV=development`, `PUBLIC_URL=http://127.0.0.1:8990`,
  no `RESEND_API_KEY`) so emails go to Mailpit and the magic-link rate limit is relaxed.
- **Dependencies:** the suite needs Postgres (`:5555`) and Mailpit (`:8025`) running —
  the `just` recipes start them via Docker Compose.
- **Isolation:** each test uses unique emails (`uniqueEmail()`), so runs don't collide and
  the database needs no reset between runs. The suite runs with a single worker for
  deterministic shared-state flows (friends/suggestions).
- **Magic-link:** `e2e/helpers/mailpit.ts` polls the Mailpit REST API for the sign-in
  email and extracts the verify URL; `e2e/helpers/auth.ts` performs the full login.

---

## Coverage

| Spec | Flow |
|------|------|
| `auth.spec.ts` | Magic-link login → dashboard; invalid link rejected; logout. |
| `profile.spec.ts` | Set display name → header updates → persists across reload. |
| `friends.spec.ts` | Two users: request → accept → both friends → unfriend; and decline. |
| `suggestions.spec.ts` | Real TMDB search → suggest to a friend → received/sent → mark watched; "no friends → can't suggest". |
| `addon.spec.ts` | Personal manifest + catalog respond; regenerating the token changes the URL. |
| `account.spec.ts` | Delete account → signed out (401). |

---

## Browsers

First run requires the Chromium binary:

```bash
corepack pnpm exec playwright install chromium
```

Artifacts (`test-results/`, `playwright-report/`) are gitignored.
