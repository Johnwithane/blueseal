/**
 * Single seam for AI feature entitlement (Blue Seal Pro — MONETIZATION.md).
 *
 * Gating is LIVE: every AI feature except receipt OCR requires an active Pro
 * subscription (trialing / active / past_due grace) or an unexpired founding
 * comp. Receipt OCR stays free forever — it's the free-tier hook. Admins hold
 * every entitlement. The feature key lets us flip any single feature's tier
 * later without touching call sites. EVERY AI callable routes through this.
 *
 * Throws with the stable `BLUESEAL_PRO_REQUIRED` message token so the client
 * can tell a paywall from other failed-precondition errors.
 */
import { HttpsError } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "./admin";
import { deriveIsPro, type SubscriptionState } from "./subscription";

export type AiFeature =
  | "chat"
  | "suggestReplies"
  | "receiptOcr"
  | "draftQuote"
  | "draftInvoiceNote"
  | "updateJobLog"
  | "legacyTools"; // aiDiagnose/aiQuote/aiSummarize — slated for retirement into chat

export async function requireAiEntitlement(uid: string, feature: AiFeature): Promise<void> {
  // Receipt OCR is free for everyone (the time saved is the strongest "aha"
  // for a free tradesperson evaluating the app). Per-call costs are still
  // tracked via the rate limiter at the call site.
  if (feature === "receiptOcr") return;

  const snap = await db.doc(`users/${uid}`).get();
  const data = snap.data() ?? {};
  const roles = Array.isArray(data.roles) ? (data.roles as unknown[]) : [];
  if (roles.includes("admin")) return; // admins hold every entitlement

  const sub = (data.subscription ?? null) as SubscriptionState | null;
  if (deriveIsPro(sub, Timestamp.now())) return;

  throw new HttpsError(
    "failed-precondition",
    "BLUESEAL_PRO_REQUIRED: The AI assistant is part of Blue Seal Pro. Start a free trial to use it.",
  );
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
