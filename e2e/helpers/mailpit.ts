// Helpers to read emails captured by the local Mailpit trap (docker-compose),
// so e2e tests can drive the real magic-link login and read friend-invite mails.

const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";

interface MailpitSummary {
  ID: string;
  To: { Address: string }[];
  Subject: string;
  Created: string;
}

interface MailpitMessage {
  ID: string;
  Subject: string;
  Text: string;
  HTML: string;
}

async function searchMessages(query: string): Promise<MailpitSummary[]> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Mailpit search failed (${res.status}). Is the mail trap running?`);
  const data = (await res.json()) as { messages?: MailpitSummary[] };
  return data.messages ?? [];
}

async function getMessage(id: string): Promise<MailpitMessage> {
  const res = await fetch(`${MAILPIT_URL}/api/v1/message/${id}`);
  if (!res.ok) throw new Error(`Mailpit message fetch failed (${res.status})`);
  return (await res.json()) as MailpitMessage;
}

/** Deletes every message in the trap (call in beforeAll for a clean inbox). */
export async function clearMailbox(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: "DELETE" }).catch(() => {});
}

/** Polls until an email to `toEmail` with a subject matching `subject` arrives. */
export async function waitForEmail(
  toEmail: string,
  subject: RegExp,
  timeoutMs = 15_000,
): Promise<MailpitMessage> {
  const deadline = Date.now() + timeoutMs;
  let lastSeen = 0;
  while (Date.now() < deadline) {
    const matches = (await searchMessages(`to:"${toEmail}"`)).filter((m) => subject.test(m.Subject));
    lastSeen = matches.length;
    if (matches.length) return getMessage(matches[0].ID); // newest first
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(
    `No email to ${toEmail} matching ${subject} within ${timeoutMs}ms (saw ${lastSeen} candidates).`,
  );
}

/** Returns the magic-link verify URL from the latest sign-in email to `toEmail`. */
export async function getMagicLink(toEmail: string): Promise<string> {
  const msg = await waitForEmail(toEmail, /sign-in/i);
  const body = msg.Text || msg.HTML;
  const m = body.match(/https?:\/\/[^\s"'<>]+\/api\/auth\/verify\?token=[^\s"'<>]+/);
  if (!m) throw new Error(`No verify link found in sign-in email to ${toEmail}`);
  return m[0];
}
