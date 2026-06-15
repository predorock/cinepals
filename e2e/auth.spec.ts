import { test, expect } from "@playwright/test";
import { clearMailbox } from "./helpers/mailpit";
import { login, uniqueEmail } from "./helpers/auth";

test.beforeAll(async () => {
  await clearMailbox();
});

test("magic-link login takes a guest to the dashboard", async ({ page }) => {
  const email = uniqueEmail("auth");
  await login(page, email);

  // Header shows the user, and the personal addon manifest URL is populated.
  await expect(page.locator("#user-name")).toHaveText(email);
  await expect(page.locator("#manifest-url")).toHaveValue(/\/u\/.+\/manifest\.json$/);
});

test("an invalid magic link is rejected", async ({ page }) => {
  await page.goto("/api/auth/verify?token=definitely-not-a-real-token");
  // verify redirects to /configure?error=invalid_link → guest view + error toast.
  await expect(page.locator("#view-guest")).toBeVisible();
  await expect(page.locator("#toasts")).toContainText(/invalid or has expired/i);
});

test("logout returns to the guest view", async ({ page }) => {
  const email = uniqueEmail("logout");
  await login(page, email);

  await page.click("#logout-btn"); // handler reloads the page after clearing the session
  await expect(page.locator("#view-guest")).toBeVisible();
});
