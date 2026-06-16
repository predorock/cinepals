import { test, expect, type Browser } from "@playwright/test";
import { login, uniqueEmail } from "./helpers/auth";
import { becomeFriends } from "./helpers/friends";
import { waitForEmail } from "./helpers/mailpit";

// Matches the value forced in playwright.config.ts.
const CRON_SECRET = "test-cron-secret";

async function loggedInPage(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email);
  return { context, page };
}

test("daily digest emails a recipient their pending suggestions exactly once", async ({
  browser,
  request,
}) => {
  const emailA = uniqueEmail("digest-from");
  const emailB = uniqueEmail("digest-to");
  const a = await loggedInPage(browser, emailA);
  const b = await loggedInPage(browser, emailB);

  await becomeFriends(a.page, emailA, b.page, emailB);

  // A suggests a title to B. No email is sent at this point (digest-only).
  await a.page.fill("#search-query", "Inception");
  await a.page.click("#search-form button[type=submit]");
  await expect(a.page.locator("#search-results")).toContainText("Inception");
  await a.page.locator("#search-results .result-card").first().click();
  await expect(a.page.locator("#suggest-modal")).toBeVisible();
  await a.page.selectOption("#suggest-friend", { label: emailB });
  await a.page.fill("#suggest-note", "Watch this!");
  await a.page.click("#suggest-form button[type=submit]");
  await expect(a.page.locator("#suggest-modal")).toBeHidden();

  // The internal endpoint rejects calls without the bearer token.
  const noAuth = await request.post("/internal/run-digest");
  expect(noAuth.status()).toBe(401);

  // Trigger the digest with the secret → one email goes out.
  const res = await request.post("/internal/run-digest", {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.emails).toBeGreaterThanOrEqual(1);

  // B receives a single digest email containing the resolved title.
  const mail = await waitForEmail(emailB, /new suggestion/i);
  expect(`${mail.HTML}${mail.Text}`).toContain("Inception");

  // Idempotent: a second run sends nothing (the suggestion is already notified).
  const res2 = await request.post("/internal/run-digest", {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  const body2 = await res2.json();
  expect(body2.emails).toBe(0);

  await a.context.close();
  await b.context.close();
});
