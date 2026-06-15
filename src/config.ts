// Centralized configuration read from environment variables.
// Locally loads .env if present (dotenv dependency not required: use --env-file or the Render environment).

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    // We don't throw at import-time to avoid breaking prisma generate / typecheck.
    return "";
  }
  return v;
}

export const config = {
  port: parseInt(process.env.PORT ?? "8990", 10),
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProd: (process.env.NODE_ENV ?? "development") === "production",
  publicUrl: (process.env.PUBLIC_URL ?? "http://127.0.0.1:8990").replace(/\/$/, ""),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET", "dev-insecure-secret"),
  tmdbApiKey: required("TMDB_API_KEY"),
  resendApiKey: required("RESEND_API_KEY"),
  emailFrom: process.env.EMAIL_FROM ?? "Stremio Friends <noreply@example.com>",
  sessionCookieName: "sf_session",
  sessionTtlDays: 30,
  magicLinkTtlMinutes: 15,
};

export type AppConfig = typeof config;
