import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { FieldValue } from "firebase-admin/firestore";
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
 * tradie's invoice number atomically.
 */
export const onJobCompleted = onDocumentUpdated("jobs/{jobId}", async (event) => {
  const before = event.data?.before.data() as JobLike | undefined;
  const after = event.data?.after.data() as JobLike | undefined;
  if (!after || !before) return;
  if (before.status === "complete" || after.status !== "complete") return;

  // Skip if an invoice already exists for this job.
  const existing = await db
    .collection("invoices")
    .where("jobId", "==", event.params.jobId)
    .limit(1)
    .get();
  if (!existing.empty) return;

  const tradieRef = db.doc(`tradespeople/${after.tradespersonId}`);
  await db.runTransaction(async (tx) => {
    const tradieSnap = await tx.get(tradieRef);
    if (!tradieSnap.exists) return;
    const data = tradieSnap.data() as { nextInvoiceNumber?: number; paymentInstructions?: string };
    const seq = data.nextInvoiceNumber ?? 1;
    const year = new Date().getFullYear();
    const invoiceNumber = `INV-${year}-${String(seq).padStart(4, "0")}`;
    const invoiceRef = db.collection("invoices").doc();
    tx.set(invoiceRef, {
      tradespersonId: after.tradespersonId,
      clientId: after.clientId,
      jobId: event.params.jobId,
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
