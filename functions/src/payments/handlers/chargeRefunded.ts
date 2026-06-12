// `charge.refunded` — appended on top of an existing paid invoice. Stripe
// fires this once per refund event (full or partial). We append to the
// `payment.refunds` array, recompute `refundedAmount`, and flip status to
// `partially_refunded` or `refunded`. The latest refund delta is derived
// from (charge.amount_refunded − sum-of-prior-recorded-refunds) so duplicate
// deliveries are idempotent even if Stripe sends slightly different
// `refunds.data` payloads on retry.

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

import { db } from "../../lib/admin";
import { notify } from "../../lib/notify";
import type { StripeCharge, StripeRefund } from "./shared";

interface RefundEntry {
  refundId: string;
  amount: number;
  reason: string | null;
  createdAt: Timestamp;
}

function fmtMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
    cents / 100,
  );
}

// Upfront-fee refund fallback: an upfront fee paid by card lives on the job's
// upfrontFee.payment, not an invoice. Record the refunded amount + notify; the
// service fee isn't auto-decremented from the per-job cap (admins adjust the
// application fee in the dashboard if they refund it). Returns true if it
// matched a job, so the invoice path knows to stop.
async function handleUpfrontRefund(charge: StripeCharge, eventId: string): Promise<boolean> {
  let ref: FirebaseFirestore.DocumentReference | null = null;
  if (charge.payment_intent) {
    const q = await db
      .collection("jobs")
      .where("upfrontFee.payment.paymentIntentId", "==", charge.payment_intent)
      .limit(1)
      .get();
    if (!q.empty) ref = q.docs[0].ref;
  }
  if (!ref) {
    const q = await db
      .collection("jobs")
      .where("upfrontFee.payment.chargeId", "==", charge.id)
      .limit(1)
      .get();
    if (!q.empty) ref = q.docs[0].ref;
  }
  if (!ref) return false;

  const jobRef = ref;
  const parties = await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    const payment = (data.upfrontFee?.payment ?? {}) as { lastWebhookEventId?: string | null };
    if (payment.lastWebhookEventId === eventId) return null;
    tx.set(
      jobRef,
      {
        upfrontFee: {
          payment: { refundedAmount: charge.amount_refunded, lastWebhookEventId: eventId },
        },
      },
      { merge: true },
    );
    return {
      tradespersonId: (data.tradespersonId as string) ?? "",
      clientId: (data.clientId as string) ?? "",
    };
  });
  if (!parties) return true;

  const amount = fmtMoney(charge.amount_refunded, "CAD");
  await Promise.all([
    notify({
      userId: parties.tradespersonId,
      type: "invoice_refunded",
      title: "Upfront fee refunded",
      body: `${amount} of the upfront fee was refunded to the client.`,
      link: `/jobs/${jobRef.id}`,
      actorUid: parties.clientId,
      recipientRole: "tradesperson",
      priority: "high",
    }),
    notify({
      userId: parties.clientId,
      type: "invoice_refunded",
      title: "Upfront fee refunded",
      body: `${amount} has been refunded to your original payment method.`,
      link: `/jobs/${jobRef.id}`,
      actorUid: parties.tradespersonId,
      recipientRole: "client",
      priority: "high",
    }),
  ]);
  return true;
}

export async function handleChargeRefunded(
  charge: StripeCharge,
  eventId: string,
): Promise<void> {
  // Locate the invoice. Stripe doesn't guarantee webhook ordering, so
  // `charge.refunded` can arrive before `payment_intent.succeeded` —
  // which means `payment.chargeId` may not be stamped on the invoice
  // yet. We try the paymentIntentId first (set at sendInvoice time, so
  // always present once an invoice has any payment attempt at all),
  // then fall back to chargeId for older invoices where the refund
  // arrived first only on retry.
  let ref: FirebaseFirestore.DocumentReference | null = null;
  if (charge.payment_intent) {
    const q = await db
      .collection("invoices")
      .where("payment.paymentIntentId", "==", charge.payment_intent)
      .limit(1)
      .get();
    if (!q.empty) ref = q.docs[0].ref;
  }
  if (!ref) {
    const q = await db
      .collection("invoices")
      .where("payment.chargeId", "==", charge.id)
      .limit(1)
      .get();
    if (!q.empty) ref = q.docs[0].ref;
  }
  if (!ref) {
    // Not an invoice payment — it may be a job's upfront fee paid by card.
    if (await handleUpfrontRefund(charge, eventId)) return;
    logger.warn("chargeRefunded: no invoice or upfront fee for charge", {
      chargeId: charge.id,
      paymentIntentId: charge.payment_intent,
    });
    return;
  }

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const data = snap.data() ?? {};
    const payment = (data.payment ?? {}) as {
      lastWebhookEventId?: string | null;
      refunds?: RefundEntry[] | null;
    };
    if (payment.lastWebhookEventId === eventId) return;

    // Stripe's `refunds.data` is the canonical refund list on the charge.
    // Take the newest one we haven't recorded yet — index by `refundId`.
    const knownIds = new Set((payment.refunds ?? []).map((r) => r.refundId));
    const fresh: StripeRefund[] = (charge.refunds?.data ?? []).filter(
      (r) => !knownIds.has(r.id),
    );
    if (fresh.length === 0) {
      logger.info("chargeRefunded: no new refunds to record", {
        chargeId: charge.id,
        eventId,
      });
      tx.set(
        ref,
        { payment: { lastWebhookEventId: eventId } },
        { merge: true },
      );
      return;
    }

    const appended: RefundEntry[] = fresh.map((r) => ({
      refundId: r.id,
      amount: r.amount,
      reason: r.reason ?? null,
      createdAt: Timestamp.fromMillis(r.created * 1000),
    }));

    const newStatus =
      charge.amount_refunded >= charge.amount ? "refunded" : "partially_refunded";

    tx.set(
      ref,
      {
        status: newStatus,
        payment: {
          lastWebhookEventId: eventId,
          chargeId: charge.id,
          refundedAmount: charge.amount_refunded,
          refunds: FieldValue.arrayUnion(...appended),
        },
      },
      { merge: true },
    );
  });

  // Notify both parties after the transaction commits. Best-effort —
  // a notify failure shouldn't roll back the refund record.
  const fresh = await ref.get();
  const data = fresh.data();
  if (!data) return;
  const isFull = (data.status ?? "") === "refunded";
  const amount = charge.amount_refunded;
  const currency = (data.currency as string) ?? "CAD";
  const number = (data.invoiceNumber as string) ?? "";
  const jobId = (data.jobId as string) ?? "";

  await Promise.all([
    notify({
      userId: data.tradespersonId,
      type: "invoice_refunded",
      title: `Invoice ${number} ${isFull ? "refunded" : "partially refunded"}`,
      body: `${fmtMoney(amount, currency)} refunded to the client. The payout adjustment will show on your Stripe dashboard.`,
      link: jobId ? `/jobs/${jobId}` : null,
      actorUid: data.clientId,
      recipientRole: "tradesperson",
      priority: "high",
    }),
    notify({
      userId: data.clientId,
      type: "invoice_refunded",
      title: `Refund issued: invoice ${number}`,
      body: `${fmtMoney(amount, currency)} has been refunded to your original payment method.`,
      link: jobId ? `/jobs/${jobId}` : null,
      actorUid: data.tradespersonId,
      recipientRole: "client",
      priority: "high",
    }),
  ]);
}
