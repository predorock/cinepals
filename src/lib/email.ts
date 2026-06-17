import { config } from "../config";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Sends a transactional email.
 * - In production with RESEND_API_KEY: uses the Resend HTTP API.
 * - In dev with SMTP_URL (e.g. Mailpit): sends via SMTP to the local mail trap.
 * - Otherwise: prints the content to the console, so magic-links are clickable from the logs.
 */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (!config.resendApiKey) {
    if (config.smtpUrl) {
      await sendViaSmtp(msg);
      return;
    }
    console.log("\n========== EMAIL (dev, not sent) ==========");
    console.log(`To: ${msg.to}`);
    console.log(`Subject: ${msg.subject}`);
    console.log(msg.text ?? stripHtml(msg.html));
    console.log("==============================================\n");
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.emailFrom,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text ?? stripHtml(msg.html),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`Email sending failed (${res.status}): ${body}`);
  }
}

/**
 * Sends via SMTP to a local mail trap (Mailpit/MailHog). nodemailer is imported
 * dynamically so it's never loaded on the production (Resend) path.
 */
async function sendViaSmtp(msg: EmailMessage): Promise<void> {
  const { createTransport } = await import("nodemailer");
  const transport = createTransport(config.smtpUrl);
  try {
    await transport.sendMail({
      from: config.emailFrom,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text ?? stripHtml(msg.html),
    });
    console.log(`📬 Email sent to mail trap → ${msg.to} ("${msg.subject}") — inbox: http://127.0.0.1:8025`);
  } catch (err) {
    console.error(`SMTP send failed (${config.smtpUrl}):`, err);
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Minimal, consistent HTML wrapper for all emails. */
export function emailLayout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,Arial,sans-serif;background:#0f0f17;padding:24px;color:#e6e6f0">
  <div style="max-width:520px;margin:0 auto;background:#1a1a28;border-radius:12px;padding:28px">
    <h1 style="font-size:18px;color:#7b6cf6;margin:0 0 16px">🎬 Cinepals</h1>
    <h2 style="font-size:16px;margin:0 0 12px">${title}</h2>
    ${bodyHtml}
    <p style="font-size:12px;color:#8a8aa3;margin-top:24px">If you didn't request this email, you can ignore it.</p>
    <hr style="border:none;border-top:1px solid #2a2a3d;margin:20px 0 12px" />
    <p style="font-size:11px;color:#8a8aa3;margin:0">
      Cinepals — an unofficial addon for Stremio · Made by
      <a href="https://github.com/predorock" style="color:#c084fc;text-decoration:none">predo</a> ·
      <a href="https://github.com/predorock/cinepals" style="color:#c084fc;text-decoration:none">Source on GitHub</a>
    </p>
  </div></body></html>`;
}
