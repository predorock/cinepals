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
 * - Otherwise (dev): prints the content to the console, so magic-links are clickable from the logs.
 */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (!config.resendApiKey) {
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
    <h1 style="font-size:18px;color:#7b6cf6;margin:0 0 16px">🎬 Stremio Friends</h1>
    <h2 style="font-size:16px;margin:0 0 12px">${title}</h2>
    ${bodyHtml}
    <p style="font-size:12px;color:#8a8aa3;margin-top:24px">If you didn't request this email, you can ignore it.</p>
  </div></body></html>`;
}
