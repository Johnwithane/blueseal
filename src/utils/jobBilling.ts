import type { JobDoc, LineItem } from "@/firebase/interfaces";

// Client mirror of functions/src/lib/billing.ts. A quote is "hourly" when any
// line is billed by the hour; otherwise "fixed". Used only as a fallback for
// legacy jobs that predate JobDoc.billingType — new jobs carry the field,
// stamped server-side at quote acceptance.
export type BillingType = "hourly" | "fixed";

export function billingTypeFromLineItems(lineItems: LineItem[] | undefined | null): BillingType {
  if (!Array.isArray(lineItems)) return "fixed";
  return lineItems.some((li) => li.kind === "hourly") ? "hourly" : "fixed";
}

// Resolve a job's billing type, preferring the stamped field and falling back
// to the accepted quote's line items (when passed) for legacy jobs.
export function jobBillingType(
  job: Pick<JobDoc, "billingType"> | null | undefined,
  quoteLineItems?: LineItem[] | null,
): BillingType {
  if (job?.billingType === "hourly" || job?.billingType === "fixed") return job.billingType;
  return billingTypeFromLineItems(quoteLineItems);
}
