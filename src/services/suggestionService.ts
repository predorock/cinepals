import { prisma } from "../db";
import { config } from "../config";
import { sendEmail, emailLayout } from "../lib/email";
import { getMetaByImdbId } from "../lib/tmdb";
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

  // No email here: the recipient is notified once a day via the digest
  // (see sendDailyDigests), so multiple suggestions arrive as a single email.
  return { status: "created" };
}

export interface DigestResult {
  recipients: number; // users that had pending suggestions
  emails: number; // emails actually sent
  suggestions: number; // suggestions included across all emails
}

/**
 * Sends the daily digest: one email per recipient bundling all of their pending
 * (not-yet-notified, non-dismissed) suggestions. Marks them notifiedAt on success
 * so they're never emailed twice; failures are left pending and retried next run.
 * Intended to be triggered once a day (see POST /internal/run-digest).
 */
export async function sendDailyDigests(): Promise<DigestResult> {
  const pending = await prisma.suggestion.findMany({
    where: { notifiedAt: null, status: { not: "dismissed" } },
    orderBy: { createdAt: "asc" },
    include: {
      fromUser: { select: { email: true, displayName: true } },
      toUser: { select: { email: true, displayName: true } },
    },
  });
  if (pending.length === 0) return { recipients: 0, emails: 0, suggestions: 0 };

  // Group by recipient.
  const byRecipient = new Map<string, typeof pending>();
  for (const s of pending) {
    const list = byRecipient.get(s.toUserId) ?? [];
    list.push(s);
    byRecipient.set(s.toUserId, list);
  }

  const configureUrl = `${config.publicUrl}/configure`;
  let emails = 0;
  let suggestions = 0;

  for (const [, items] of byRecipient) {
    const toEmail = items[0].toUser.email;
    const enriched = await withTitles(items); // resolves titles (cache → TMDB)

    const rows = enriched
      .map((s) => {
        const author = s.fromUser.displayName?.trim() || s.fromUser.email;
        const typeLabel = s.contentType === "series" ? "📺 Series" : "🎬 Movie";
        const year = s.year ? ` <span style="color:#8a8aa3">(${escapeHtml(s.year)})</span>` : "";
        const note = s.note
          ? `<div style="font-size:13px;color:#c8c8db;margin-top:4px"><em>"${escapeHtml(s.note)}"</em></div>`
          : "";
        return `<li style="margin:0 0 14px;list-style:none">
            <strong>${escapeHtml(s.name)}</strong>${year}
            <div style="font-size:13px;color:#8a8aa3">${typeLabel} · from ${escapeHtml(author)}</div>
            ${note}
          </li>`;
      })
      .join("");

    const count = items.length;
    const headline =
      count === 1
        ? "A friend suggested a title for you to watch"
        : `Your friends suggested ${count} titles for you to watch`;

    const bodyHtml = `
      <p style="font-size:14px;line-height:1.5;margin:0 0 16px">${headline} on <strong>Cinepals</strong>:</p>
      <ul style="padding:0;margin:0 0 20px">${rows}</ul>
      <p style="margin:0 0 20px">
        <a href="${configureUrl}"
           style="display:inline-block;background:#7b6cf6;color:#ffffff;text-decoration:none;
                  font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px">
          Open Cinepals
        </a>
      </p>
      <p style="font-size:12px;color:#8a8aa3;line-height:1.5;margin:0">
        They're also waiting in your personal catalog inside Stremio.
      </p>`;

    const textLines = enriched.map((s) => {
      const author = s.fromUser.displayName?.trim() || s.fromUser.email;
      const year = s.year ? ` (${s.year})` : "";
      const note = s.note ? ` — "${s.note}"` : "";
      return `• ${s.name}${year} — from ${author}${note}`;
    });
    const text = `${headline} on Cinepals:\n\n${textLines.join("\n")}\n\nOpen: ${configureUrl}`;

    try {
      await sendEmail({
        to: toEmail,
        subject:
          count === 1
            ? "You have a new suggestion on Cinepals"
            : `You have ${count} new suggestions on Cinepals`,
        html: emailLayout("Your suggestions", bodyHtml),
        text,
      });
      await prisma.suggestion.updateMany({
        where: { id: { in: items.map((i) => i.id) } },
        data: { notifiedAt: new Date() },
      });
      emails += 1;
      suggestions += count;
    } catch (err) {
      // Leave notifiedAt null so this recipient is retried on the next run.
      console.error(`Digest email to ${toEmail} failed:`, err);
    }
  }

  return { recipients: byRecipient.size, emails, suggestions };
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
 * Resolves each suggestion's title name/poster for display. Titles are cached
 * in TitleCache (populated at search time), so the common path is a single
 * batched DB read with no TMDB calls. Only genuine cache misses (e.g. legacy or
 * seeded suggestions) fall back to getMetaByImdbId, which resolves and caches.
 * Falls back to the raw imdbId if resolution fails entirely.
 */
async function withTitles<T extends { imdbId: string; contentType: string }>(
  rows: T[],
): Promise<(T & { name: string; poster?: string; year?: string })[]> {
  if (rows.length === 0) return [];

  const imdbIds = [...new Set(rows.map((r) => r.imdbId))];
  const cached = await prisma.titleCache.findMany({ where: { imdbId: { in: imdbIds } } });
  const byId = new Map(cached.map((c) => [c.imdbId, c]));

  return Promise.all(
    rows.map(async (row) => {
      const hit = byId.get(row.imdbId);
      if (hit) {
        return { ...row, name: hit.name, poster: hit.poster ?? undefined, year: hit.releaseInfo ?? undefined };
      }
      // Cache miss: resolve via TMDB (also populates TitleCache for next time).
      const meta = await getMetaByImdbId(
        row.imdbId,
        row.contentType as StremioContentType,
      ).catch(() => null);
      return {
        ...row,
        name: meta?.name ?? row.imdbId,
        poster: meta?.poster,
        year: meta?.releaseInfo,
      };
    }),
  );
}

/**
 * Suggestions received by the user (status other than "dismissed"),
 * ordered from most recent, with the sender's data and resolved title.
 */
export async function listReceived(userId: string) {
  const rows = await prisma.suggestion.findMany({
    where: {
      toUserId: userId,
      status: { not: "dismissed" },
    },
    orderBy: { createdAt: "desc" },
    include: { fromUser: userSelect },
  });
  return withTitles(rows);
}

/**
 * Suggestions sent by the user, ordered from most recent,
 * with the recipient's data and resolved title.
 */
export async function listSent(userId: string) {
  const rows = await prisma.suggestion.findMany({
    where: { fromUserId: userId },
    orderBy: { createdAt: "desc" },
    include: { toUser: userSelect },
  });
  return withTitles(rows);
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
