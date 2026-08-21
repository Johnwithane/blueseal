import { HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";
import { assessCardPayment, daysSince, formatLimit } from "./paymentRisk";

interface TradiePayouts {
  stripeAccountId?: string | null;
  payoutsEnabled?: boolean;
  onboardingStatus?: "not_started" | "in_progress" | "restricted" | "enabled";
}

/** Admin kill switch + risk state for card payments. Server-written only. */
interface TradiePayments {
  cardPaymentsPausedAt?: { toDate?: () => Date } | null;
  cardPaymentsPausedReason?: string | null;
}

export interface ChargeableTradie {
  stripeAccountId: string;
  /** Business name for the statement descriptor suffix; null if unusable. */
  businessName: string | null;
}

/** Firestore Timestamp-ish → Date. */
function toDate(v: unknown): Date | null {
  const t = (v ?? null) as { toDate?: () => Date } | null;
  if (!t || typeof t.toDate !== "function") return null;
  try {
    return t.toDate();
  } catch {
    return null;
  }
}

/**
 * Assert a tradesperson can receive a destination charge of this size,
 * returning their Stripe connected-account id plus the name to put on the
 * client's card statement. Shared by the invoice + upfront-fee payment
 * callables, so every card payment passes the same four gates:
 *
 *   1. Connect onboarding finished and not restricted;
 *   2. card payments not paused for this tradesperson by an admin
 *      (ToS § 7.7 — the button behind the right we reserved);
 *   3. the amount within the card-payment ceiling for their history
 *      (paymentRisk.ts);
 *   4. …and only then, the charge.
 *
 * Every refusal points at the fee-free offline path (mark-as-paid) rather than
 * dead-ending the client: nothing here means the work can't be paid for, only
 * that it shouldn't ride on a card through Blue Seal.
 *
 * @param baseAmountCents the invoice or upfront amount BEFORE the service fee.
 */
export async function assertTradieChargeable(
  tradespersonId: string,
  baseAmountCents: number,
): Promise<ChargeableTradie> {
  const snap = await db.doc(`tradespeople/${tradespersonId}`).get();
  const data = snap.data() ?? {};
  const payouts = (data.payouts ?? {}) as TradiePayouts;
  if (!payouts.payoutsEnabled || !payouts.stripeAccountId) {
    throw new HttpsError(
      "failed-precondition",
      "This tradesperson hasn't finished payment setup yet — you can still pay them by e-transfer or cash.",
    );
  }
  if (payouts.onboardingStatus === "restricted") {
    throw new HttpsError(
      "failed-precondition",
      "This tradesperson's payment account needs attention — pay by e-transfer or cash for now.",
    );
  }

  // Admin kill switch. Deliberately vague to the client: the reason is a risk
  // note for us, not something to relay to whoever is holding the card.
  const payments = (data.payments ?? {}) as TradiePayments;
  if (payments.cardPaymentsPausedAt) {
    logger.warn("assertTradieChargeable: card payments paused", {
      tradespersonId,
      reason: payments.cardPaymentsPausedReason ?? null,
    });
    throw new HttpsError(
      "failed-precondition",
      "Card payments are temporarily unavailable for this tradesperson — you can still pay by e-transfer or cash.",
    );
  }

  const assessment = assessCardPayment({
    baseAmountCents,
    paidJobsCount: typeof data.paidJobsCount === "number" ? data.paidJobsCount : 0,
    daysSinceApproved: daysSince(toDate(data.approvedAt), new Date()),
  });
  if (!assessment.allowed) {
    logger.info("assertTradieChargeable: over the card-payment ceiling", {
      tradespersonId,
      baseAmountCents,
      limitCents: assessment.limitCents,
      isNew: assessment.isNew,
    });
    throw new HttpsError(
      "failed-precondition",
      `Card payments through Blue Seal are limited to ${formatLimit(assessment.limitCents)} per payment${
        assessment.isNew ? " while a tradesperson is new to Blue Seal" : ""
      }. For a job this size, pay by e-transfer or cash — that's fee-free — and record it here.`,
    );
  }

  // companyName is the registered business ("ABC Mechanical Ltd."); sole
  // proprietors leave it null and the client only ever sees the display name,
  // so that's the right fallback for what they'll recognize on a statement.
  const companyName = typeof data.companyName === "string" ? data.companyName : null;
  const displayName = typeof data.displayName === "string" ? data.displayName : null;
  return {
    stripeAccountId: payouts.stripeAccountId,
    businessName: companyName ?? displayName,
  };
}
