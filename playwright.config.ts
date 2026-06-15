import { defineConfig, devices } from "@playwright/test";
import fs from "fs";
import path from "path";

// Load .env.local (the dev/test env: local Postgres, Mailpit, TMDB key) into
// process.env so both Playwright and the app server started by `webServer` see
// it. We parse it by hand to avoid adding a dotenv dependency.
function loadEnv(file: string): void {
  const full = path.resolve(__dirname, file);
  if (!fs.existsSync(full)) return;
  for (const raw of fs.readFileSync(full, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip surrounding single or double quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadEnv(".env.local");

// Force the dev profile for tests: relaxes the magic-link rate limit and keeps
// emails going to the Mailpit trap rather than a real provider.
process.env.NODE_ENV = "development";
process.env.PUBLIC_URL = "http://127.0.0.1:8990";
delete process.env.RESEND_API_KEY; // ensure SMTP/Mailpit path, never a real send

const PORT = process.env.PORT ?? "8990";
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Mailpit REST API base — used by tests to read magic-link/invite emails.
export const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";

export default defineConfig({
  testDir: "./e2e",
  // Flows mutate shared server state (friendships/suggestions); keep runs
  // deterministic with a single worker. Each test still uses unique emails.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "pnpm exec tsx src/server.ts",
    url: `${BASE_URL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
