import { type Page, expect } from "@playwright/test";
import { settle } from "./auth";

// Drive the /qa toolkit to make the signed-in (qa) account an approved, visible
// tradesperson on the given trade(s). Mirrors a tester clicking through /qa.
export async function provisionTradie(page: Page, tradeLabel = "Plumber"): Promise<void> {
  await page.goto("/qa");
  await settle(page);

  // Open the trades MultiSelect, filter to the trade, tick it, close the panel.
  await page.locator(".p-multiselect").first().click();
  // The overlay contains option checkboxes too; the filter is the text input.
  const filter = page.locator('.p-multiselect-overlay input:not([type="checkbox"])').first();
  await filter.fill(tradeLabel);
  await page.getByRole("option", { name: tradeLabel, exact: false }).first().click();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Provision me" }).click();
  // Success surfaces as the "Approved on: …" message in the card.
  await expect(page.getByText(/Approved on:/i)).toBeVisible({ timeout: 30_000 });
}

// Toggle the signed-in (qa) account's own Pro entitlement via /qa.
export async function setSelfPro(page: Page, pro: boolean): Promise<void> {
  await page.goto("/qa");
  await settle(page);
  await page.getByRole("button", { name: pro ? "Enable Pro" : "Disable Pro" }).click();
  await expect(page.getByText(new RegExp(pro ? "Pro enabled|now Pro" : "Pro disabled|now Free", "i"))).toBeVisible({
    timeout: 30_000,
  });
}

// Reset the signed-in (qa) account's own jobs/posts/applications between runs.
export async function resetSelfData(page: Page): Promise<void> {
  await page.goto("/qa");
  await settle(page);
  await page.getByRole("button", { name: "Reset my data" }).click();
  await page.getByRole("button", { name: "Yes, reset" }).click();
  await expect(page.getByText(/Reset done/i)).toBeVisible({ timeout: 30_000 });
}
