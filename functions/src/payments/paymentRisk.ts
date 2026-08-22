/**
 * Front-door risk controls on card payments — pure, no Stripe/Firebase imports
 * so the thresholds stay trivially testable.
 *
 * WHY CAP CARD PAYMENTS AT ALL
 * The Blue Seal service fee is capped at $99 per job (serviceFee.ts
 * SERVICE_FEE_CAP_CENTS). Above roughly a $2,000 invoice the platform earns
 * nothing further — but the chargeback exposure keeps climbing, and on a
 * destination charge that exposure lands on the PLATFORM balance first
 * (disputeRecovery.ts). A $40,000 card payment is therefore all downside: same
 * $99 of revenue, forty times the loss if it is charged back and the connected
 * account is empty by then.
 *
 * The fee-free offline path (e-transfer / cash, recorded in the Service) is
 * already the cheaper option for both parties at that size, so the cap steers
 * large jobs there rather than blocking them. Every error message says so.
 *
 * WHY NEW TRADESPEOPLE GET A LOWER CAP
 * The classic Connect fraud is: onboard, run a stolen card through your own
 * connected account, withdraw before the chargeback lands. Blue Seal already
 * blunts it with manual ID + certification vetting and a 7-day payout hold; a
 * lower ceiling for the first few genuine jobs closes most of what's left, and
 * lifts by itself as the tradesperson builds a real payment history.
 */

/** Hard ceiling on any single card payment through the Service. */
export const MAX_CARD_PAYMENT_CENTS = 1_000_000; // CAD $10,000

/** Ceiling while a tradesperson is still establishing a payment history. */
export const NEW_TRADIE_CARD_CAP_CENTS = 250_000; // CAD $2,500

/** Paid jobs needed to leave the new-tradesperson band. */
export const NEW_TRADIE_PAID_JOBS = 3;

/** Days since vetting approval needed to leave the new-tradesperson band. */
export const NEW_TRADIE_DAYS = 30;

/**
 * Charge total above which we ask for a 3-D Secure challenge on every card,
 * not just where the issuer demands one.
 *
 * 3DS is the ONLY mechanism that genuinely moves fraud-chargeback liability off
 * the platform: an authenticated payment shifts it to the card issuer. The
 * tradeoff is checkout friction, so below this we let Stripe decide
 * ("automatic" — challenge only where required or where Radar is suspicious)
 * and above it we always ask.
 */
export const THREE_DS_FORCE_ABOVE_CENTS = 100_000; // CAD $1,000

/**
 * Still establishing a history? Either signal alone is enough — a brand-new
 * account with 5 same-day payments is exactly the pattern we're guarding
 * against, and so is a long-dormant account suddenly taking large payments.
 */
export function isNewTradesperson(input: {
  paidJobsCount: number;
  daysSinceApproved: number | null;
}): boolean {
  if (input.paidJobsCount < NEW_TRADIE_PAID_JOBS) return true;
  // Unknown approval date (pre-backfill docs) → don't invent risk; the paid-job
  // count above is the load-bearing signal.
  if (input.daysSinceApproved === null) return false;
  return input.daysSinceApproved < NEW_TRADIE_DAYS;
}

export interface CardPaymentAssessment {
  allowed: boolean;
  limitCents: number;
  isNew: boolean;
}

/**
 * Can this tradesperson take this card payment?
 *
 * @param baseAmountCents the invoice/upfront amount BEFORE the service fee —
 *        the limit is about the work being billed, so a fee that nudges the
 *        charge over the line can't fail an otherwise-fine payment.
 */
export function assessCardPayment(input: {
  baseAmountCents: number;
  paidJobsCount: number;
  daysSinceApproved: number | null;
}): CardPaymentAssessment {
  const isNew = isNewTradesperson(input);
  const limitCents = isNew ? NEW_TRADIE_CARD_CAP_CENTS : MAX_CARD_PAYMENT_CENTS;
  return { allowed: input.baseAmountCents <= limitCents, isNew, limitCents };
}

/** Stripe's `payment_method_options.card.request_three_d_secure`. */
export function threeDSecurePreference(chargeTotalCents: number): "automatic" | "any" {
  return chargeTotalCents > THREE_DS_FORCE_ABOVE_CENTS ? "any" : "automatic";
}

/** Whole dollars, for an error message a human reads. */
export function formatLimit(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-CA")}`;
}

/** Days between two instants, or null when the earlier one is unknown. */
export function daysSince(then: Date | null, now: Date): number | null {
  if (!then || Number.isNaN(then.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86_400_000));
}
