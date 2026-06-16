import { Router, type Request, type Response } from "express";
import { timingSafeEqual } from "crypto";
import { config } from "../config";
import { sendDailyDigests } from "../services/suggestionService";

export const internalRouter = Router();

/**
 * Guards internal endpoints with a bearer token (CRON_SECRET).
 * Denies everything when CRON_SECRET is unset, so the endpoint is never open.
 */
function authorized(req: Request): boolean {
  const expected = config.cronSecret;
  if (!expected) return false;
  const header = req.header("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const provided = Buffer.from(match[1]);
  const secret = Buffer.from(expected);
  // Length check first: timingSafeEqual throws on length mismatch.
  if (provided.length !== secret.length) return false;
  return timingSafeEqual(provided, secret);
}

/**
 * POST /internal/run-digest — triggers the daily suggestion digest.
 * Called by the scheduled GitHub Actions workflow (see .github/workflows/digest.yml).
 */
internalRouter.post("/run-digest", async (req: Request, res: Response): Promise<void> => {
  if (!authorized(req)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const result = await sendDailyDigests();
    console.log(
      `Digest run: ${result.emails} email(s) to ${result.recipients} recipient(s), ${result.suggestions} suggestion(s).`,
    );
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error("run-digest failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});
