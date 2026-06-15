import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config";
import { requireAuth, setSession, clearSession } from "../middleware/auth";
import { requestMagicLink, consumeMagicLink } from "../services/authService";
import {
  getUserById,
  getUserByAddonToken,
  regenerateAddonToken,
  updateDisplayName,
} from "../services/userService";
import { prisma } from "../db";

export const authRouter = Router();

// Host (publicUrl without protocol) used to build the stremio:// deep-link
const PUBLIC_HOST = config.publicUrl.replace(/^https?:\/\//, "");

/** Builds the manifest/install URLs from the addonToken. */
function buildAddonUrls(addonToken: string): {
  manifestUrl: string;
  addonUrl: string;
  installUrl: string;
} {
  const manifestUrl = `${config.publicUrl}/u/${addonToken}/manifest.json`;
  return {
    manifestUrl,
    addonUrl: manifestUrl,
    installUrl: `stremio://${PUBLIC_HOST}/u/${addonToken}/manifest.json`,
  };
}

// Rate-limit for magic-link requests: max 5 requests / 15 minutes per IP.
const requestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: true },
});

const requestSchema = z.object({
  email: z.string().email(),
});

/**
 * POST /request — requests a magic-link.
 * Always responds { ok: true } so as not to reveal whether the email exists.
 */
authRouter.post("/request", requestLimiter, async (req: Request, res: Response) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid email" });
    return;
  }

  try {
    await requestMagicLink(parsed.data.email);
  } catch (err) {
    // We don't expose the error: sending the email is best-effort.
    console.error("requestMagicLink failed:", err);
  }

  res.json({ ok: true });
});

const verifySchema = z.object({
  token: z.string().min(1),
});

/**
 * GET /verify?token=... — consumes the magic-link.
 * If valid: sets the session and redirects to /configure.
 * Otherwise: redirects to /configure?error=invalid_link.
 */
authRouter.get("/verify", async (req: Request, res: Response) => {
  const parsed = verifySchema.safeParse(req.query);
  if (!parsed.success) {
    res.redirect(302, "/configure?error=invalid_link");
    return;
  }

  try {
    const user = await consumeMagicLink(parsed.data.token);
    if (!user) {
      res.redirect(302, "/configure?error=invalid_link");
      return;
    }
    setSession(res, user);
    res.redirect(302, "/configure");
  } catch (err) {
    console.error("consumeMagicLink failed:", err);
    res.redirect(302, "/configure?error=invalid_link");
  }
});

/**
 * GET /addon-info/:token — public lookup of which account an addon URL belongs to.
 * Used by the /u/:token/configure page (opened from Stremio's Configure button)
 * to show whose addon it is and pre-fill the sign-in email. The token is already
 * a personal secret embedded in the addon URL.
 */
authRouter.get("/addon-info/:token", async (req: Request, res: Response) => {
  try {
    const user = await getUserByAddonToken(req.params.token);
    if (!user) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({ email: user.email, displayName: user.displayName });
  } catch (err) {
    console.error("GET /addon-info failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});

/** POST /logout — clears the session. */
authRouter.post("/logout", (_req: Request, res: Response) => {
  clearSession(res);
  res.json({ ok: true });
});

/** GET /me — authenticated user's profile + addon URLs. */
authRouter.get("/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await getUserById(req.user!.id);
    if (!user) {
      clearSession(res);
      res.status(401).json({ error: "not authenticated" });
      return;
    }

    const urls = buildAddonUrls(user.addonToken);
    res.json({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      addonToken: user.addonToken,
      addonUrl: urls.addonUrl,
      manifestUrl: urls.manifestUrl,
      installUrl: urls.installUrl,
    });
  } catch (err) {
    console.error("GET /me failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});

const updateMeSchema = z.object({
  displayName: z.string().max(60).nullable().optional(),
});

/** PATCH /me — updates the authenticated user's profile (display name). */
authRouter.patch("/me", requireAuth, async (req: Request, res: Response) => {
  const parsed = updateMeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid input" });
    return;
  }

  try {
    const user = await updateDisplayName(req.user!.id, parsed.data.displayName ?? null);
    res.json({ id: user.id, email: user.email, displayName: user.displayName });
  } catch (err) {
    console.error("PATCH /me failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});

/** POST /me/regenerate-token — regenerates the addonToken (revokes the old URL). */
authRouter.post("/me/regenerate-token", requireAuth, async (req: Request, res: Response) => {
  try {
    const addonToken = await regenerateAddonToken(req.user!.id);
    const { manifestUrl } = buildAddonUrls(addonToken);
    res.json({ addonToken, manifestUrl });
  } catch (err) {
    console.error("POST /me/regenerate-token failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});

/** DELETE /me — deletes the account and clears the session. */
authRouter.delete("/me", requireAuth, async (req: Request, res: Response) => {
  try {
    await prisma.user.delete({ where: { id: req.user!.id } });
    clearSession(res);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /me failed:", err);
    res.status(500).json({ error: "internal error" });
  }
});
