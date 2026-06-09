// Shared helper for classifying a job as hourly- vs fixed-priced from its
// accepted quote. A quote is "hourly" when ANY line item is billed by the hour
// (kind === "hourly"); otherwise it's "fixed" (flat labour + materials, or a
// legacy quote with no kinds). Stamped onto JobDoc.billingType at acceptance so
// clock-in + the UI never have to re-derive it. Kept tiny + dependency-free so
// it can be reused across callables and unit-tested in isolation.

export type BillingType = "hourly" | "fixed";

export interface QuoteLineKindLike {
  kind?: "hourly" | "labour" | "materials";
}

export function resolveBillingType(lineItems: QuoteLineKindLike[] | undefined | null): BillingType {
  if (!Array.isArray(lineItems)) return "fixed";
  return lineItems.some((li) => li?.kind === "hourly") ? "hourly" : "fixed";
}
