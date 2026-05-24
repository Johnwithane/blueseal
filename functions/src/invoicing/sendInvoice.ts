// Send an invoice through Stripe Connect. Replaces the pre-cutover
// "render PDF + email payment instructions" flow with: create a
// PaymentIntent on the platform with application_fee_amount +
// transfer_data.destination, snapshot the fee on the invoice, then
// render+email the PDF with an in-app pay link.
//
// Pre-conditions enforced here (rules can't see Stripe):
//   - caller is the assigned tradesperson
//   - invoice is in draft or overdue
//   - line items present + total > 0
//   - tradesperson has payouts.payoutsEnabled === true
//
// Idempotency: pass the invoiceId as `idempotencyKey` to Stripe so a
// repeated callable hit (network retry, double-tap) doesn't create a
// duplicate PaymentIntent. If `invoice.payment.paymentIntentId` is already
// set we reuse it and skip the Stripe round-trip — re-sending the email
// shouldn't move money.
//
// Fee math: `application_fee_amount = floor(total * PLATFORM_FEE_BPS / 10000)`.
// Computed on the gross (incl. tax) for simplicity — most invoicing
// platforms do the same. Snapshotted via `applicationFeeBps` so historical
// invoices stay auditable when PLATFORM_FEE_BPS changes.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import PDFDocument from "pdfkit";
import { db, storage } from "../lib/admin";
import { requireAuth } from "../lib/auth";
import { enqueueMail } from "../lib/mail";
import { notify } from "../lib/notify";
import {
  PLATFORM_FEE_BPS,
  STRIPE_SECRET_KEY,
  getStripe,
} from "../payments/stripeClient";

const Input = z.object({ invoiceId: z.string().min(1) });

interface InvoiceData {
  invoiceNumber: string;
  tradespersonId: string;
  clientId: string;
  jobId: string;
  lineItems: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    taxRate: number;
  }>;
  subtotal: number;
  taxTotal: number;
  total: number;
  currency: string;
  paymentInstructions: string;
  status?: string;
  payment?: {
    paymentIntentId?: string | null;
    clientSecret?: string | null;
    chargeId?: string | null;
    applicationFeeAmount?: number | null;
    applicationFeeBps?: number | null;
    transferDestination?: string | null;
    refundedAmount?: number | null;
    refunds?: unknown[] | null;
    lastWebhookEventId?: string | null;
  } | null;
}

interface TradiePayouts {
  stripeAccountId?: string | null;
  payoutsEnabled?: boolean;
  chargesEnabled?: boolean;
  onboardingStatus?: "not_started" | "in_progress" | "restricted" | "enabled";
  disabledReason?: string | null;
}

function fmtMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
    cents / 100,
  );
}

function appBaseUrl(): string {
  const raw = process.env.APP_BASE_URL ?? "https://blueseal.app";
  return raw.replace(/\/$/, "");
}

function payLink(invoiceId: string): string {
  return `${appBaseUrl()}/invoices/${invoiceId}/pay`;
}

async function renderPdf(
  inv: InvoiceData,
  tradieName: string,
  clientName: string,
  invoiceId: string,
): Promise<Buffer> {
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
    doc
      .fontSize(13)
      .text(`Total: ${fmtMoney(inv.total, inv.currency)}`, { underline: true });
    doc.moveDown();
    doc
      .fontSize(11)
      .fillColor("#0a4d8c")
      .text(`Pay online: ${payLink(invoiceId)}`, {
        link: payLink(invoiceId),
        underline: true,
      });
    doc.fillColor("#000");
    if (inv.paymentInstructions) {
      doc.moveDown();
      doc
        .fontSize(10)
        .fillColor("#444")
        .text("Additional notes:", { underline: true });
      doc.text(inv.paymentInstructions);
    }
    doc.end();
  });
}

export const sendInvoice = onCall(
  { secrets: [STRIPE_SECRET_KEY], enforceAppCheck: false },
  async (req) => {
    const uid = requireAuth(req);
    const parsed = Input.safeParse(req.data);
    if (!parsed.success)
      throw new HttpsError("invalid-argument", parsed.error.message);
    const { invoiceId } = parsed.data;

    const invRef = db.doc(`invoices/${invoiceId}`);
    const invSnap = await invRef.get();
    if (!invSnap.exists)
      throw new HttpsError("not-found", "Invoice not found.");
    const inv = invSnap.data() as InvoiceData;

    if (inv.tradespersonId !== uid) {
      throw new HttpsError(
        "permission-denied",
        "Only the tradesperson can send this invoice.",
      );
    }
    if (inv.status && !["draft", "overdue"].includes(inv.status)) {
      throw new HttpsError(
        "failed-precondition",
        `Invoice cannot be sent in status "${inv.status}".`,
      );
    }
    if (!inv.lineItems || inv.lineItems.length === 0 || inv.total <= 0) {
      throw new HttpsError(
        "failed-precondition",
        "Invoice has no line items or zero total.",
      );
    }

    // Stripe Connect precondition — payouts must be live before we can
    // route money through the tradie's connected account. The Connect
    // onboarding UI (/payouts) is the user-actionable next step.
    const tradieSnap = await db.doc(`tradespeople/${uid}`).get();
    const payouts = (tradieSnap.data()?.payouts ?? {}) as TradiePayouts;
    if (!payouts.payoutsEnabled || !payouts.stripeAccountId) {
      throw new HttpsError(
        "failed-precondition",
        "Finish Stripe Connect onboarding at /payouts before sending invoices.",
      );
    }
    // Separately reject `restricted` even when payoutsEnabled briefly
    // lingers true — Stripe can flip an account to restricted with
    // requirements outstanding while still leaving payouts_enabled set
    // for a short window. Sending an invoice in that window creates a
    // PaymentIntent that fails at capture time, which is a worse UX
    // than rejecting the send upfront. Message references /payouts
    // where the requirements list is surfaced.
    if (payouts.onboardingStatus === "restricted") {
      throw new HttpsError(
        "failed-precondition",
        "Stripe needs more info on your account before you can collect payments. Open /payouts to see what's outstanding.",
      );
    }

    const feeBps = Number.parseInt(PLATFORM_FEE_BPS.value(), 10);
    if (!Number.isFinite(feeBps) || feeBps < 0 || feeBps > 10_000) {
      throw new HttpsError(
        "internal",
        "Platform fee is misconfigured. Contact support.",
      );
    }
    const applicationFeeAmount = Math.floor((inv.total * feeBps) / 10_000);

    const stripe = getStripe();
    let paymentIntentId = inv.payment?.paymentIntentId ?? null;
    let clientSecret = inv.payment?.clientSecret ?? null;

    if (!paymentIntentId) {
      // First send. Idempotency key tied to invoiceId so a retried
      // callable invocation reuses the same Stripe object instead of
      // creating a sibling PaymentIntent.
      const pi = await stripe.paymentIntents.create(
        {
          amount: inv.total,
          currency: inv.currency.toLowerCase(),
          application_fee_amount: applicationFeeAmount,
          transfer_data: { destination: payouts.stripeAccountId },
          automatic_payment_methods: { enabled: true },
          metadata: {
            invoiceId,
            jobId: inv.jobId,
            tradespersonId: inv.tradespersonId,
            clientId: inv.clientId,
            invoiceNumber: inv.invoiceNumber,
          },
          description: `Blue Seal invoice ${inv.invoiceNumber}`,
        },
        { idempotencyKey: `invoice:${invoiceId}:create` },
      );
      paymentIntentId = pi.id;
      clientSecret = pi.client_secret ?? null;
    }

    const [tradieUser, clientUser] = await Promise.all([
      db.doc(`users/${inv.tradespersonId}`).get(),
      db.doc(`users/${inv.clientId}`).get(),
    ]);
    const tradieName =
      (tradieUser.data() as { displayName?: string })?.displayName ??
      "Tradesperson";
    const clientName =
      (clientUser.data() as { displayName?: string })?.displayName ?? "Client";
    const clientEmail = (clientUser.data() as { email?: string })?.email;

    const pdf = await renderPdf(inv, tradieName, clientName, invoiceId);
    const file = storage.bucket().file(`invoices/${invoiceId}.pdf`);
    await file.save(pdf, { contentType: "application/pdf", resumable: false });
    const [downloadUrl] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 1000 * 60 * 60 * 24 * 30,
    });

    await invRef.set(
      {
        status: "sent",
        sentAt: FieldValue.serverTimestamp(),
        pdfUrl: downloadUrl,
        payment: {
          paymentIntentId,
          clientSecret,
          chargeId: inv.payment?.chargeId ?? null,
          applicationFeeAmount,
          applicationFeeBps: feeBps,
          transferId: null,
          transferDestination: payouts.stripeAccountId,
          refundedAmount: inv.payment?.refundedAmount ?? 0,
          refunds: inv.payment?.refunds ?? [],
          disputeId: null,
          disputeStatus: null,
          lastWebhookEventId: inv.payment?.lastWebhookEventId ?? null,
        },
      },
      { merge: true },
    );

    if (clientEmail) {
      await enqueueMail({
        to: clientEmail,
        subject: `Invoice ${inv.invoiceNumber} from ${tradieName}`,
        text:
          `Hi ${clientName},\n\n` +
          `Your invoice for ${fmtMoney(inv.total, inv.currency)} is ready.\n\n` +
          `Pay online: ${payLink(invoiceId)}\n` +
          `PDF: ${downloadUrl}\n\n` +
          (inv.paymentInstructions
            ? `Notes from ${tradieName}:\n${inv.paymentInstructions}\n\n`
            : "") +
          `Thanks,\nBlue Seal`,
      });
    }

    await notify({
      userId: inv.clientId,
      type: "invoice_sent",
      title: `Invoice ${inv.invoiceNumber} from ${tradieName}`,
      body: `${fmtMoney(inv.total, inv.currency)} due. Tap to pay online.`,
      link: `/invoices/${invoiceId}/pay`,
      actorUid: inv.tradespersonId,
      recipientRole: "client",
      priority: "low",
    });

    return { ok: true, pdfUrl: downloadUrl, paymentIntentId, clientSecret };
  },
);
