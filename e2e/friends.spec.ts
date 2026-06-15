import { test, expect, type Browser } from "@playwright/test";
import { login, uniqueEmail } from "./helpers/auth";
import { sendFriendRequest, becomeFriends } from "./helpers/friends";

/** Opens an isolated browser context (own cookie jar) and logs `email` in. */
async function loggedInPage(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email);
  return { context, page };
}

test("two users can become friends, then unfriend", async ({ browser }) => {
  const emailA = uniqueEmail("alice");
  const emailB = uniqueEmail("bob");
  const a = await loggedInPage(browser, emailA);
  const b = await loggedInPage(browser, emailB);

  await becomeFriends(a.page, emailA, b.page, emailB);

  // B also sees A as a friend.
  await b.page.reload();
  await expect(b.page.locator("#friends-list")).toContainText(emailA);

  // A removes B (confirm() dialog → accept). Friend list empties.
  a.page.once("dialog", (dialog) => dialog.accept());
  await a.page.locator("#friends-list button.no").first().click();
  await expect(a.page.locator("#friends-list")).toContainText(/no friends yet/i);

  await a.context.close();
  await b.context.close();
});

test("an incoming request can be declined", async ({ browser }) => {
  const emailA = uniqueEmail("carol");
  const emailB = uniqueEmail("dave");
  const a = await loggedInPage(browser, emailA);
  const b = await loggedInPage(browser, emailB);

  await sendFriendRequest(a.page, emailB);

  await b.page.reload();
  await expect(b.page.locator("#incoming-list")).toContainText(emailA);
  await b.page.locator("#incoming-list button.no").first().click();

  // Declining clears the incoming request and creates no friendship.
  await expect(b.page.locator("#incoming-list")).toContainText(/no incoming requests/i);
  await expect(b.page.locator("#friends-list")).toContainText(/no friends yet/i);

  await a.context.close();
  await b.context.close();
});
