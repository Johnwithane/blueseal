// `payout.created` / `payout.paid` / `payout.failed` webhook handlers.
//
// Payouts in Stripe Connect happen on the connected account, not the
// platform — Stripe wraps these events with `event.account = acct_…` so
// the platform webhook can fan them out. We resolve the tradesperson by
// querying `tradespeople where payouts.stripeAccountId == event.account`.
//
// `invoiceIds[]` on the payout doc is intentionally empty in this first
// pass. Cross-resolving payout → balance transactions → charges → invoices
// is a per-event Stripe API round trip (payouts are rare but each one
// fans into N reads). The tradie-facing view shows amount + status +
// arrival date which is the meaningful info; the Stripe Express dashboard
// link is the path to the per-charge breakdown. Add resolution here when
// there's evidence the in-app breakdown matters.
//
// Idempotent on the doc id (Stripe `po_…`) — `payout.created` writes,
// `payout.paid` / `payout.failed` update. The global webhookEvents
// sentinel still guards against full-event replays.

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

import { db } from "../../lib/admin";
import { notify } from "../../lib/notify";
import type { StripePayout } from "./shared";

interface ResolvedTradie {
  tradespersonId: string;
  stripeAccountId: string;
}

async function resolveTradieFromAccount(
  accountId: string | null | undefined,
): Promise<ResolvedTradie | null> {
  if (!accountId) return null;
  const snap = await db
    .collection("tradespeople")
    .where("payouts.stripeAccountId", "==", accountId)
    .limit(1)
    .get();
  if (snap.empty) {
    logger.warn("payout handler: no tradesperson for account", { accountId });
    return null;
  }
  return { tradespersonId: snap.docs[0].id, stripeAccountId: accountId };
}

function fmtMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
    cents / 100,
  );
}

export async function handlePayoutCreated(
  payout: StripePayout,
  accountId: string | null | undefined,
  eventId: string,
): Promise<void> {
  const tradie = await resolveTradieFromAccount(accountId);
  if (!tradie) return;

  const ref = db.doc(`payouts/${payout.id}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const existing = snap.data() as { lastWebhookEventId?: string };
      if (existing.lastWebhookEventId === eventId) return;
    }
    tx.set(
      ref,
      {
        tradespersonId: tradie.tradespersonId,
        stripeAccountId: tradie.stripeAccountId,
        stripePayoutId: payout.id,
        amount: payout.amount,
        currency: payout.currency.toUpperCase(),
        arrivalDate: Timestamp.fromMillis(payout.arrival_date * 1000),
        status: payout.status,
        failureCode: payout.failure_code ?? null,
        failureMessage: payout.failure_message ?? null,
        invoiceIds: [],
        createdAt: snap.exists
          ? snap.get("createdAt")
          : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastWebhookEventId: eventId,
      },
      { merge: true },
    );
  });
}

async function updatePayoutStatus(
  payout: StripePayout,
  accountId: string | null | undefined,
  eventId: string,
): Promise<{ tradespersonId: string } | null> {
  const tradie = await resolveTradieFromAccount(accountId);
  if (!tradie) return null;

  const ref = db.doc(`payouts/${payout.id}`);
  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const existing = snap.data() as { lastWebhookEventId?: string };
      if (existing.lastWebhookEventId === eventId) return null;
    }
    // Status events sometimes arrive before `payout.created` was processed
    // (or where created delivery was lost) — write a full doc as a
    // fallback so the tradie still sees the event in their history.
    tx.set(
      ref,
      {
        tradespersonId: tradie.tradespersonId,
        stripeAccountId: tradie.stripeAccountId,
        stripePayoutId: payout.id,
        amount: payout.amount,
        currency: payout.currency.toUpperCase(),
        arrivalDate: Timestamp.fromMillis(payout.arrival_date * 1000),
        status: payout.status,
        failureCode: payout.failure_code ?? null,
        failureMessage: payout.failure_message ?? null,
        // Only seed invoiceIds + createdAt on first write; later events
        // shouldn't overwrite the empty array with another empty array
        // unnecessarily (harmless but noisy on audit).
        ...(snap.exists
          ? {}
          : {
              invoiceIds: [],
              createdAt: FieldValue.serverTimestamp(),
            }),
        updatedAt: FieldValue.serverTimestamp(),
        lastWebhookEventId: eventId,
      },
      { merge: true },
    );
    return { tradespersonId: tradie.tradespersonId };
  });
}

export async function handlePayoutPaid(
  payout: StripePayout,
  accountId: string | null | undefined,
  eventId: string,
): Promise<void> {
  const res = await updatePayoutStatus(payout, accountId, eventId);
  if (!res) return;
  await notify({
    userId: res.tradespersonId,
    type: "invoice_paid", // closest existing type until a payout-specific one lands
    title: "Payout sent",
    body: `${fmtMoney(payout.amount, payout.currency.toUpperCase())} is on its way to your bank account.`,
    link: "/payouts",
    actorUid: null,
    priority: "low",
  });
}

export async function handlePayoutFailed(
  payout: StripePayout,
  accountId: string | null | undefined,
  eventId: string,
): Promise<void> {
  const res = await updatePayoutStatus(payout, accountId, eventId);
  if (!res) return;
  await notify({
    userId: res.tradespersonId,
    type: "invoice_payment_failed", // closest existing type
    title: "Payout failed",
    body:
      payout.failure_message ??
      "Stripe couldn't deposit your payout. Open the payouts page and check your bank details.",
    link: "/payouts",
    actorUid: null,
    priority: "high",
  });
}
