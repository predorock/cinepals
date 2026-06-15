import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { searchTitles } from "../lib/tmdb";

export const searchRouter = Router();

searchRouter.use(requireAuth);

// Query string: q required, type optional (default "movie").
const searchSchema = z.object({
  q: z.string().trim().min(1),
  type: z.enum(["movie", "series"]).default("movie"),
});

/** GET /?q=...&type=movie|series → search titles on TMDB. */
searchRouter.get("/", async (req: Request, res: Response) => {
  const parsed = searchSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid input" });
    return;
  }

  try {
    const { q, type } = parsed.data;
    const results = await searchTitles(q, type);
    res.json({ results });
  } catch (err) {
    console.error("GET /search:", err);
    res.status(500).json({ error: "internal error" });
  }
});
