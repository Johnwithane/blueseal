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
  if (!(await intake.isVisible().catch(() => false))) return;
  const fields = intake.locator(".bs-form > div");
  const n = await fields.count();
  for (let i = 0; i < n; i++) {
    const f = fields.nth(i);
    if (await f.locator(".p-selectbutton button").count()) {
      await f.locator(".p-selectbutton button").first().click(); // boolean → "Yes"
    } else if (await f.locator(".p-select").count()) {
      await f.locator(".p-select").click();
      await page.getByRole("option").first().click();
    } else if (await f.locator(".p-multiselect").count()) {
      await f.locator(".p-multiselect").click();
      await page.getByRole("option").first().click();
      await page.keyboard.press("Escape");
    } else if (await f.locator(".p-inputnumber input").count()) {
      await f.locator(".p-inputnumber input").fill("2");
    } else if (await f.locator("textarea").count()) {
      await f.locator("textarea").fill("QA test answer.");
    } else if (await f.locator(".p-datepicker input").count()) {
      await f.locator(".p-datepicker input").fill("06/20/2026");
    } else if (await f.locator("input").count()) {
      await f.locator("input").first().fill("QA");
    }
  }
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
    const msgs = await page.evaluate(() =>
      [...document.querySelectorAll("main *")]
        .filter((el) => (el as HTMLElement).offsetParent && /enter|required|add (a|at least)|must|missing|valid/i.test((el as HTMLElement).innerText || ""))
        .map((el) => (el as HTMLElement).innerText.trim().slice(0, 80))
        .filter((s, i, a) => s && a.indexOf(s) === i)
        .slice(0, 8),
    );
    throw new Error(`postJob did not navigate (url=${page.url()}); validation: ${JSON.stringify(msgs)}`);
  }
}

// Tradesperson browses the job board and confirms a posted job by title.
export async function browseFindsJob(page: Page, title: string): Promise<void> {
  await page.goto("/jobs/browse");
  await settle(page);
  await expect(page.getByText(title, { exact: false }).first()).toBeVisible({ timeout: 25_000 });
}
