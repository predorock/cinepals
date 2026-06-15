import { test, expect } from "@playwright/test";
import { login, uniqueEmail } from "./helpers/auth";

test("a user can delete their account and is signed out", async ({ page }) => {
  const email = uniqueEmail("delete");
  await login(page, email);

  page.once("dialog", (dialog) => dialog.accept()); // confirm() prompt
  await page.click("#delete-account-btn");

  // The handler clears the session and reloads; the guest view comes back.
  await expect(page.locator("#view-guest")).toBeVisible({ timeout: 10_000 });

  // Re-fetching the profile confirms the session is gone.
  const me = await page.request.get("/api/auth/me");
  expect(me.status()).toBe(401);
});
