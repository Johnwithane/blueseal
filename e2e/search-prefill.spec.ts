import { test, expect, type Page } from "@playwright/test";

// Real-browser coverage for the "describe what you need" search entry point
// and the request pre-fill carrier. Runs against the built dist/ served by
// scripts/serve-dist.mjs (same harness as seo-smoke).
//
// Mobile-first: the design target is 375px, so this whole file runs at that
// viewport. The first test attaches a screenshot to the Playwright report so
// the search box is visually reviewable on every CI run.
//
// Note on scope: the request FORM itself (/request/:uid) is auth-gated
// (requiresAuth + role:client), so it can't be rendered by this static,
// auth-less harness — its pre-fill logic is covered by the unit tests in
// src/utils/requestPrefill.test.ts. What we prove end-to-end here is the
// public half: the keyword matcher in a real browser, and that searching with
// a description writes the carrier the form reads back.

test.use({ viewport: { width: 375, height: 812 } });

// A mounted PrimeVue button proves Vue actually hydrated (mirrors seo-smoke).
async function waitForHydration(page: Page) {
  await page.waitForSelector(".p-button", { timeout: 15_000 });
}

test.describe("describe-what-you-need search (375px)", () => {
  test("typing a plain-English problem suggests the right trade", async ({ page }, testInfo) => {
    await page.goto("/search");
    await waitForHydration(page);

    await page.locator("#describe").fill("my kitchen sink is leaking");

    // The instant keyword matcher should surface Plumber as a tappable chip.
    await expect(page.locator(".bs-suggestion", { hasText: "Plumber" })).toBeVisible();

    await testInfo.attach("search-describe-375", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  });

  test("the empty state shows example prompts", async ({ page }) => {
    await page.goto("/search");
    await waitForHydration(page);
    await expect(page.locator(".bs-chip").first()).toBeVisible();
  });

  test("searching with a description writes the request pre-fill carrier", async ({ page }) => {
    // Seed a search location so search() runs past its "pick a location" guard —
    // the carrier is written inside search(), before the Firestore query.
    await page.addInitScript(() => {
      localStorage.setItem(
        "searchLocation",
        JSON.stringify({ lat: 43.65, lng: -79.38, radiusKm: 50, label: "Toronto" }),
      );
    });
    await page.goto("/search");
    await waitForHydration(page);

    const text = "my kitchen sink is leaking";
    await page.locator("#describe").fill(text);
    // Tapping a suggestion sets the trade and runs the search, which stashes the
    // description for the request form to pick up after a tradesperson is chosen.
    await page.locator(".bs-suggestion", { hasText: "Plumber" }).click();

    await expect
      .poll(() =>
        page.evaluate(() => {
          try {
            const raw = localStorage.getItem("requestPrefill");
            return raw ? (JSON.parse(raw) as { text?: string }).text ?? null : null;
          } catch {
            return null;
          }
        }),
      )
      .toBe(text);
  });
});
