/**
 * Blue Seal service-fee math — pure, no Stripe/firebase imports so it stays
 * trivially testable and importable anywhere.
 *
 * The client pays `chargeTotalCents`; the tradesperson nets `baseAmountCents`
 * (their invoice/upfront amount) exactly. The fee the client pays is:
 *   platformPortion  — Blue Seal's 5%, $2 floor, capped $99 PER JOB (cumulative
 *                      across the job's card payments), waived when the
 *                      tradesperson is Pro.
 *   processingPortion — a gross-up that covers Stripe's 2.9% + 30¢ on the whole
 *                      charge, so the platform's portion stays whole. Applies
 *                      even when the platform portion is waived (at cost).
 *
 * Mirrored at src/utils/serviceFee.ts (client-side, estimates only — the server
 * snapshot written at PaymentIntent creation is always authoritative). Keep the
 * two in sync; the worked examples + invariants are pinned in
 * src/utils/serviceFee.test.ts.
 */

export const FEE_MODEL_VERSION = 2; // v1 = the retired 12% commission
export const SERVICE_FEE_BPS = 500; // 5%
export const SERVICE_FEE_CAP_CENTS = 9900; // $99 CAD per job (cumulative)
export const SERVICE_FEE_FLOOR_CENTS = 200; // $2 CAD
export const STRIPE_RATE = 0.029; // 2.9% (Stripe CA domestic card)
export const STRIPE_FIXED_CENTS = 30; // $0.30

export interface ServiceFeeQuote {
  feeModelVersion: number;
  baseAmountCents: number;
  platformPortionCents: number;
  processingPortionCents: number;
  totalFeeCents: number;
  chargeTotalCents: number;
  capApplied: boolean;
  floorApplied: boolean;
  waived: boolean;
}

/**
 * @param baseAmountCents the tradesperson's invoice total or upfront amount
 *        (positive integer cents). The fee is computed ON TOP of this.
 * @param waived          true when the tradesperson is Pro — zeroes the
 *        platform portion (the client still covers processing, at cost).
 * @param capUsedCents    platform-fee cents already collected for this job
 *        (job.serviceFeeCapUsedCents); the cap binds against the remainder.
 */
export function computeServiceFee(opts: {
  baseAmountCents: number;
  waived: boolean;
  capUsedCents?: number;
}): ServiceFeeQuote {
  const base = opts.baseAmountCents;
  if (!Number.isInteger(base) || base <= 0) {
    throw new Error(
      `computeServiceFee: baseAmountCents must be a positive integer, got ${base}`,
    );
  }
  const capUsed = opts.capUsedCents ?? 0;
  const capRemaining = Math.max(0, SERVICE_FEE_CAP_CENTS - capUsed);

  const raw = Math.round((base * SERVICE_FEE_BPS) / 10_000);

  let platformPortion = 0;
  let floorApplied = false;
  let capApplied = false;
  if (!opts.waived) {
    // Floor first, cap last — an exhausted cap must yield 0, not the $2 floor.
    const floored = Math.max(raw, SERVICE_FEE_FLOOR_CENTS);
    const capped = Math.min(floored, capRemaining);
    platformPortion = capped;
    capApplied = capped < floored; // the cap pulled it below what floor/raw wanted
    floorApplied = capped === SERVICE_FEE_FLOOR_CENTS && raw < SERVICE_FEE_FLOOR_CENTS;
  }

  // Gross up so Stripe's 2.9% + 30¢ on the full charge is covered by the client
  // and the platform portion stays whole. ceil so the platform never loses the
  // rounding cent.
  const chargeTotal = Math.ceil(
    (base + platformPortion + STRIPE_FIXED_CENTS) / (1 - STRIPE_RATE),
  );
  const processingPortion = chargeTotal - base - platformPortion;
  const totalFee = platformPortion + processingPortion;

  return {
    feeModelVersion: FEE_MODEL_VERSION,
    baseAmountCents: base,
    platformPortionCents: platformPortion,
    processingPortionCents: processingPortion,
    totalFeeCents: totalFee,
    chargeTotalCents: chargeTotal,
    capApplied,
    floorApplied,
    waived: opts.waived,
  };
}
