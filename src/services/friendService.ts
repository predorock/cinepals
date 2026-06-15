import { prisma } from "../db";
import { config } from "../config";
import { sendEmail, emailLayout } from "../lib/email";
import { findOrCreateUserByEmail, normalizeEmail, getUserById } from "./userService";

export interface FriendDto {
  id: string;
  email: string;
  displayName: string | null;
}

export interface PendingRequestDto {
  friendshipId: string;
  user: FriendDto;
  createdAt: Date;
}

export interface PendingRequests {
  incoming: PendingRequestDto[];
  outgoing: PendingRequestDto[];
}

export type SendFriendRequestStatus =
  | "sent"
  | "already_friends"
  | "already_pending"
  | "self";

function toFriendDto(u: { id: string; email: string; displayName: string | null }): FriendDto {
  return { id: u.id, email: u.email, displayName: u.displayName };
}

/** All users with whom an accepted friendship exists (in either direction). */
export async function listFriends(userId: string): Promise<FriendDto[]> {
  const friendships = await prisma.friendship.findMany({
    where: {
      status: "accepted",
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
    include: { requester: true, addressee: true },
  });

  return friendships.map((f) => {
    const other = f.requesterId === userId ? f.addressee : f.requester;
    return toFriendDto(other);
  });
}

/** Incoming (to userId) and outgoing (from userId) pending requests. */
export async function listPendingRequests(userId: string): Promise<PendingRequests> {
  const [incomingRows, outgoingRows] = await Promise.all([
    prisma.friendship.findMany({
      where: { status: "pending", addresseeId: userId },
      include: { requester: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.friendship.findMany({
      where: { status: "pending", requesterId: userId },
      include: { addressee: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const incoming: PendingRequestDto[] = incomingRows.map((f) => ({
    friendshipId: f.id,
    user: toFriendDto(f.requester),
    createdAt: f.createdAt,
  }));

  const outgoing: PendingRequestDto[] = outgoingRows.map((f) => ({
    friendshipId: f.id,
    user: toFriendDto(f.addressee),
    createdAt: f.createdAt,
  }));

  return { incoming, outgoing };
}

/**
 * Sends a friend request to the user with the given email.
 * Creates the addressee user (shadow) if it doesn't exist yet.
 */
export async function sendFriendRequest(
  userId: string,
  friendEmail: string
): Promise<{ status: SendFriendRequestStatus }> {
  const normalized = normalizeEmail(friendEmail);

  const me = await getUserById(userId);
  if (me && me.email === normalized) {
    return { status: "self" };
  }

  // Create/find the addressee (shadow user for invites).
  const addressee = await findOrCreateUserByEmail(normalized);

  if (addressee.id === userId) {
    return { status: "self" };
  }

  // Does a friendship (in any direction) already exist between the two?
  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: userId, addresseeId: addressee.id },
        { requesterId: addressee.id, addresseeId: userId },
      ],
    },
  });

  if (existing) {
    if (existing.status === "accepted") {
      return { status: "already_friends" };
    }
    if (existing.status === "pending") {
      // If the pending one is REVERSED (the other already invited me), accept it automatically.
      if (existing.requesterId === addressee.id && existing.addresseeId === userId) {
        await prisma.friendship.update({
          where: { id: existing.id },
          data: { status: "accepted", respondedAt: new Date() },
        });
        return { status: "already_friends" };
      }
      // Pending in the same direction (I had already sent it).
      return { status: "already_pending" };
    }
    // declined/blocked state: reopen the request as pending (requester = userId).
    await prisma.friendship.delete({ where: { id: existing.id } });
  }

  await prisma.friendship.create({
    data: {
      requesterId: userId,
      addresseeId: addressee.id,
      status: "pending",
    },
  });

  await sendInviteEmail(addressee.email, me?.displayName ?? me?.email ?? null);

  return { status: "sent" };
}

async function sendInviteEmail(
  toEmail: string,
  fromLabel: string | null
): Promise<void> {
  const link = `${config.publicUrl}/configure`;
  const who = fromLabel ? `<strong>${escapeHtml(fromLabel)}</strong>` : "A friend";
  const body = `
    <p style="font-size:14px;line-height:1.5">${who} wants to add you as a friend on Cinepals to share movie and TV show recommendations.</p>
    <p style="font-size:14px;line-height:1.5">Open the configuration page to accept the request and start exchanging suggestions:</p>
    <p style="margin:20px 0">
      <a href="${link}" style="display:inline-block;background:#7b6cf6;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:14px">Open Cinepals</a>
    </p>
    <p style="font-size:12px;color:#8a8aa3">Or copy this link: ${link}</p>
  `;

  try {
    await sendEmail({
      to: toEmail,
      subject: "You have a new friend request on Cinepals",
      html: emailLayout("New friend request", body),
    });
  } catch (err) {
    // Email sending must not make the request creation fail.
    console.error("Friend invite email sending failed:", err);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Responds to an incoming request. Updates only if the friendship exists,
 * is pending and is addressed to userId. Returns true if updated.
 */
export async function respondToRequest(
  userId: string,
  friendshipId: string,
  accept: boolean
): Promise<boolean> {
  const friendship = await prisma.friendship.findUnique({ where: { id: friendshipId } });
  if (!friendship) return false;
  if (friendship.status !== "pending") return false;
  if (friendship.addresseeId !== userId) return false;

  await prisma.friendship.update({
    where: { id: friendship.id },
    data: {
      status: accept ? "accepted" : "declined",
      respondedAt: new Date(),
    },
  });
  return true;
}

/** Deletes any friendship between the two users (both directions). */
export async function removeFriend(userId: string, otherUserId: string): Promise<void> {
  await prisma.friendship.deleteMany({
    where: {
      OR: [
        { requesterId: userId, addresseeId: otherUserId },
        { requesterId: otherUserId, addresseeId: userId },
      ],
    },
  });
}

/** True if an accepted friendship exists between the two (any direction). */
export async function areFriends(aId: string, bId: string): Promise<boolean> {
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
