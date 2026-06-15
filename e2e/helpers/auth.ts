import { expect, type Page } from "@playwright/test";
import { getMagicLink } from "./mailpit";

let counter = 0;

/** A unique email per call so each test gets isolated, fresh users. */
export function uniqueEmail(prefix = "user"): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@e2e.cinepals.test`;
}

/**
 * Drives the full magic-link login for `email` on `page`:
 * request a link → read it from Mailpit → open it → land on the dashboard.
 * Returns when the logged-in app view is visible.
 */
export async function login(page: Page, email: string): Promise<void> {
  await page.goto("/configure");
  await expect(page.locator("#view-guest")).toBeVisible();

  await page.fill("#login-email", email);
  await page.click("#login-submit");
  await expect(page.locator("#login-sent")).toBeVisible();

  const link = await getMagicLink(email);
  await page.goto(link); // verify endpoint sets the session cookie, redirects to /configure

  await expect(page.locator("#view-app")).toBeVisible();
}
