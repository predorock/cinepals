import { prisma } from "../db";
import { generateToken } from "../lib/tokens";
import type { User } from "@prisma/client";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Finds a user by email or creates one ("shadow" user for invites). */
export async function findOrCreateUserByEmail(email: string): Promise<User> {
  const normalized = normalizeEmail(email);
  const existing = await prisma.user.findUnique({ where: { email: normalized } });
  if (existing) return existing;
  return prisma.user.create({
    data: { email: normalized, addonToken: generateToken() },
  });
}

export function getUserById(id: string) {
  return prisma.user.findUnique({ where: { id } });
}

export function getUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
}

export function getUserByAddonToken(addonToken: string) {
  return prisma.user.findUnique({ where: { addonToken } });
}

/** Regenerates the addon token (revokes the old custom URL). */
export async function regenerateAddonToken(userId: string): Promise<string> {
  const token = generateToken();
  await prisma.user.update({ where: { id: userId }, data: { addonToken: token } });
  return token;
}
