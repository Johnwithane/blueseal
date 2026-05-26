import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";

interface JobLike {
  status: string;
  tradespersonId: string;
  clientId: string;
  title: string;
  trade: string;
}

/**
 * When a job flips to "complete", create a draft invoice and bump the
 * tradie's invoice number atomically. Uses jobId as the invoice document id
 * so re-fires of the same Firestore event are naturally idempotent.
 */
export const onJobCompleted = onDocumentUpdated("jobs/{jobId}", async (event) => {
  const before = event.data?.before.data() as JobLike | undefined;
  const after = event.data?.after.data() as JobLike | undefined;
  if (!after || !before) return;
  if (before.status === "complete" || after.status !== "complete") return;

  const jobId = event.params.jobId;
  const tradieRef = db.doc(`tradespeople/${after.tradespersonId}`);
  // Deterministic invoice id == jobId — collisions guarantee idempotency.
  const invoiceRef = db.doc(`invoices/${jobId}`);

  await db.runTransaction(async (tx) => {
    const [tradieSnap, invoiceSnap] = await Promise.all([
      tx.get(tradieRef),
      tx.get(invoiceRef),
    ]);
    if (invoiceSnap.exists) return; // already created
    if (!tradieSnap.exists) {
      logger.warn("Job completed but tradesperson doc missing; no invoice drafted", {
        jobId,
        tradespersonId: after.tradespersonId,
      });
      return;
    }
    const data = tradieSnap.data() as {
      nextInvoiceNumber?: number;
      invoicePrefix?: string;
      paymentInstructions?: string;
    };
    const seq = data.nextInvoiceNumber ?? 1;
    const prefix = (data.invoicePrefix ?? "INV").trim() || "INV";
    // Year derived from Toronto local time, not us-central1 local time.
    const year = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      year: "numeric",
    }).format(new Date());
    const invoiceNumber = `${prefix}-${year}-${String(seq).padStart(4, "0")}`;
    tx.set(invoiceRef, {
      tradespersonId: after.tradespersonId,
      clientId: after.clientId,
      jobId,
      invoiceNumber,
      status: "draft",
      lineItems: [
        { description: after.title, quantity: 1, unitPrice: 0, taxRate: 0 },
      ],
      subtotal: 0,
      taxTotal: 0,
      total: 0,
      currency: "CAD",
      issuedAt: FieldValue.serverTimestamp(),
      dueAt: null,
      sentAt: null,
      viewedAt: null,
      paidAt: null,
      pdfUrl: null,
      paymentInstructions: data.paymentInstructions ?? "",
      paymentMethod: "manual",
      recurring: null,
    });
    tx.update(tradieRef, { nextInvoiceNumber: seq + 1 });
  });
});
