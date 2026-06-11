/**
 * Single seam for AI feature entitlement.
 *
 * ALL AI features (assistant chat, reply suggestions, receipt OCR, quote /
 * invoice drafting) are slated to become part of a paid subscription
 * (Blue Seal Pro — MONETIZATION.md §3.3, founder-approved 2026-06-03 but NOT
 * yet live). Until it ships, every caller passes — this is deliberately a
 * no-op so launching the plan is a one-file change: look up the caller's
 * subscription here and throw HttpsError("permission-denied", …) per feature.
 *
 * The feature key exists so the gate can be flipped per-feature (e.g. receipt
 * OCR may stay on the free tier longer than the drafting tools — that call is
 * made at flip time, not here). EVERY AI callable must route through this.
 */
export type AiFeature =
  | "chat"
  | "suggestReplies"
  | "receiptOcr"
  | "draftQuote"
  | "draftInvoiceNote";

export async function requireAiEntitlement(_uid: string, _feature: AiFeature): Promise<void> {
  // Subscription gating not yet live — see MONETIZATION.md. Intentionally a
  // no-op; per-call costs are still tracked via the aiUsage collection.
  return;
}
