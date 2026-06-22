import { test, expect, type Page } from "@playwright/test";

// Launch phase mirrors the build (Vite inlines VITE_LAUNCH_PHASE from the same
// process env). Default is supply-first "onboarding": the consumer marketplace
// (search, trade + city pages) is noindex and out of the sitemap/llms.txt, and
// the homepage recruits tradespeople. Set VITE_LAUNCH_PHASE=public to flip.
const IS_ONBOARDING = (process.env.VITE_LAUNCH_PHASE ?? "onboarding") !== "public";
// Homepage orientation is decoupled from the index gate (see seo/site.ts
// RECRUIT_HOMEPAGE): the homepage leads clients to "post a job" by default and
// only pitches tradespeople when VITE_HOMEPAGE_HERO=recruit.
const RECRUIT_HOMEPAGE = process.env.VITE_HOMEPAGE_HERO === "recruit";
const EXPECTED_HOME_TITLE = RECRUIT_HOMEPAGE
  ? "Get verified, get more work in the Okanagan | Blue Seal"
  : "Blue Seal: Verified Canadian Tradespeople";

// Real-browser smoke for the SEO/prerender work. Two halves:
//  1. Raw HTTP (no JS) — proves the prerendered HTML + 200.html fallback are
//     served, exactly as a non-JS crawler / LLM bot would see them.
//  2. Hydrated browser — proves the app boots with @unhead active (no crash),
//     the <head> is correct, and unhead ADOPTS the baked tags instead of
//     duplicating them (the assumption the whole prerender strategy rests on).

// Waiting for a PrimeVue button proves Vue actually mounted — i.e. createHead()
// in main.ts and useSeo() in the view didn't throw. If they did, the live app
// never renders and this times out, failing the test.
async function waitForHydration(page: Page) {
  await page.waitForSelector(".p-button", { timeout: 15_000 });
}

const headCounts = (page: Page) =>
  page.evaluate(() => ({
    canonical: document.querySelectorAll('link[rel="canonical"]').length,
    description: document.querySelectorAll('meta[name="description"]').length,
    ogTitle: document.querySelectorAll('meta[property="og:title"]').length,
    jsonLd: document.querySelectorAll('script[type="application/ld+json"]').length,
  }));

test.describe("prerendered HTML (no JavaScript)", () => {
  test("serves a per-trade landing page with baked title, content + Service JSON-LD", async ({
    request,
  }) => {
    const res = await request.get("/trades/plumber");
    expect(res.ok()).toBeTruthy();
    const html = await res.text();
    expect(html).toContain("<title>Hire a verified Plumber in Canada | Blue Seal</title>");
    expect(html).toContain("<h1>Hire a verified Plumber in Canada</h1>");
    expect(html).toContain('"@type":"Service"');
    expect(html).toContain('<link rel="canonical" href="https://blueseal.app/trades/plumber" />');
    expect((html.match(/rel="canonical"/g) ?? []).length).toBe(1);
  });

  test("serves a help article with baked Article JSON-LD", async ({ request }) => {
    const html = await (await request.get("/help/get-verified")).text();
    expect(html).toContain("| Blue Seal</title>");
    expect(html).toContain('"@type":"Article"');
    expect((html.match(/rel="canonical"/g) ?? []).length).toBe(1);
  });

  test("falls back to a neutral 200.html for dynamic/app routes", async ({ request }) => {
    const html = await (await request.get("/dashboard")).text();
    expect(html).not.toContain("Hire a verified");
    expect(html).toContain('href="https://blueseal.app/"'); // default canonical, not a page-specific one
  });

  test("sitemap lists indexed content, gates the marketplace by phase, excludes auth pages", async ({
    request,
  }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    expect(xml).toContain("<loc>https://blueseal.app/help/get-verified</loc>");
    expect(xml).not.toContain("sign-in");
    // Supply-first: the consumer marketplace is held out of the index while
    // onboarding, then included once public.
    if (IS_ONBOARDING) {
      expect(xml).not.toContain("<loc>https://blueseal.app/trades/plumber</loc>");
    } else {
      expect(xml).toContain("<loc>https://blueseal.app/trades/plumber</loc>");
    }
  });

  test("robots.txt + llms.txt resolve", async ({ request }) => {
    expect((await request.get("/robots.txt")).ok()).toBeTruthy();
    const llms = await (await request.get("/llms.txt")).text();
    expect(llms).toContain("# Blue Seal");
    // Trade pages appear in llms.txt only when the marketplace is public.
    if (IS_ONBOARDING) expect(llms).not.toContain("/trades/plumber");
    else expect(llms).toContain("/trades/plumber");
  });
});

test.describe("hydrated app (@unhead active)", () => {
  test("homepage boots and has single, correct head tags", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);

    await expect(page).toHaveTitle(EXPECTED_HOME_TITLE);
    const counts = await headCounts(page);
    // No duplicates after hydration: unhead adopted the baked tags in place.
    expect(counts.canonical).toBe(1);
    expect(counts.description).toBe(1);
    expect(counts.ogTitle).toBe(1);
    // Home bakes Organization + WebSite (+ FAQPage on the client-first homepage);
    // hydration must not double them.
    expect(counts.jsonLd).toBe(RECRUIT_HOMEPAGE ? 2 : 3);
  });

  test("a trade page boots and keeps single head tags", async ({ page }) => {
    await page.goto("/trades/electrician");
    await waitForHydration(page);

    await expect(page).toHaveTitle("Hire a verified Electrician in Canada | Blue Seal");
    const counts = await headCounts(page);
    expect(counts.canonical).toBe(1);
    expect(counts.description).toBe(1);
    const canonicalHref = await page.getAttribute('link[rel="canonical"]', "href");
    expect(canonicalHref).toBe("https://blueseal.app/trades/electrician");
  });

  test("client-side navigation updates the head without a full reload", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);

    // Marker survives a client-side (SPA) navigation but is wiped by a full reload.
    await page.evaluate(() => {
      (window as Window & { __e2e?: number }).__e2e = 1;
    });
    await page.click('footer a[href="/trades"]');
    await page.waitForFunction(() => document.title.toLowerCase().includes("trade"));

    const persisted = await page.evaluate(
      () => (window as Window & { __e2e?: number }).__e2e === 1,
    );
    expect(persisted, "expected SPA navigation, not a full reload").toBe(true);
    await expect(page).toHaveTitle(/trade/i);
    const canonical = await page.evaluate(
      () => document.querySelectorAll('link[rel="canonical"]').length,
    );
    expect(canonical).toBe(1);
  });
});
