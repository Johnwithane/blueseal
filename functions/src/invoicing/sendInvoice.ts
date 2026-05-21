import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import PDFDocument from "pdfkit";
import { db, storage } from "../lib/admin";
import { requireAuth } from "../lib/auth";
import { enqueueMail } from "../lib/mail";

const Input = z.object({ invoiceId: z.string().min(1) });

interface InvoiceData {
  invoiceNumber: string;
  tradespersonId: string;
  clientId: string;
  lineItems: Array<{ description: string; quantity: number; unitPrice: number; taxRate: number }>;
  subtotal: number;
  taxTotal: number;
  total: number;
  currency: string;
  paymentInstructions: string;
}

function fmtMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(cents / 100);
}

async function renderPdf(inv: InvoiceData, tradieName: string, clientName: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 });
    const buffers: Buffer[] = [];
    doc.on("data", (b: Buffer) => buffers.push(b));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    doc.fontSize(20).text("Blue Seal", { continued: false });
    doc.moveDown(0.5);
    doc.fontSize(14).text(`Invoice ${inv.invoiceNumber}`);
    doc.fontSize(10).fillColor("#666").text(`From: ${tradieName}`);
    doc.text(`To: ${clientName}`);
    doc.moveDown();
    doc.fillColor("#000");
    inv.lineItems.forEach((li) => {
      const line = `${li.description}  —  ${li.quantity} × ${fmtMoney(li.unitPrice, inv.currency)}  =  ${fmtMoney(li.quantity * li.unitPrice, inv.currency)}`;
      doc.fontSize(11).text(line);
    });
    doc.moveDown();
    doc.fontSize(11).text(`Subtotal: ${fmtMoney(inv.subtotal, inv.currency)}`);
    doc.text(`Tax: ${fmtMoney(inv.taxTotal, inv.currency)}`);
    doc.fontSize(13).text(`Total: ${fmtMoney(inv.total, inv.currency)}`, { underline: true });
    if (inv.paymentInstructions) {
      doc.moveDown();
      doc.fontSize(10).fillColor("#444").text("Payment instructions:", { underline: true });
      doc.text(inv.paymentInstructions);
    }
    doc.end();
  });
}

export const sendInvoice = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = requireAuth(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { invoiceId } = parsed.data;

  const invRef = db.doc(`invoices/${invoiceId}`);
  const invSnap = await invRef.get();
  if (!invSnap.exists) throw new HttpsError("not-found", "Invoice not found.");
  const inv = invSnap.data() as InvoiceData & { status?: string };
  if (inv.tradespersonId !== uid) {
    throw new HttpsError("permission-denied", "Only the tradesperson can send this invoice.");
  }
  // Only draft / overdue invoices may be (re)sent — never paid/void.
  if (inv.status && !["draft", "overdue"].includes(inv.status)) {
    throw new HttpsError(
      "failed-precondition",
      `Invoice cannot be sent in status "${inv.status}".`,
    );
  }
  if (!inv.lineItems || inv.lineItems.length === 0 || inv.total <= 0) {
    throw new HttpsError("failed-precondition", "Invoice has no line items or zero total.");
  }

  const [tradieUser, clientUser] = await Promise.all([
    db.doc(`users/${inv.tradespersonId}`).get(),
    db.doc(`users/${inv.clientId}`).get(),
  ]);
  const tradieName = (tradieUser.data() as { displayName?: string })?.displayName ?? "Tradesperson";
  const clientName = (clientUser.data() as { displayName?: string })?.displayName ?? "Client";
  const clientEmail = (clientUser.data() as { email?: string })?.email;

  const pdf = await renderPdf(inv, tradieName, clientName);
  const file = storage.bucket().file(`invoices/${invoiceId}.pdf`);
  await file.save(pdf, { contentType: "application/pdf", resumable: false });
  const [downloadUrl] = await file.getSignedUrl({
    action: "read",
    expires: Date.now() + 1000 * 60 * 60 * 24 * 30,
  });

  await invRef.update({
    status: "sent",
    sentAt: FieldValue.serverTimestamp(),
    pdfUrl: downloadUrl,
  });

  if (clientEmail) {
    await enqueueMail({
      to: clientEmail,
      subject: `Invoice ${inv.invoiceNumber} from ${tradieName}`,
      text: `Hi ${clientName},\n\nYour invoice for ${fmtMoney(inv.total, inv.currency)} is attached and available at: ${downloadUrl}\n\nPayment instructions:\n${inv.paymentInstructions || "—"}`,
    });
  }

  return { ok: true, pdfUrl: downloadUrl };
});
