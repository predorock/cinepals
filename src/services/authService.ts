import { prisma } from "../db";
import { config } from "../config";
import { generateToken } from "../lib/tokens";
import { sendEmail, emailLayout } from "../lib/email";
import { findOrCreateUserByEmail } from "./userService";

/**
 * Requests a magic-link for the given email.
 * Creates (or reuses) the user, generates a time-limited LoginToken and sends the email.
 * Never reveals whether the email already exists: the caller must always respond ok.
 */
export async function requestMagicLink(email: string): Promise<void> {
  const user = await findOrCreateUserByEmail(email);

  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + config.magicLinkTtlMinutes * 60 * 1000);

  await prisma.loginToken.create({
    data: {
      token,
      userId: user.id,
      expiresAt,
    },
  });

  const verifyUrl = `${config.publicUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;

  const bodyHtml = `
    <p style="font-size:14px;line-height:1.5;margin:0 0 20px">
      Hi! You requested to sign in to <strong>Stremio Friends</strong>.
      Click the button below to enter: the link is valid for
      ${config.magicLinkTtlMinutes} minutes and can be used only once.
    </p>
    <p style="margin:0 0 20px">
      <a href="${verifyUrl}"
         style="display:inline-block;background:#7b6cf6;color:#ffffff;text-decoration:none;
                font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px">
        Sign in
      </a>
    </p>
    <p style="font-size:12px;color:#8a8aa3;line-height:1.5;margin:0">
      If the button doesn't work, copy and paste this link into your browser:<br>
      <a href="${verifyUrl}" style="color:#7b6cf6;word-break:break-all">${verifyUrl}</a>
    </p>
  `;

  const html = emailLayout("Your sign-in link", bodyHtml);
  const text =
    `Sign in to Stremio Friends by opening this link (valid ${config.magicLinkTtlMinutes} minutes, single use):\n${verifyUrl}`;

  await sendEmail({
    to: user.email,
    subject: "Your sign-in link for Stremio Friends",
    html,
    text,
  });
}

/**
 * Consumes a magic-link.
 * Returns the user { id, email } if the token is valid (not expired and not used),
 * marking it as used. Otherwise returns null.
 */
export async function consumeMagicLink(
  token: string,
): Promise<{ id: string; email: string } | null> {
  const loginToken = await prisma.loginToken.findUnique({
    where: { token },
    include: { user: true },
  });

  if (!loginToken) return null;
  if (loginToken.usedAt) return null;
  if (loginToken.expiresAt.getTime() <= Date.now()) return null;

  await prisma.loginToken.update({
    where: { token },
    data: { usedAt: new Date() },
  });

  return { id: loginToken.user.id, email: loginToken.user.email };
}
