// PaymentIntent lifecycle webhook handlers. Three events feed into the
// same lookup → guarded transition path:
//
//   payment_intent.processing      "sent"       → "processing"
//   payment_intent.succeeded       "processing" → "paid"  (+ tradie stats)
//   payment_intent.payment_failed  no-status-change; surfaces the error
//
// Lookup-by-metadata is the primary path (PaymentIntent created with
// `metadata.invoiceId` set in sendInvoice.ts). Falls back to a
// `where payment.paymentIntentId == pi.id` query for paranoia — Stripe
// has never lost metadata in practice but the query is cheap and the
// recovery path matters for billing.
//
// Per-invoice idempotency: `payment.lastWebhookEventId` lets us short-
// circuit duplicate events at a finer grain than the global webhookEvents
// sentinel — Stripe occasionally re-derives an event id on retry edge
// cases. Belt + suspenders.

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  type DocumentReference,
  type Transaction,
} from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

import { db } from "../../lib/admin";
import { notify } from "../../lib/notify";
import type { StripePaymentIntent } from "./shared";

interface InvoiceLookup {
  ref: DocumentReference;
  data: {
    status?: string;
    tradespersonId?: string;
    clientId?: string;
    invoiceNumber?: string;
    total?: number;
    currency?: string;
    jobId?: string;
    payment?: {
      paymentIntentId?: string | null;
      lastWebhookEventId?: string | null;
      chargeId?: string | null;
    } | null;
  };
}

async function findInvoice(
  pi: StripePaymentIntent,
): Promise<InvoiceLookup | null> {
  const invoiceId = pi.metadata?.invoiceId;
  if (invoiceId) {
    const ref = db.doc(`invoices/${invoiceId}`);
    const snap = await ref.get();
    if (snap.exists) return { ref, data: snap.data() ?? {} };
    logger.warn("paymentIntent handler: metadata invoiceId missing doc", {
      paymentIntentId: pi.id,
      invoiceId,
    });
  }
  const q = await db
    .collection("invoices")
    .where("payment.paymentIntentId", "==", pi.id)
    .limit(1)
    .get();
  if (q.empty) {
    logger.warn("paymentIntent handler: no invoice for PaymentIntent", {
      paymentIntentId: pi.id,
    });
    return null;
  }
  return { ref: q.docs[0].ref, data: q.docs[0].data() };
}

function chargeId(pi: StripePaymentIntent): string | null {
  const lc = pi.latest_charge;
  if (!lc) return null;
  return typeof lc === "string" ? lc : (lc.id ?? null);
}

// Transactional precondition + transition. Returning a sentinel discriminator
// keeps the side effects (notify, stats increment) in the calling handler
// so the transaction stays small.
type TransitionResult =
  | { changed: true; clientId: string; tradespersonId: string; invoiceNumber: string; jobId: string; total: number; currency: string }
  | { changed: false; reason: "missing" | "duplicate-event" | "wrong-status" };

async function applyTransition(
  invoiceRef: DocumentReference,
  eventId: string,
  expectedFromStatuses: readonly string[],
  toStatus: string,
  pi: StripePaymentIntent,
  patch: Record<string, unknown>,
): Promise<TransitionResult> {
  return await db.runTransaction<TransitionResult>(async (tx: Transaction) => {
    const snap = await tx.get(invoiceRef);
    if (!snap.exists) return { changed: false, reason: "missing" };
    const data = snap.data() ?? {};
    const payment = (data.payment ?? {}) as {
      lastWebhookEventId?: string | null;
    };
    if (payment.lastWebhookEventId === eventId) {
      return { changed: false, reason: "duplicate-event" };
    }
    if (!expectedFromStatuses.includes(data.status)) {
      logger.warn("paymentIntent handler: wrong source status", {
        invoiceId: invoiceRef.id,
        paymentIntentId: pi.id,
        currentStatus: data.status,
        expectedFromStatuses,
      });
      return { changed: false, reason: "wrong-status" };
    }
    tx.set(
      invoiceRef,
      {
        status: toStatus,
        payment: {
          ...patch,
          lastWebhookEventId: eventId,
        },
      },
      { merge: true },
    );
    return {
      changed: true,
      clientId: data.clientId,
      tradespersonId: data.tradespersonId,
      invoiceNumber: data.invoiceNumber ?? "",
      jobId: data.jobId ?? "",
      total: data.total ?? 0,
      currency: data.currency ?? "CAD",
    };
  });
}

function fmtMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
    cents / 100,
  );
}

export async function handlePaymentIntentProcessing(
  pi: StripePaymentIntent,
  eventId: string,
): Promise<void> {
  const inv = await findInvoice(pi);
  if (!inv) return;
  await applyTransition(
    inv.ref,
    eventId,
    ["sent", "viewed"],
    "processing",
    pi,
    { chargeId: chargeId(pi) },
  );
}

export async function handlePaymentIntentSucceeded(
  pi: StripePaymentIntent,
  eventId: string,
): Promise<void> {
  const inv = await findInvoice(pi);
  if (!inv) return;

  const result = await applyTransition(
    inv.ref,
    eventId,
    // Some PaymentIntents jump straight from sent → succeeded (card flow
    // with no async processing window). Accept both source statuses so we
    // don't get stuck waiting for a `processing` event that never arrives.
    ["sent", "viewed", "processing"],
    "paid",
    pi,
    { chargeId: chargeId(pi) },
  );
  if (!result.changed) return;

  await inv.ref.set(
    { paidAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

  // Verified-earnings stats on the tradesperson public profile. Atomic
  // increments (the social-proof badge counts dollars, not just job count).
  // Done outside the invoice transaction because it crosses doc boundaries
  // and the invoice write is the source of truth for refunds / disputes.
  try {
    await db.doc(`tradespeople/${result.tradespersonId}`).set(
      {
        paidJobsCount: FieldValue.increment(1),
        paidLifetimeCents: FieldValue.increment(result.total),
      },
      { merge: true },
    );
  } catch (err) {
    logger.warn("paymentIntent succeeded: stat increment failed", {
      tradespersonId: result.tradespersonId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Two notifications: tradesperson hears "you got paid", client gets a
  // receipt. Tradie at high priority (they care most), client at low (the
  // email receipt is the substantive signal).
  await Promise.all([
    notify({
      userId: result.tradespersonId,
      type: "invoice_paid",
      title: `Invoice ${result.invoiceNumber} paid`,
      body: `${fmtMoney(result.total, result.currency)} just paid out — funds will land in your bank in 2 business days.`,
      link: result.jobId ? `/jobs/${result.jobId}` : null,
      actorUid: result.clientId,
      priority: "high",
    }),
    notify({
      userId: result.clientId,
      type: "invoice_paid",
      title: `Payment received: invoice ${result.invoiceNumber}`,
      body: `Thanks — your ${fmtMoney(result.total, result.currency)} payment cleared.`,
      link: result.jobId ? `/jobs/${result.jobId}` : null,
      actorUid: result.tradespersonId,
      priority: "low",
    }),
  ]);
}

// `payment_intent.canceled` — fires when an unconfirmed PaymentIntent is
// abandoned (Stripe auto-cancels after ~24h of no confirmation, or the
// tradie cancels via the dashboard). Without this handler the InvoicePayView
// hangs indefinitely because the invoice stays in `processing`/`sent` with
// a clientSecret that's no longer usable. We flip the invoice back to
// `sent` and clear the stale paymentIntentId + clientSecret so `sendInvoice`
// on the next attempt creates a fresh intent rather than reusing the dead
// one. The tradie is notified so they know the client never followed
// through; the client gets no notification (they already abandoned).
export async function handlePaymentIntentCanceled(
  pi: StripePaymentIntent,
  eventId: string,
): Promise<void> {
  const inv = await findInvoice(pi);
  if (!inv) return;

  const ref = inv.ref;
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    const payment = (data.payment ?? {}) as { lastWebhookEventId?: string | null };
    if (payment.lastWebhookEventId === eventId) return null;
    // Don't reverse a paid invoice — `payment_intent.canceled` shouldn't
    // arrive after `payment_intent.succeeded`, but if Stripe replays an
    // ancient event we don't want to undo the payment. Treat anything
    // post-paid as a no-op.
    const terminalStatuses = ["paid", "refunded", "partially_refunded", "disputed", "void"];
    if (terminalStatuses.includes(data.status)) {
      logger.info("paymentIntent canceled: ignored on terminal invoice", {
        invoiceId: ref.id,
        status: data.status,
      });
      return null;
    }
    tx.set(
      ref,
      {
        status: "sent",
        payment: {
          paymentIntentId: null,
          clientSecret: null,
          lastWebhookEventId: eventId,
        },
      },
      { merge: true },
    );
    return {
      tradespersonId: data.tradespersonId as string,
      invoiceNumber: (data.invoiceNumber as string) ?? "",
      jobId: (data.jobId as string) ?? "",
    };
  });
  if (!result) return;

  await notify({
    userId: result.tradespersonId,
    type: "invoice_payment_failed",
    title: `Payment expired on invoice ${result.invoiceNumber}`.trim(),
    body: "The client didn't complete payment in time. The invoice has been reset so they can try again from the job page.",
    link: result.jobId ? `/jobs/${result.jobId}` : null,
    actorUid: null,
    priority: "normal",
  });
}

export async function handlePaymentIntentFailed(
  pi: StripePaymentIntent,
  eventId: string,
): Promise<void> {
  const inv = await findInvoice(pi);
  if (!inv) return;

  // Don't transition status — `payment_failed` is non-terminal (Stripe
  // lets the customer retry). Record the failure on the payment field so
  // the client UI can surface "Last attempt failed: <reason>" without an
  // extra Stripe round-trip, and notify the client. lastWebhookEventId
  // guard still applies via a manual short-circuit here.
  const ref = inv.ref;
  const snap = await ref.get();
  const data = snap.data() ?? {};
  const payment = (data.payment ?? {}) as {
    lastWebhookEventId?: string | null;
  };
  if (payment.lastWebhookEventId === eventId) return;

  const errorMessage =
    pi.last_payment_error?.message ?? "Payment attempt failed.";

  await ref.set(
    {
      payment: {
        lastWebhookEventId: eventId,
        lastFailureMessage: errorMessage,
        lastFailureAt: Timestamp.now(),
      },
    },
    { merge: true },
  );

  await notify({
    userId: data.clientId,
    type: "invoice_payment_failed",
    title: `Payment failed on invoice ${data.invoiceNumber ?? ""}`.trim(),
    body: errorMessage,
    link: data.jobId ? `/jobs/${data.jobId}` : null,
    actorUid: data.tradespersonId ?? null,
    priority: "high",
  });
}
