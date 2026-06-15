import { expect, type Page } from "@playwright/test";

/** Sends a friend request to `friendEmail` and waits for it to show in "Sent requests". */
export async function sendFriendRequest(page: Page, friendEmail: string): Promise<void> {
  await page.fill("#add-friend-email", friendEmail);
  await page.click("#add-friend-form button[type=submit]");
  await expect(page.locator("#outgoing-list")).toContainText(friendEmail);
}

/** Reloads `page` and accepts the (single) incoming request, verifying it leaves the list. */
export async function acceptIncoming(page: Page, requesterEmail: string): Promise<void> {
  await page.reload();
  await expect(page.locator("#view-app")).toBeVisible();
  await expect(page.locator("#incoming-list")).toContainText(requesterEmail);
  await page.locator("#incoming-list button.ok").first().click();
  await expect(page.locator("#friends-list")).toContainText(requesterEmail);
}

/**
 * Establishes an accepted friendship: A (already logged in on pageA) requests B,
 * B (logged in on pageB) accepts. Leaves both pages refreshed and friends.
 */
export async function becomeFriends(
  pageA: Page,
  emailA: string,
  pageB: Page,
  emailB: string,
): Promise<void> {
  await sendFriendRequest(pageA, emailB);
  await acceptIncoming(pageB, emailA);
  await pageA.reload();
  await expect(pageA.locator("#view-app")).toBeVisible();
  await expect(pageA.locator("#friends-list")).toContainText(emailB);
}
