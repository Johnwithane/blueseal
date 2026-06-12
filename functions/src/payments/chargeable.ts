import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../lib/admin";

interface TradiePayouts {
  stripeAccountId?: string | null;
  payoutsEnabled?: boolean;
  onboardingStatus?: "not_started" | "in_progress" | "restricted" | "enabled";
}

/**
 * Assert a tradesperson can receive a destination charge, returning their
 * Stripe connected-account id. Shared by the invoice + upfront-fee payment
 * callables. The error messages point the client at the fee-free offline path
 * (mark-as-paid) rather than dead-ending them.
 */
export async function assertTradieChargeable(tradespersonId: string): Promise<string> {
  const snap = await db.doc(`tradespeople/${tradespersonId}`).get();
  const payouts = (snap.data()?.payouts ?? {}) as TradiePayouts;
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
  return payouts.stripeAccountId;
}
