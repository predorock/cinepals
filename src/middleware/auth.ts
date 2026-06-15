import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import type { AuthUser } from "../types";

// Session JWT payload.
interface SessionPayload {
  sub: string;
  email: string;
}

const SESSION_TTL_SECONDS = config.sessionTtlDays * 24 * 60 * 60;

/**
 * Middleware: requires a valid session.
 * Reads the JWT from the session cookie, verifies it and populates `req.user`.
 * Responds 401 if missing or invalid.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[config.sessionCookieName] as string | undefined;
  if (!token) {
    res.status(401).json({ error: "not authenticated" });
    return;
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret) as SessionPayload;
    if (!payload?.sub || !payload?.email) {
      res.status(401).json({ error: "not authenticated" });
      return;
    }
    const user: AuthUser = { id: payload.sub, email: payload.email };
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "not authenticated" });
  }
}

/**
 * Signs a session JWT for the user and sets it in an httpOnly cookie.
 */
export function setSession(res: Response, user: { id: string; email: string }): void {
  const token = jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
    expiresIn: SESSION_TTL_SECONDS,
  });

  res.cookie(config.sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: "/",
  });
}

/** Clears the session cookie (logout). */
export function clearSession(res: Response): void {
  res.clearCookie(config.sessionCookieName, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    path: "/",
  });
}
