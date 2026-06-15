import { test, expect, type Browser } from "@playwright/test";
import { login, uniqueEmail } from "./helpers/auth";
import { becomeFriends } from "./helpers/friends";

async function loggedInPage(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email);
  return { context, page };
}

test("a user can search, suggest a title to a friend, who marks it watched", async ({ browser }) => {
  const emailA = uniqueEmail("sender");
  const emailB = uniqueEmail("receiver");
  const a = await loggedInPage(browser, emailA);
  const b = await loggedInPage(browser, emailB);

  await becomeFriends(a.page, emailA, b.page, emailB);

  // A searches a real title via TMDB and opens the suggest modal on the first result.
  await a.page.fill("#search-query", "Inception");
  await a.page.selectOption("#search-type", "movie");
  await a.page.click("#search-form button[type=submit]");
  await expect(a.page.locator("#search-results")).toContainText("Inception");
  await a.page.locator("#search-results .result-card").first().click();

  await expect(a.page.locator("#suggest-modal")).toBeVisible();
  await a.page.selectOption("#suggest-friend", { label: emailB });
  await a.page.fill("#suggest-note", "A mind-bending classic.");
  await a.page.click("#suggest-form button[type=submit]");

  // Modal closes and the title shows up under "Sent suggestions" with status New.
  await expect(a.page.locator("#suggest-modal")).toBeHidden();
  const sentItem = a.page.locator("#sent-list .list-item").first();
  await expect(sentItem).toBeVisible();
  const href = await sentItem.locator("a.li-name").first().getAttribute("href");
  const imdbId = href?.match(/tt\d+/)?.[0];
  expect(imdbId).toBeTruthy();
  await expect(a.page.locator("#sent-list .badge").first()).toHaveText(/new/i);

  // B sees the same title under "Received suggestions" and marks it watched.
  // The list shows the resolved title; the IMDb link still carries the id.
  await b.page.reload();
  const receivedLink = b.page.locator("#received-list a.li-name").first();
  await expect(receivedLink).toBeVisible();
  await expect(receivedLink).toHaveAttribute("href", new RegExp(imdbId!));
  await expect(receivedLink).toHaveText(/inception/i);
  await b.page.locator("#received-list button.ok").first().click();
  await expect(b.page.locator("#received-list .badge").first()).toHaveText("Watched");

  // A's sent list reflects the watched status after a refresh.
  await a.page.reload();
  await expect(a.page.locator("#sent-list .badge").first()).toHaveText("Watched");

  await a.context.close();
  await b.context.close();
});

test("cannot suggest to someone who isn't a friend", async ({ browser }) => {
  // No friends → the suggest modal has no selectable friend and submit is disabled.
  const email = uniqueEmail("lonely");
  const { context, page } = await loggedInPage(browser, email);

  await page.fill("#search-query", "Inception");
  await page.click("#search-form button[type=submit]");
  await expect(page.locator("#search-results")).toContainText("Inception");
  await page.locator("#search-results .result-card").first().click();

  await expect(page.locator("#suggest-modal")).toBeVisible();
  await expect(page.locator("#suggest-friend")).toContainText(/no friends available/i);
  await expect(page.locator("#suggest-form button[type=submit]")).toBeDisabled();

  await context.close();
});
