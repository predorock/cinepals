import { test, expect } from "@playwright/test";
import fs from "fs";
import { login, uniqueEmail } from "./helpers/auth";

// Read from the repo root (Playwright runs with cwd = project root).
const pkgVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version as string;

test("the personal Stremio addon manifest and catalog respond", async ({ page, request }) => {
  const email = uniqueEmail("addon");
  await login(page, email);

  const manifestUrl = await page.locator("#manifest-url").inputValue();
  expect(manifestUrl).toMatch(/\/u\/.+\/manifest\.json$/);

  // Manifest: valid Stremio addon descriptor.
  const manifestRes = await request.get(manifestUrl);
  expect(manifestRes.ok()).toBeTruthy();
  const manifest = await manifestRes.json();
  expect(manifest.id).toBeTruthy();
  expect(manifest.name).toBeTruthy();
  expect(Array.isArray(manifest.catalogs)).toBeTruthy();
  // The Stremio plugin version is kept in sync with package.json.
  expect(manifest.version).toBe(pkgVersion);

  // Catalog: the first declared catalog returns a metas array.
  const base = manifestUrl.replace(/\/manifest\.json$/, "");
  const cat = manifest.catalogs[0];
  if (cat) {
    const catRes = await request.get(`${base}/catalog/${cat.type}/${cat.id}.json`);
    expect(catRes.ok()).toBeTruthy();
    const catalog = await catRes.json();
    expect(Array.isArray(catalog.metas)).toBeTruthy();
  }
});

test("regenerating the token changes the addon URL", async ({ page }) => {
  const email = uniqueEmail("regen");
  await login(page, email);

  const before = await page.locator("#manifest-url").inputValue();

  page.once("dialog", (dialog) => dialog.accept()); // confirm() prompt
  await page.click("#regen-token-btn");

  await expect(page.locator("#manifest-url")).not.toHaveValue(before);
  await expect(page.locator("#manifest-url")).toHaveValue(/\/u\/.+\/manifest\.json$/);
});
