import { type Page, expect } from "@playwright/test";
import { settle } from "./auth";
import { uploadImage } from "./uploads";

export interface JobInput {
  trade: string; // e.g. "Plumber" (must match the tradie's verified trade)
  title: string;
  description: string;
}

// Fill the trade-specific intake questionnaire generically by control type
// (boolean Yes/No, select, multiselect, number, date, text, textarea). Scoped to
// the [data-field="intake"] wrapper; no-ops when the trade has no questionnaire.
export async function fillIntake(page: Page): Promise<void> {
  const intake = page.locator('[data-field="intake"]');
  // Wait for the questionnaire to render after the trade is chosen.
  if (!(await intake.isVisible({ timeout: 5000 }).catch(() => false))) return;
  await page.waitForTimeout(400);
  const fields = intake.locator(".bs-form > div");
  const n = await fields.count();
  for (let i = 0; i < n; i++) {
    const f = fields.nth(i);
    await f.scrollIntoViewIfNeeded().catch(() => {});
    if (await f.locator(".p-selectbutton button").count()) {
      await f.locator(".p-selectbutton button").first().click(); // boolean → "Yes"
    } else if (await f.locator(".p-select").count()) {
      await f.locator(".p-select").click();
      const overlay = page.locator(".p-select-overlay");
      await overlay.waitFor({ state: "visible", timeout: 5000 });
      await overlay.getByRole("option").first().click();
    } else if (await f.locator(".p-multiselect").count()) {
      await f.locator(".p-multiselect").click();
      const overlay = page.locator(".p-multiselect-overlay");
      await overlay.waitFor({ state: "visible", timeout: 5000 });
      await overlay.getByRole("option").first().click();
      await page.keyboard.press("Escape").catch(() => {});
    } else if (await f.locator(".p-inputnumber input").count()) {
      await f.locator(".p-inputnumber input").fill("2");
    } else if (await f.locator("textarea").count()) {
      await f.locator("textarea").fill("QA test answer.");
    } else if (await f.locator(".p-datepicker input").count()) {
      await f.locator(".p-datepicker input").fill("06/20/2026");
    } else if (await f.locator("input").count()) {
      await f.locator("input").first().fill("QA");
    }
    await page.waitForTimeout(120); // let reactivity settle before the next field
  }
}

// Cancel the client's currently-listed job posts so runs don't pile up against
// the 5-open-posts cap. Visits each post on the "Posted jobs" tab and cancels
// the ones still open (skips already-cancelled). Returns how many it closed.
export async function closeOpenPosts(page: Page): Promise<number> {
  await page.goto("/dashboard/client");
  await settle(page);
  const tab = page.getByRole("button", { name: "Posted jobs", exact: true });
  if (await tab.count()) {
    await tab.first().click();
    await settle(page);
  }
  const hrefs = (await page
    .locator('a[href^="/jobs/posted/"]')
    .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href")))) as string[];
  const unique = [...new Set(hrefs.filter(Boolean))];
  let closed = 0;
  for (const h of unique) {
    await page.goto(h);
    await settle(page);
    const cancel = page.getByRole("button", { name: "Cancel job", exact: true });
    if (!(await cancel.count())) continue; // already cancelled / not open
    await cancel.first().click();
    await page.getByRole("button", { name: "Yes, cancel" }).click({ timeout: 8000 }).catch(() => {});
    await settle(page);
    closed++;
  }
  return closed;
}

// Client posts a job to the board via /jobs/post, using the "fill out the whole
// form" escape hatch (all fields at once — less fragile than the step wizard).
export async function postJob(page: Page, job: JobInput): Promise<void> {
  await page.goto("/jobs/post");
  await settle(page);
  await page.getByRole("button", { name: /fill out the whole form/i }).click();

  // Trade (the first .p-select on the page; urgency is the later one).
  await page.locator(".p-select").first().click();
  const tradeFilter = page.locator(".p-select-overlay input, .p-select-overlay .p-inputtext").first();
  if (await tradeFilter.count()) await tradeFilter.fill(job.trade);
  await page.getByRole("option", { name: job.trade, exact: true }).first().click();

  // Trade-specific intake questionnaire (required for most trades).
  await fillIntake(page);

  await page.locator('input[placeholder*="Replace dripping"]').fill(job.title);
  await page.locator("textarea").first().fill(job.description);

  await uploadImage(page.locator('input[type="file"]').first());

  // Budget range (required).
  const budget = page.locator('[data-field="budget"] input');
  await budget.nth(0).fill("200");
  await budget.nth(1).fill("800");

  // Address — free text geocodes at submit; city/region/postal required.
  await page.locator('input[placeholder*="Start typing your address"]').fill("1500 Water St");
  await page.locator('input[placeholder="City"]').fill("Kelowna");
  await page.locator('input[placeholder="Province"]').fill("BC");
  await page.locator('input[placeholder*="Postal"]').fill("V1Y 1A1");

  await page.locator("main").getByRole("button", { name: "Post job", exact: true }).click();
  // Success → the posted-job detail / list. If it doesn't navigate, surface the
  // validation message so the blocker is obvious.
  const ok = await page
    .waitForURL((u) => u.pathname.startsWith("/jobs/posted"), { timeout: 25_000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    const intakeInfo = await page.evaluate(() => {
      const root = document.querySelector('[data-field="intake"]');
      if (!root) return "NO_INTAKE";
      return [...root.querySelectorAll(".bs-form > div")].map((d) => {
        const label = (d.querySelector("label")?.textContent || "").trim().slice(0, 30);
        const sel = (d.querySelector(".p-select-label")?.textContent || "").trim();
        const toggleOn = (d.querySelector(".p-togglebutton-checked, [aria-pressed='true'], .p-button-active") || {}).textContent?.trim() || "";
        const ta = (d.querySelector("textarea") as HTMLTextAreaElement)?.value || "";
        return `${label} | sel="${sel}" toggle="${toggleOn}" ta="${ta.slice(0, 8)}"`;
      });
    });
    console.log("[intake-debug] " + JSON.stringify(intakeInfo));
    const msgs = await page.evaluate(() => {
      const messages = [...document.querySelectorAll(".p-message, [role='alert']")]
        .filter((e) => (e as HTMLElement).offsetParent)
        .map((e) => (e as HTMLElement).innerText.trim().slice(0, 120));
      const smalls = [...document.querySelectorAll("small, .text-xs")]
        .filter((e) => (e as HTMLElement).offsetParent && /enter|required|add at least|must|invalid|couldn|find/i.test((e as HTMLElement).innerText || ""))
        .map((e) => (e as HTMLElement).innerText.trim().slice(0, 80));
      return { messages, smalls: smalls.slice(0, 6) };
    });
    throw new Error(`postJob did not navigate (url=${page.url()}); errors: ${JSON.stringify(msgs)}`);
  }
}

// Tradesperson browses the job board and confirms a posted job by title.
export async function browseFindsJob(page: Page, title: string): Promise<void> {
  await page.goto("/jobs/browse");
  await settle(page);
  await expect(page.getByText(title, { exact: false }).first()).toBeVisible({ timeout: 25_000 });
}

// From the board, open a job and apply with a one-line flat-rate itemized quote.
// Assumes the tradie is on /jobs/browse with the job visible.
export async function applyWithQuote(
  page: Page,
  opts: { title: string; description: string; amount: number },
): Promise<void> {
  await page.getByText(opts.title, { exact: false }).first().click();
  await settle(page);

  // The quote composer renders after the job's data loads — wait for it (text
  // locators avoid PrimeVue accessible-name quirks; the first "Flat rate" is the
  // line's kind chip, the add-another-line button comes after).
  const flatRate = page.locator('button:has-text("Flat rate")').first();
  await flatRate.waitFor({ state: "visible", timeout: 30_000 });
  await flatRate.click();

  await page.locator('input[placeholder*="Install new shower"]').first().fill(opts.description);
  // The line's Amount is the first .p-inputnumber (before tax/discount/upfront).
  await page.locator(".p-inputnumber input").first().fill(String(opts.amount));

  // Cover message (advisory ≥20 chars).
  const cover = page.locator('textarea[placeholder*="good fit"]');
  if (await cover.count()) await cover.fill("I can start this week and finish in two days — quality guaranteed.");

  // "Send quote" submit (distinct from the "Send a quote" mode tab).
  await page.locator('button:has-text("Send quote")').first().click();
  // An uninsured tradesperson gets a "Are you covered?" reminder first — proceed.
  await page
    .getByRole("button", { name: /continue without insurance/i })
    .click({ timeout: 8000 })
    .catch(() => {});
  await settle(page);
}

// After applying, the tradie's view shows their submitted application instead of
// the composer. Returns true if a "quote sent" / applied state is detectable.
export async function quoteWasSent(page: Page): Promise<boolean> {
  return (
    (await page.getByText(/quote sent|you applied|your quote|application sent|withdraw/i).count()) > 0
  );
}
