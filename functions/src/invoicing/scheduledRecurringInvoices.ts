// Daily: for each invoice flagged recurring (recurring.enabled) whose
// nextRunAt has passed, clone it as a fresh DRAFT for the tradesperson to
// review and send. It NEVER auto-sends (so Stripe + the client are never
// touched without a human in the loop) and the clone does NOT itself recur —
// the original invoice is the single recurring "template". Pro-gated: a lapsed
// tradesperson's schedule advances but produces no draft until they re-subscribe.

import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue, Timestamp, type DocumentReference } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";
import { notify } from "../lib/notify";

type Frequency = "weekly" | "monthly" | "quarterly";

interface RecurringConfig {
  enabled?: boolean;
  frequency?: Frequency;
  nextRunAt?: Timestamp | null;
}

interface InvoiceLike {
  tradespersonId: string;
  clientId: string | null;
  jobId: string;
  lineItems: unknown[];
  subtotal: number;
  discount: unknown;
  discountAmount: number;
  taxTotal: number;
  total: number;
  currency: string;
  paymentInstructions: string;
  recurring?: RecurringConfig | null;
}

function advance(ts: Timestamp, freq: Frequency | undefined): Timestamp {
  const d = ts.toDate();
  if (freq === "weekly") d.setDate(d.getDate() + 7);
  else if (freq === "quarterly") d.setMonth(d.getMonth() + 3);
  else d.setMonth(d.getMonth() + 1); // monthly default
  return Timestamp.fromDate(d);
}

async function processOne(sourceRef: DocumentReference): Promise<void> {
  const tradieIdForNotify = { value: "" };
  const result = await db.runTransaction(async (tx) => {
    const srcSnap = await tx.get(sourceRef);
    if (!srcSnap.exists) return null;
    const src = srcSnap.data() as InvoiceLike;
    if (!src.recurring?.enabled || !src.recurring.nextRunAt) return null;

    const tradieRef = db.doc(`tradespeople/${src.tradespersonId}`);
    const tradieSnap = await tx.get(tradieRef);
    tradieIdForNotify.value = src.tradespersonId;

    // Always advance so the working set stays bounded.
    const newNextRunAt = advance(src.recurring.nextRunAt, src.recurring.frequency);
    tx.set(sourceRef, { recurring: { ...src.recurring, nextRunAt: newNextRunAt } }, { merge: true });

    // Pro gate — lapsed tradesperson's schedule advances but drafts no invoice.
    if (tradieSnap.data()?.isPro !== true) {
      logger.info("recurring invoice skipped (not Pro)", { sourceId: sourceRef.id });
      return null;
    }

    const data = tradieSnap.data() as {
      nextInvoiceNumber?: number;
      invoicePrefix?: string;
    };
    const seq = data.nextInvoiceNumber ?? 1;
    const prefix = (data.invoicePrefix ?? "INV").trim() || "INV";
    const year = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      year: "numeric",
    }).format(newNextRunAt.toDate());
    const invoiceNumber = `${prefix}-${year}-${String(seq).padStart(4, "0")}`;

    const cloneRef = db.collection("invoices").doc(); // fresh auto-id
    tx.set(cloneRef, {
      tradespersonId: src.tradespersonId,
      clientId: src.clientId,
      jobId: src.jobId,
      invoiceNumber,
      status: "draft",
      lineItems: src.lineItems,
      subtotal: src.subtotal,
      discount: src.discount ?? null,
      discountAmount: src.discountAmount ?? 0,
      taxTotal: src.taxTotal ?? 0,
      total: src.total ?? 0,
      currency: src.currency ?? "CAD",
      issuedAt: FieldValue.serverTimestamp(),
      dueAt: null,
      sentAt: null,
      viewedAt: null,
      paidAt: null,
      pdfUrl: null,
      paymentInstructions: src.paymentInstructions ?? "",
      paymentMethod: "manual",
      recurring: null, // the clone does NOT recur — the original is the template
      upfrontFeeCredit: null,
      payment: null,
    });
    tx.update(tradieRef, { nextInvoiceNumber: seq + 1 });
    return { cloneId: cloneRef.id, jobId: src.jobId, invoiceNumber };
  });

  if (result) {
    await notify({
      userId: tradieIdForNotify.value,
      type: "invoice_sent",
      title: "Recurring invoice ready",
      body: `A draft of ${result.invoiceNumber} is ready to review and send.`,
      link: result.jobId ? `/jobs/${result.jobId}` : "/dashboard/tradie",
      recipientRole: "tradesperson",
      priority: "normal",
    });
  }
}

export const scheduledRecurringInvoices = onSchedule(
  { schedule: "every day 04:00", timeZone: "America/Vancouver" },
  async () => {
    const now = Timestamp.now();
    const snap = await db
      .collection("invoices")
      .where("recurring.enabled", "==", true)
      .where("recurring.nextRunAt", "<=", now)
      .limit(200)
      .get();
    if (snap.empty) {
      logger.info("scheduledRecurringInvoices: nothing due");
      return;
    }
    let processed = 0;
    for (const doc of snap.docs) {
      try {
        await processOne(doc.ref);
        processed += 1;
      } catch (err) {
        logger.error("scheduledRecurringInvoices: failed one", {
          invoiceId: doc.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    logger.info(`scheduledRecurringInvoices: processed ${processed}`);
  },
);
