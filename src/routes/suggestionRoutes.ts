import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import {
  createSuggestion,
  listReceived,
  listSent,
  updateSuggestionStatus,
} from "../services/suggestionService";

export const suggestionRouter = Router();

suggestionRouter.use(requireAuth);

// Body for creating a suggestion.
const createSchema = z.object({
  toUserId: z.string().min(1),
  imdbId: z.string().min(1),
  contentType: z.enum(["movie", "series"]).default("movie"),
  note: z.string().trim().max(500).optional(),
});

// Body for updating the status (only statuses settable by the recipient).
const updateSchema = z.object({
  status: z.enum(["seen", "watched", "dismissed"]),
});

/** GET /received → received suggestions (status != dismissed). */
suggestionRouter.get("/received", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const suggestions = await listReceived(userId);
    res.json({ suggestions });
  } catch (err) {
    console.error("GET /suggestions/received:", err);
    res.status(500).json({ error: "internal error" });
  }
});

/** GET /sent → suggestions sent by the user. */
suggestionRouter.get("/sent", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const suggestions = await listSent(userId);
    res.json({ suggestions });
  } catch (err) {
    console.error("GET /suggestions/sent:", err);
    res.status(500).json({ error: "internal error" });
  }
});

/** POST / → create a suggestion for a friend. */
suggestionRouter.post("/", async (req: Request, res: Response) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid input" });
    return;
  }

  try {
    const userId = req.user!.id;
    const { toUserId, imdbId, contentType, note } = parsed.data;
    const result = await createSuggestion(userId, toUserId, imdbId, contentType, note);
    res.json({ status: result.status });
  } catch (err) {
    console.error("POST /suggestions:", err);
    res.status(500).json({ error: "internal error" });
  }
});

/** PATCH /:id → update the status of a received suggestion. */
suggestionRouter.patch("/:id", async (req: Request, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid input" });
    return;
  }

  try {
    const userId = req.user!.id;
    const suggestionId = req.params.id;
    const ok = await updateSuggestionStatus(userId, suggestionId, parsed.data.status);
    if (!ok) {
      res.status(404).json({ error: "suggestion not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("PATCH /suggestions/:id:", err);
    res.status(500).json({ error: "internal error" });
  }
});
