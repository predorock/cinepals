import { test, expect } from "@playwright/test";
import { login, uniqueEmail } from "./helpers/auth";

test("setting a display name updates the header and persists", async ({ page }) => {
  const email = uniqueEmail("profile");
  await login(page, email);

  // Before: the header shows the email (no display name yet).
  await expect(page.locator("#user-name")).toHaveText(email);

  // The "✎ Name" button opens a prompt(); accept it with a name.
  page.once("dialog", (dialog) => dialog.accept("Alice Cooper"));
  await page.click("#edit-name-btn");

  await expect(page.locator("#user-name")).toHaveText("Alice Cooper");
  await expect(page.locator("#user-email")).toHaveText(email); // email moves to the subline

  // Persisted across a reload (saved server-side via PATCH /api/auth/me).
  await page.reload();
  await expect(page.locator("#user-name")).toHaveText("Alice Cooper");
});
