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
  | "draftInvoiceNote"
  | "updateJobLog"
  | "legacyTools"; // aiDiagnose/aiQuote/aiSummarize — slated for retirement into chat

export async function requireAiEntitlement(_uid: string, _feature: AiFeature): Promise<void> {
  // Subscription gating not yet live — see MONETIZATION.md. Intentionally a
  // no-op; per-call costs are still tracked via the aiUsage collection.
  return;
}

/**
 * Seam for gating tradesperson-created jobs ("bring your own client" /
 * solo-mode project tracking) behind a future paid tier. Founder decision
 * 2026-06-11: when the gate flips it should cap ACTIVE SOLO-JOB VOLUME (e.g.
 * N free, unlimited on Pro) — never the client invite link itself, because
 * every invite sent to an off-platform client is free user acquisition.
 * No-op until the subscription ships; createInviteJob must route through this.
 */
export async function requireInviteJobEntitlement(_uid: string): Promise<void> {
  return;
}
