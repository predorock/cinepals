import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import {
  listFriends,
  listPendingRequests,
  sendFriendRequest,
  respondToRequest,
  removeFriend,
} from "../services/friendService";

export const friendRouter: Router = Router();

// All routes require authentication.
friendRouter.use(requireAuth);

const requestBodySchema = z.object({
  email: z.string().email(),
});

const idParamSchema = z.object({
  id: z.string().min(1),
});

const otherUserIdParamSchema = z.object({
  otherUserId: z.string().min(1),
});

/** GET / → list of friends */
friendRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const friends = await listFriends(req.user!.id);
    res.json({ friends });
  } catch (err) {
    console.error("listFriends error:", err);
    res.status(500).json({ error: "internal error" });
  }
});

/** GET /requests → pending requests (incoming/outgoing) */
friendRouter.get("/requests", async (req: Request, res: Response): Promise<void> => {
  try {
    const { incoming, outgoing } = await listPendingRequests(req.user!.id);
    res.json({ incoming, outgoing });
  } catch (err) {
    console.error("listPendingRequests error:", err);
    res.status(500).json({ error: "internal error" });
  }
});

/** POST /request → send a friend request by email */
friendRouter.post("/request", async (req: Request, res: Response): Promise<void> => {
  const parsed = requestBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid input" });
    return;
  }

  try {
    const { status } = await sendFriendRequest(req.user!.id, parsed.data.email);
    // Generic response: we don't reveal whether the email was already registered.
    res.status(200).json({ status });
  } catch (err) {
    console.error("sendFriendRequest error:", err);
    res.status(500).json({ error: "internal error" });
  }
});

/** POST /:id/accept → accept an incoming request */
friendRouter.post("/:id/accept", async (req: Request, res: Response): Promise<void> => {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid input" });
    return;
  }

  try {
    const ok = await respondToRequest(req.user!.id, parsed.data.id, true);
    if (!ok) {
      res.status(404).json({ error: "request not found" });
      return;
    }
    res.json({ ok });
  } catch (err) {
    console.error("respondToRequest (accept) error:", err);
    res.status(500).json({ error: "internal error" });
  }
});

/** POST /:id/decline → decline an incoming request */
friendRouter.post("/:id/decline", async (req: Request, res: Response): Promise<void> => {
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid input" });
    return;
  }

  try {
    const ok = await respondToRequest(req.user!.id, parsed.data.id, false);
    if (!ok) {
      res.status(404).json({ error: "request not found" });
      return;
    }
    res.json({ ok });
  } catch (err) {
    console.error("respondToRequest (decline) error:", err);
    res.status(500).json({ error: "internal error" });
  }
});

/** DELETE /:otherUserId → remove a friendship */
friendRouter.delete("/:otherUserId", async (req: Request, res: Response): Promise<void> => {
  const parsed = otherUserIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid input" });
    return;
  }

  try {
    await removeFriend(req.user!.id, parsed.data.otherUserId);
    res.json({ ok: true });
  } catch (err) {
    console.error("removeFriend error:", err);
    res.status(500).json({ error: "internal error" });
  }
});
