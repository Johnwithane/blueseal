/**
 * Blue Seal service-fee math — CLIENT MIRROR of functions/src/payments/
 * serviceFee.ts. Used for UI estimates only (e.g. "+ ~$X service fee" hints);
 * the authoritative numbers always come from the server snapshot written onto
 * the payment at PaymentIntent creation. Keep this in sync with the functions
 * copy — the worked examples + invariants are pinned in ./serviceFee.test.ts.
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
    capApplied = capped < floored;
    floorApplied = capped === SERVICE_FEE_FLOOR_CENTS && raw < SERVICE_FEE_FLOOR_CENTS;
  }

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
