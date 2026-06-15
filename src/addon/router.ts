import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { buildManifest } from "./manifest";
import { buildCatalog } from "./catalog";
import { buildMeta } from "./meta";
import type { StremioContentType } from "../types";

/**
 * Stremio protocol router, mounted on `/u/:token`.
 * `mergeParams: true` is essential to read `:token` from the mount.
 */
export const addonRouter = Router({ mergeParams: true });

/** Narrows the `type` to the protocol's valid values; otherwise null. */
function parseType(raw: string): StremioContentType | null {
  return raw === "movie" || raw === "series" ? raw : null;
}

/** Removes a possible `.json` suffix from a path parameter. */
function stripJson(value: string): string {
  return value.endsWith(".json") ? value.slice(0, -".json".length) : value;
}

/**
 * Extracts the search query from the Stremio extra.
 * The extra arrives as a URL-encoded string like `search=matrix`,
 * possibly with multiple pairs separated by `&`.
 */
function parseSearchExtra(extra: string): string | undefined {
  const cleaned = stripJson(extra);
  for (const pair of cleaned.split("&")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const key = pair.slice(0, eq);
    if (key === "search") {
      try {
        return decodeURIComponent(pair.slice(eq + 1));
      } catch {
        return pair.slice(eq + 1);
      }
    }
  }
  return undefined;
}

// --- CORS: required by Stremio on every JSON response ---
addonRouter.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

/** Extracts a friend id from a catalog id like `cinepals-friend-<id>`, else undefined. */
function parseFriendId(catalogId: string): string | undefined {
  const prefix = "cinepals-friend-";
  return catalogId.startsWith(prefix) ? catalogId.slice(prefix.length) : undefined;
}

// --- Manifest ---
addonRouter.get("/manifest.json", async (req: Request, res: Response) => {
  try {
    res.json(await buildManifest(req.params.token));
  } catch {
    res.json(await buildManifest());
  }
});

// --- Catalog without extra ---
addonRouter.get(
  "/catalog/:type/:id.json",
  async (req: Request, res: Response) => {
    try {
      const token = req.params.token ?? "";
      const type = parseType(req.params.type);
      if (!type) {
        res.json({ metas: [] });
        return;
      }
      const friendId = parseFriendId(req.params.id);
      const result = await buildCatalog(token, type, undefined, friendId);
      res.setHeader("Cache-Control", "max-age=60, public");
      res.json(result);
    } catch {
      res.json({ metas: [] });
    }
  }
);

// --- Catalog with search extra (e.g. `search=matrix`) ---
addonRouter.get(
  "/catalog/:type/:id/:extra.json",
  async (req: Request, res: Response) => {
    try {
      const token = req.params.token ?? "";
      const type = parseType(req.params.type);
      if (!type) {
        res.json({ metas: [] });
        return;
      }
      const searchQuery = parseSearchExtra(req.params.extra);
      const friendId = parseFriendId(req.params.id);
      const result = await buildCatalog(token, type, searchQuery, friendId);
      res.setHeader("Cache-Control", "max-age=60, public");
      res.json(result);
    } catch {
      res.json({ metas: [] });
    }
  }
);

// --- Meta ---
addonRouter.get("/meta/:type/:id.json", async (req: Request, res: Response) => {
  try {
    const type = parseType(req.params.type);
    if (!type) {
      res.json({ meta: null });
      return;
    }
    const imdbId = stripJson(req.params.id);
    const result = await buildMeta(type, imdbId);
    res.setHeader("Cache-Control", "max-age=60, public");
    res.json(result);
  } catch {
    res.json({ meta: null });
  }
});
