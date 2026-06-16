// Centralized configuration read from environment variables.
// Locally loads .env if present (dotenv dependency not required: use --env-file or the Render environment).

// App version, read from package.json so the Stremio manifest always reports the
// same version. "../package.json" resolves under the repo root from both src/
// (tsx) and dist/ (compiled output) since those dirs are siblings of the root.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require("../package.json") as { version: string };

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    // We don't throw at import-time to avoid breaking prisma generate / typecheck.
    return "";
  }
  return v;
}

// Resolves the public base URL.
// - When PUBLIC_URL points at a real (non-local) host, force https so magic-links
//   are always secure regardless of how the env var was entered (bare host or http://).
// - localhost/127.0.0.1 keep http (local dev, docker, e2e have no TLS).
// - With PUBLIC_URL unset, fall back to the local dev default over http.
function resolvePublicUrl(): string {
  const raw = process.env.PUBLIC_URL?.trim();
  if (!raw) return "http://127.0.0.1:8990";
  const withoutScheme = raw.replace(/^https?:\/\//i, "").replace(/\/$/, "");
  const host = withoutScheme.split("/")[0].split(":")[0].toLowerCase();
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0";
  return `${isLocal ? "http" : "https"}://${withoutScheme}`;
}

export const config = {
  appVersion: pkg.version,
  port: parseInt(process.env.PORT ?? "8990", 10),
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProd: (process.env.NODE_ENV ?? "development") === "production",
  publicUrl: resolvePublicUrl(),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET", "dev-insecure-secret"),
  tmdbApiKey: required("TMDB_API_KEY"),
  resendApiKey: required("RESEND_API_KEY"),
  // Local mail trap (e.g. Mailpit). Used in dev when RESEND_API_KEY is empty.
  smtpUrl: required("SMTP_URL"),
  emailFrom: process.env.EMAIL_FROM ?? "Cinepals <noreply@example.com>",
  // Bearer token guarding the internal digest trigger (POST /internal/run-digest).
  cronSecret: required("CRON_SECRET"),
  sessionCookieName: "cinepals_session",
  sessionTtlDays: 30,
  magicLinkTtlMinutes: 15,
};

export type AppConfig = typeof config;
