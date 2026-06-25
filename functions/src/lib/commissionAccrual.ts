// Sales-rep commission accrual + reversal — the money-critical core of M5b.
//
// Called from the LIVE Stripe webhook handlers, so two invariants matter most:
//
//   1. Idempotency. Stripe retries webhooks and occasionally re-delivers on a
//      2xx, so a handler can run more than once for the same revenue event.
//      Both writes here use a DETERMINISTIC doc id derived from (source,
//      sourceRef) and `set(..., { merge: false })`, so a replay overwrites the
//      same ledger entry instead of minting a second one. Double-accrual would
//      miscount real money owed to a rep.
//   2. Non-destructive reversals. A refund / lost chargeback writes a SEPARATE
//      offsetting `reversed` entry (never mutates or deletes the original), so
//      the ledger stays append-only and the M6 payout math nets accrued minus
//      reversed.
//
// Both helpers no-op silently when nothing is owed (no owning rep, waived fee,
// comped subscription, or no prior accrual to reverse) — the caller wraps them
// in try/catch so a commission failure can NEVER roll back a committed payment.

import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

import { db } from "./admin";
import { COMMISSION_RATE_BPS, commissionCents } from "./commission";
import { resolveCommissionOwner } from "./commissionOwner";
import type { CommissionSource } from "./commissionTypes";

/** Deterministic ledger id for an accrual — the replay-safe dedupe key. */
function accrualId(source: CommissionSource, sourceRef: string): string {
  return `${source}_${sourceRef}`;
}

/** Deterministic ledger id for the reversal that offsets `accrualId`. */
function reversalId(source: CommissionSource, sourceRef: string): string {
  return `${source}_${sourceRef}_reversal`;
}

export interface AccrueCommissionInput {
  tradespersonId: string;
  source: CommissionSource;
  /** Stripe invoice id (subscription) or Blue Seal invoiceId (service fee). */
  sourceRef: string;
  /** The Blue Seal gross revenue this event generated, in cents. */
  grossCents: number;
}

/**
 * Accrue a 10% commission to the tradesperson's owning rep for one revenue
 * event. No-ops when the commission rounds to 0 (Pro tradie's waived service
 * fee, comped subscription) or the tradesperson has no owning rep. Idempotent:
 * a webhook replay overwrites the same deterministic ledger doc.
 */
export async function accrueCommission(
  input: AccrueCommissionInput,
): Promise<void> {
  const cents = commissionCents(input.grossCents);
  if (cents === 0) return; // waived fee / comped sub / non-positive gross

  const owner = await resolveCommissionOwner(input.tradespersonId);
  if (!owner) return; // unowned tradesperson — platform keeps 100%

  const id = accrualId(input.source, input.sourceRef);
  await db.doc(`commissions/${id}`).set(
    {
      repId: owner.repId,
      regionId: owner.regionId,
      tradespersonId: input.tradespersonId,
      ownerKind: owner.ownerKind,
      source: input.source,
      sourceRef: input.sourceRef,
      grossRevenueCents: input.grossCents,
      rateBps: COMMISSION_RATE_BPS,
      commissionCents: cents,
      status: "accrued",
      payoutBatchId: null,
      reversalOf: null,
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: false },
  );

  logger.info("commission accrued", {
    id,
    repId: owner.repId,
    ownerKind: owner.ownerKind,
    source: input.source,
    sourceRef: input.sourceRef,
    grossRevenueCents: input.grossCents,
    commissionCents: cents,
  });
}

export interface ReverseCommissionInput {
  source: CommissionSource;
  sourceRef: string;
}

/**
 * Reverse a previously accrued commission (full refund or lost chargeback) by
 * writing a SEPARATE offsetting entry — `status: "reversed"`, `reversalOf` =
 * the original id, mirroring the original's amounts. The original is left
 * untouched so the ledger is append-only. Idempotent via a deterministic
 * reversal id; no-ops when there was no accrual to reverse (no owner, waived
 * fee, or the event never accrued).
 */
export async function reverseCommission(
  input: ReverseCommissionInput,
): Promise<void> {
  const originalId = accrualId(input.source, input.sourceRef);
  const snap = await db.doc(`commissions/${originalId}`).get();
  if (!snap.exists) return; // nothing accrued → nothing to reverse
  const orig = snap.data() ?? {};

  const id = reversalId(input.source, input.sourceRef);
  await db.doc(`commissions/${id}`).set(
    {
      repId: orig.repId,
      regionId: orig.regionId ?? null,
      tradespersonId: orig.tradespersonId,
      ownerKind: orig.ownerKind,
      source: input.source,
      sourceRef: input.sourceRef,
      grossRevenueCents: orig.grossRevenueCents ?? 0,
      rateBps: orig.rateBps ?? COMMISSION_RATE_BPS,
      // Mirror the original commission amount — the M6 payout nets accrued minus
      // reversed, so an equal-and-opposite entry cancels it exactly.
      commissionCents: orig.commissionCents ?? 0,
      status: "reversed",
      payoutBatchId: null,
      reversalOf: originalId,
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: false },
  );

  logger.info("commission reversed", {
    id,
    reversalOf: originalId,
    source: input.source,
    sourceRef: input.sourceRef,
    commissionCents: orig.commissionCents ?? 0,
  });
}
