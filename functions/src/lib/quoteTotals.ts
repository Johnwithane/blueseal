import { HttpsError } from "firebase-functions/v2/https";

// Shared quote/invoice math. Lifted from submitQuote.ts so the marketplace
// per-applicant quote path (submitApplication / acceptApplicationQuote) bills
// against exactly the same totals + upfront-fee rules as the direct-request
// quote flow. Mirrors the client-side recomputeTotals in
// src/firebase/services/invoices.ts — keep the two in sync.

export interface QuoteLineItem {
  kind?: "hourly" | "labour" | "materials";
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

export interface QuoteDiscount {
  type: "percent" | "fixed";
  value: number;
  label: string | null;
}

export interface QuoteTotals {
  subtotal: number;
  discountAmount: number;
  taxTotal: number;
  total: number;
}

/**
 * Sum line items, apply the discount to the pre-tax subtotal, then tax each
 * line on its discount-adjusted share. Returns integer cents throughout.
 */
export function computeTotals(
  items: QuoteLineItem[],
  discount: QuoteDiscount | null,
): QuoteTotals {
  let subtotal = 0;
  for (const li of items) subtotal += li.quantity * li.unitPrice;

  let discountAmount = 0;
  if (discount && subtotal > 0) {
    if (discount.type === "percent") {
      const pct = Math.max(0, Math.min(100, discount.value));
      discountAmount = Math.round((subtotal * pct) / 100);
    } else {
      discountAmount = Math.max(0, Math.min(subtotal, Math.round(discount.value)));
    }
  }

  const factor = subtotal > 0 ? (subtotal - discountAmount) / subtotal : 1;
  let taxTotal = 0;
  for (const li of items) {
    const lineSub = li.quantity * li.unitPrice;
    taxTotal += Math.round(lineSub * factor * li.taxRate);
  }

  return { subtotal, discountAmount, taxTotal, total: subtotal - discountAmount + taxTotal };
}

// Upfront-fee input shape (discriminated union): the client passes either a
// fixed dollar amount or a percentage (bps). We re-derive the cents
// server-side from the pre-tax base so the snapshot can never drift below the
// agreed percentage.
export type UpfrontFeeInput =
  | { type: "fixed"; amountCents: number }
  | { type: "percent"; bps: number };

export interface ResolvedUpfrontFee {
  type: "fixed" | "percent";
  bps?: number;
  amountCents: number;
}

/**
 * Resolve the upfront fee against the pre-tax discounted subtotal. For
 * "percent" we derive the cents from bps; for "fixed" we clamp to the pre-tax
 * base so the fee can't exceed the quote. Returns null when no fee was
 * requested; throws HttpsError("failed-precondition") when the fee resolves to
 * zero or negative.
 */
export function resolveUpfrontFee(
  input: UpfrontFeeInput | null | undefined,
  preTaxBase: number,
): ResolvedUpfrontFee | null {
  if (!input) return null;
  if (input.type === "percent") {
    const cents = Math.round((preTaxBase * input.bps) / 10_000);
    if (cents <= 0) {
      throw new HttpsError(
        "failed-precondition",
        "Upfront fee resolves to zero — increase the percentage or pick a fixed amount.",
      );
    }
    return { type: "percent", bps: input.bps, amountCents: cents };
  }
  const cents = Math.min(input.amountCents, preTaxBase);
  if (cents <= 0) {
    throw new HttpsError("failed-precondition", "Upfront fee must be greater than zero.");
  }
  return { type: "fixed", amountCents: cents };
}
