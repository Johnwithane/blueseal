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
  /**
   * Fraction of the accrued commission to reverse, clamped to [0,1] (P3-05).
   * Driven by the CUMULATIVE refunded share of the charge, so a run of partial
   * refunds on one charge escalates the same reversal doc toward the total.
   * Defaults to 1 (a full refund reverses 100% — unchanged legacy behaviour).
   */
  proportion?: number;
}

/**
 * The commission cents to reverse for a given refund proportion. Pure so the
 * partial-refund math is unit-testable without Firestore. `proportion` is
 * clamped to [0,1]; a full refund (1) reverses the whole commission.
 */
export function computeReversalCents(
  originalCommissionCents: number,
  proportion: number,
): number {
  const p = Math.max(0, Math.min(1, proportion));
  return Math.round(originalCommissionCents * p);
}

/**
 * Reverse a previously accrued commission (refund or lost chargeback) by
 * writing a SEPARATE offsetting entry — `status: "reversed"`, `reversalOf` =
 * the original id — leaving the original untouched so the ledger stays
 * append-only. The M6 payout nets accrued minus reversed, so an offsetting
 * entry claws it back exactly.
 *
 * Proportional (P3-05): `commissionCents` is `round(orig × proportion)` where
 * `proportion` is the CUMULATIVE refunded share. The reversal doc is a single
 * deterministic id carrying the cumulative reversed target, so it's idempotent
 * two ways: a webhook replay recomputes the same target and overwrites in
 * place; a later, larger partial refund overwrites it upward. A full refund
 * (proportion 1) mirrors the whole commission, exactly as before.
 *
 * No-ops when there was no accrual to reverse, or when the new target doesn't
 * exceed what's already been reversed (a shrink can't happen — refunds only
 * grow). Never clobbers a reversal that a payout already netted: if a further
 * refund lands after settlement, the delta is written to a separate top-up doc
 * and flagged for admin review rather than un-netting a settled entry.
 */
export async function reverseCommission(
  input: ReverseCommissionInput,
): Promise<void> {
  const originalId = accrualId(input.source, input.sourceRef);
  const snap = await db.doc(`commissions/${originalId}`).get();
  if (!snap.exists) return; // nothing accrued → nothing to reverse
  const orig = snap.data() ?? {};

  const proportion = input.proportion ?? 1;
  const targetCents = computeReversalCents(orig.commissionCents ?? 0, proportion);
  if (targetCents <= 0) return; // zero-value refund → nothing to reverse

  const id = reversalId(input.source, input.sourceRef);
  const existing = await db.doc(`commissions/${id}`).get();
  const prevCents = existing.exists ? Number(existing.data()?.commissionCents ?? 0) : 0;
  if (existing.exists && targetCents <= prevCents) return; // replay / no growth

  // A further refund after the reversal was already netted into a payout: don't
  // un-net a settled entry — write the incremental delta to a top-up doc and
  // flag it. (Rare: needs a payout to land between two partial refunds on one
  // charge.) The top-up id keys on the cumulative target so replays are idempotent.
  if (existing.exists && existing.data()?.payoutBatchId != null) {
    const delta = targetCents - prevCents;
    const topUpId = `${id}_top_${targetCents}`;
    await db.doc(`commissions/${topUpId}`).set(
      {
        repId: orig.repId,
        regionId: orig.regionId ?? null,
        tradespersonId: orig.tradespersonId,
        ownerKind: orig.ownerKind,
        source: input.source,
        sourceRef: input.sourceRef,
        grossRevenueCents: computeReversalCents(orig.grossRevenueCents ?? 0, proportion) - prevCents,
        rateBps: orig.rateBps ?? COMMISSION_RATE_BPS,
        commissionCents: delta,
        refundProportion: proportion,
        status: "reversed",
        payoutBatchId: null,
        reversalOf: originalId,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: false },
    );
    logger.error("commission reversal after settlement — top-up written, verify", {
      id: topUpId,
      reversalOf: originalId,
      source: input.source,
      sourceRef: input.sourceRef,
      deltaCents: delta,
    });
    return;
  }

  await db.doc(`commissions/${id}`).set(
    {
      repId: orig.repId,
      regionId: orig.regionId ?? null,
      tradespersonId: orig.tradespersonId,
      ownerKind: orig.ownerKind,
      source: input.source,
      sourceRef: input.sourceRef,
      grossRevenueCents: computeReversalCents(orig.grossRevenueCents ?? 0, proportion),
      rateBps: orig.rateBps ?? COMMISSION_RATE_BPS,
      commissionCents: targetCents,
      refundProportion: proportion,
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
    proportion,
    commissionCents: targetCents,
  });
}

// ---------------------------------------------------------------------------
// Project Manager commission (P4) — ADDITIVE to the rep accrual above. A
// PM-driven job (job.drivenByProjectManagerId set) earns the PM 10% of the same
// service fee the rep earns on, so BOTH entries coexist on one fee. The rep
// functions above are deliberately untouched (their deterministic id stays
// `${source}_${sourceRef}`); the PM entry uses an OWNER-SCOPED id
// `${source}_${sourceRef}_pm_${pmId}` so the two never collide. Same idempotency
// + non-destructive-reversal invariants.
// ---------------------------------------------------------------------------

/** Owner-scoped accrual id so the PM entry coexists with the rep entry on one fee. */
function pmAccrualId(source: CommissionSource, sourceRef: string, pmId: string): string {
  return `${source}_${sourceRef}_pm_${pmId}`;
}
function pmReversalId(source: CommissionSource, sourceRef: string, pmId: string): string {
  return `${source}_${sourceRef}_pm_${pmId}_reversal`;
}

export interface AccruePmCommissionInput {
  pmId: string;
  tradespersonId: string;
  source: CommissionSource;
  sourceRef: string;
  grossCents: number;
}

/**
 * Accrue the project manager's 10% commission on a PM-driven job's fee. Mirrors
 * accrueCommission but pays the PM (ownerType "pm", ownerId = pmId, repId null)
 * with an owner-scoped deterministic id. No-ops when the commission rounds to 0.
 * Idempotent: a webhook replay overwrites the same PM ledger doc.
 */
export async function accruePmCommission(input: AccruePmCommissionInput): Promise<void> {
  const cents = commissionCents(input.grossCents);
  if (cents === 0) return;

  const id = pmAccrualId(input.source, input.sourceRef, input.pmId);
  await db.doc(`commissions/${id}`).set(
    {
      ownerType: "pm",
      ownerId: input.pmId,
      repId: null,
      regionId: null,
      tradespersonId: input.tradespersonId,
      ownerKind: "pm_project",
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

  logger.info("pm commission accrued", {
    id,
    pmId: input.pmId,
    source: input.source,
    sourceRef: input.sourceRef,
    commissionCents: cents,
  });
}

export interface ReversePmCommissionInput {
  pmId: string;
  source: CommissionSource;
  sourceRef: string;
  /** Cumulative refunded share to reverse, clamped to [0,1]. Defaults to 1. */
  proportion?: number;
}

/**
 * Reverse a PM accrual (refund / lost dispute) with an offsetting entry.
 * Proportional + idempotent exactly like {@link reverseCommission}: the reversal
 * doc carries the cumulative reversed target and escalates in place on a run of
 * partial refunds. Returns the NEWLY-reversed cents this call added (the delta),
 * or null when nothing changed — so the caller notifies only on a real clawback.
 */
export async function reversePmCommission(input: ReversePmCommissionInput): Promise<number | null> {
  const originalId = pmAccrualId(input.source, input.sourceRef, input.pmId);
  const snap = await db.doc(`commissions/${originalId}`).get();
  if (!snap.exists) return null; // nothing accrued → nothing to reverse

  const orig = snap.data() ?? {};
  const proportion = input.proportion ?? 1;
  const targetCents = computeReversalCents(orig.commissionCents ?? 0, proportion);
  if (targetCents <= 0) return null;

  const id = pmReversalId(input.source, input.sourceRef, input.pmId);
  const existing = await db.doc(`commissions/${id}`).get();
  const prevCents = existing.exists ? Number(existing.data()?.commissionCents ?? 0) : 0;
  if (existing.exists && targetCents <= prevCents) return null; // replay / no growth

  // Further refund after settlement: top-up doc, never un-net (see reverseCommission).
  if (existing.exists && existing.data()?.payoutBatchId != null) {
    const delta = targetCents - prevCents;
    const topUpId = `${id}_top_${targetCents}`;
    await db.doc(`commissions/${topUpId}`).set(
      {
        ownerType: "pm",
        ownerId: input.pmId,
        repId: null,
        regionId: null,
        tradespersonId: orig.tradespersonId,
        ownerKind: "pm_project",
        source: input.source,
        sourceRef: input.sourceRef,
        grossRevenueCents: computeReversalCents(orig.grossRevenueCents ?? 0, proportion) - prevCents,
        rateBps: orig.rateBps ?? COMMISSION_RATE_BPS,
        commissionCents: delta,
        refundProportion: proportion,
        status: "reversed",
        payoutBatchId: null,
        reversalOf: originalId,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: false },
    );
    logger.error("pm commission reversal after settlement — top-up written, verify", {
      id: topUpId,
      reversalOf: originalId,
      pmId: input.pmId,
      deltaCents: delta,
    });
    return delta;
  }

  await db.doc(`commissions/${id}`).set(
    {
      ownerType: "pm",
      ownerId: input.pmId,
      repId: null,
      regionId: null,
      tradespersonId: orig.tradespersonId,
      ownerKind: "pm_project",
      source: input.source,
      sourceRef: input.sourceRef,
      grossRevenueCents: computeReversalCents(orig.grossRevenueCents ?? 0, proportion),
      rateBps: orig.rateBps ?? COMMISSION_RATE_BPS,
      commissionCents: targetCents,
      refundProportion: proportion,
      status: "reversed",
      payoutBatchId: null,
      reversalOf: originalId,
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: false },
  );

  logger.info("pm commission reversed", {
    id,
    reversalOf: originalId,
    pmId: input.pmId,
    proportion,
    commissionCents: targetCents,
  });
  return targetCents - prevCents;
}
