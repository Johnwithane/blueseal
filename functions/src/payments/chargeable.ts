import { HttpsError } from "firebase-functions/v2/https";
import { db } from "../lib/admin";

interface TradiePayouts {
  stripeAccountId?: string | null;
  payoutsEnabled?: boolean;
  onboardingStatus?: "not_started" | "in_progress" | "restricted" | "enabled";
}

export interface ChargeableTradie {
  stripeAccountId: string;
  /** Business name for the statement descriptor suffix; null if unusable. */
  businessName: string | null;
}

/**
 * Assert a tradesperson can receive a destination charge, returning their
 * Stripe connected-account id plus the name to put on the client's card
 * statement. Shared by the invoice + upfront-fee payment callables. The error
 * messages point the client at the fee-free offline path (mark-as-paid) rather
 * than dead-ending them.
 */
export async function assertTradieChargeable(
  tradespersonId: string,
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
