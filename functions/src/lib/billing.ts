// Shared helper for classifying a job as hourly- vs fixed-priced from its
// accepted quote. A quote is "hourly" when ANY line item is billed by the hour
// (kind === "hourly"); otherwise it's "fixed" (flat labour + materials, or a
// legacy quote with no kinds). Stamped onto JobDoc.billingType at acceptance so
// clock-in + the UI never have to re-derive it. Kept tiny + dependency-free so
// it can be reused across callables and unit-tested in isolation.

export type BillingType = "hourly" | "fixed";

export interface QuoteLineKindLike {
  kind?: "hourly" | "labour" | "materials";
  taxRate?: number;
}

export function resolveBillingType(lineItems: QuoteLineKindLike[] | undefined | null): BillingType {
  if (!Array.isArray(lineItems)) return "fixed";
  return lineItems.some((li) => li?.kind === "hourly") ? "hourly" : "fixed";
}

/**
 * The default tax rate (a fraction, e.g. 0.13 for 13%) to apply to job-accrued
 * invoice lines — time, expenses, approved change orders — inherited from the
 * accepted quote. Without this those lines defaulted to 0% and a GST/HST-
 * registered tradesperson silently under-collected on every job-billables
 * invoice (P1-11). Stamped onto JobDoc.defaultTaxRate at acceptance, alongside
 * billingType, so pull-billables never has to re-derive it.
 *
 * Quotes carry a single rate across their lines, but a quote can include a $0
 * placeholder line at 0%; take the highest line rate so such a line can't drag
 * a real 13% quote down to 0. Returns 0 when the quote has no taxed lines.
 */
export function resolveDefaultTaxRate(
  lineItems: QuoteLineKindLike[] | undefined | null,
): number {
  if (!Array.isArray(lineItems)) return 0;
  let max = 0;
  for (const li of lineItems) {
    const r = li?.taxRate;
    if (typeof r === "number" && isFinite(r) && r > max) max = r;
  }
  return max;
}
