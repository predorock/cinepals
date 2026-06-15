import { prisma } from "../db";
import { config } from "../config";
import { sendEmail, emailLayout } from "../lib/email";
import { getUserById } from "./userService";
import type { StremioContentType } from "../types";

/**
 * Return status of suggestion creation.
 */
export type CreateSuggestionResult = {
  status: "created" | "not_friends" | "duplicate" | "self";
};

/**
 * Internal friendship check (does not depend on friendService):
 * true if an "accepted" Friendship exists between the two users, in either direction.
 */
async function areFriends(aId: string, bId: string): Promise<boolean> {
  const friendship = await prisma.friendship.findFirst({
    where: {
      status: "accepted",
      OR: [
        { requesterId: aId, addresseeId: bId },
        { requesterId: bId, addresseeId: aId },
      ],
    },
    select: { id: true },
  });
  return friendship !== null;
}

/**
 * Creates a suggestion from `fromUserId` to `toUserId`.
 * - "self" if the user tries to recommend to themselves.
 * - "not_friends" if the two are not friends (you can only suggest to friends).
 * - "duplicate" if a suggestion with the same triple (from, to, imdbId) already exists.
 * - "created" otherwise: creates the suggestion and sends the notification email to the recipient.
 */
export async function createSuggestion(
  fromUserId: string,
  toUserId: string,
  imdbId: string,
  contentType: StremioContentType,
  note?: string
): Promise<CreateSuggestionResult> {
  if (fromUserId === toUserId) {
    return { status: "self" };
  }

  if (!(await areFriends(fromUserId, toUserId))) {
    return { status: "not_friends" };
  }

  const existing = await prisma.suggestion.findUnique({
    where: {
      fromUserId_toUserId_imdbId: { fromUserId, toUserId, imdbId },
    },
    select: { id: true },
  });
  if (existing) {
    return { status: "duplicate" };
  }

  await prisma.suggestion.create({
    data: {
      fromUserId,
      toUserId,
      imdbId,
      contentType,
      note: note ?? null,
    },
  });

  await notifyRecipient(fromUserId, toUserId, note);

  return { status: "created" };
}

/**
 * Sends the notification email to the suggestion recipient.
 * Sending errors must not make the suggestion creation fail.
 */
async function notifyRecipient(
  fromUserId: string,
  toUserId: string,
  note?: string
): Promise<void> {
  try {
    const [fromUser, toUser] = await Promise.all([
      getUserById(fromUserId),
      getUserById(toUserId),
    ]);
    if (!toUser) return;

    const fromName = fromUser?.displayName?.trim() || fromUser?.email || "A friend";
    const configureUrl = `${config.publicUrl}/configure`;

    const noteHtml = note
      ? `<p style="font-size:14px;line-height:1.5;margin:0 0 20px;color:#c8c8db">
           <em>"${escapeHtml(note)}"</em>
         </p>`
      : "";

    const bodyHtml = `
      <p style="font-size:14px;line-height:1.5;margin:0 0 12px">
        <strong>${escapeHtml(fromName)}</strong> recommended a title for you to watch on
        <strong>Cinepals</strong>.
      </p>
      ${noteHtml}
      <p style="font-size:14px;line-height:1.5;margin:0 0 20px">
        You'll find the suggestion in your personal catalog inside Stremio.
      </p>
      <p style="margin:0 0 20px">
        <a href="${configureUrl}"
           style="display:inline-block;background:#7b6cf6;color:#ffffff;text-decoration:none;
                  font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px">
          Open Cinepals
        </a>
      </p>
      <p style="font-size:12px;color:#8a8aa3;line-height:1.5;margin:0">
        If the button doesn't work, copy and paste this link into your browser:<br>
        <a href="${configureUrl}" style="color:#7b6cf6;word-break:break-all">${configureUrl}</a>
      </p>
    `;

    const html = emailLayout("You have a new recommendation!", bodyHtml);
    const text =
      `${fromName} recommended a title for you on Cinepals.` +
      (note ? `\n"${note}"` : "") +
      `\nOpen: ${configureUrl}`;

    await sendEmail({
      to: toUser.email,
      subject: `${fromName} recommended something for you to watch`,
      html,
      text,
    });
  } catch (err) {
    console.error("Suggestion email sending failed:", err);
  }
}

/** Minimal escape to interpolate user text into the email HTML. */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Sender/recipient projection included in the lists. */
const userSelect = {
  select: { id: true, email: true, displayName: true },
} as const;

/**
 * Suggestions received by the user (status other than "dismissed"),
 * ordered from most recent, with the sender's data.
 */
export async function listReceived(userId: string) {
  return prisma.suggestion.findMany({
    where: {
      toUserId: userId,
      status: { not: "dismissed" },
    },
    orderBy: { createdAt: "desc" },
    include: { fromUser: userSelect },
  });
}

/**
 * Suggestions sent by the user, ordered from most recent,
 * with the recipient's data.
 */
export async function listSent(userId: string) {
  return prisma.suggestion.findMany({
    where: { fromUserId: userId },
    orderBy: { createdAt: "desc" },
    include: { toUser: userSelect },
  });
}

/** Statuses the recipient can set manually. */
export type UpdatableStatus = "seen" | "watched" | "dismissed";

/**
 * Updates the status of a received suggestion.
 * Allowed only to the recipient (toUserId === userId) and only towards
 * "seen" | "watched" | "dismissed". Returns true if it was updated.
 */
export async function updateSuggestionStatus(
  userId: string,
  suggestionId: string,
  status: UpdatableStatus
): Promise<boolean> {
  const result = await prisma.suggestion.updateMany({
    where: { id: suggestionId, toUserId: userId },
    data: { status },
  });
  return result.count > 0;
}

/**
 * Received suggestions of a certain type (movie | series), status other than
 * "dismissed", ordered from most recent. Used by the Stremio addon to build
 * the personal catalog.
 */
export interface ReceivedSuggestionForAddon {
  imdbId: string;
  note: string | null;
  contentType: string;
  status: string;
  createdAt: Date;
  fromUser: { email: string; displayName: string | null };
}

export async function getReceivedByType(
  userId: string,
  type: StremioContentType,
  fromUserId?: string
): Promise<ReceivedSuggestionForAddon[]> {
  return prisma.suggestion.findMany({
    where: {
      toUserId: userId,
      contentType: type,
      status: { not: "dismissed" },
      ...(fromUserId ? { fromUserId } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      imdbId: true,
      note: true,
      contentType: true,
      status: true,
      createdAt: true,
      fromUser: { select: { email: true, displayName: true } },
    },
  });
}
