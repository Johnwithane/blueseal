// Send an invoice to the client: render + store the PDF, email it with an
// in-app pay link, flip the invoice to "sent", advance an in-progress job to
// "awaiting_payment", and notify.
//
// NOTE: this no longer talks to Stripe. The PaymentIntent (and the Blue Seal
// service-fee calculation) is created at PAY time by createInvoicePaymentIntent
// when the client opens the pay page — so the fee + Pro waiver are evaluated
// against the live invoice total, not stale at send time, and an invoice edited
// after sending can't drift from the amount actually charged. sendInvoice just
// seeds an empty payment skeleton (with the transfer destination) and promises,
// via the payouts precondition below, that a working pay link will exist.
//
// The PDF total is the invoice total — the Blue Seal service fee is the
// platform's charge to the client at card-checkout, not part of the
// tradesperson's invoice (keeps their books + any GST treatment clean). The PDF
// notes that a fee applies when paying online by card.
//
// Pre-conditions enforced here (rules can't see Stripe):
//   - caller is the assigned tradesperson
//   - invoice is in draft or overdue
//   - line items present + total > 0
//   - tradesperson has payouts.payoutsEnabled === true (and not restricted)

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import PDFDocument from "pdfkit";
import { db, storage } from "../lib/admin";
import { requireAuth } from "../lib/auth";
import { enqueueMail } from "../lib/mail";
import { brandedEmailHtml } from "../lib/emailTemplate";
import { breakdownHtml } from "../lib/emailBreakdown";
import { notify } from "../lib/notify";
import { postSystemMessage } from "../lib/chatSystemMessage";
import { sendInviteClientJobEmail } from "../jobs/inviteHelpers";

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
  discountAmount?: number;
  taxTotal: number;
  total: number;
  currency: string;
  upfrontFeeCredit?: { amountCents: number } | null;
  paymentInstructions: string;
  status?: string;
  payment?: {
    paymentIntentId?: string | null;
    clientSecret?: string | null;
    chargeId?: string | null;
    serviceFee?: unknown;
    transferId?: string | null;
    transferDestination?: string | null;
    refundedAmount?: number | null;
    refunds?: unknown[] | null;
    disputeId?: string | null;
    disputeStatus?: string | null;
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
    doc
      .fontSize(9)
      .fillColor("#666")
      .text(
        "A small Blue Seal service fee applies when paying online by card. " +
          "Paying by e-transfer or cash is fee-free — arrange it with your tradesperson and they'll mark the invoice paid.",
      );
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

export const sendInvoice = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { invoiceId } = parsed.data;

  const invRef = db.doc(`invoices/${invoiceId}`);
  const invSnap = await invRef.get();
  if (!invSnap.exists) throw new HttpsError("not-found", "Invoice not found.");
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
  // The bill can never come in under the upfront fee already paid — the
  // credit clamps at $0 due, so the shortfall would silently vanish.
  const creditCents = inv.upfrontFeeCredit?.amountCents ?? 0;
  const totalBeforeCredit = inv.subtotal - (inv.discountAmount ?? 0) + inv.taxTotal;
  if (creditCents > 0 && totalBeforeCredit < creditCents) {
    throw new HttpsError(
      "failed-precondition",
      `The invoice total ($${(totalBeforeCredit / 100).toFixed(2)}) is less than the upfront ` +
        `fee already paid ($${(creditCents / 100).toFixed(2)}). Add the remaining work before sending.`,
    );
  }

  // Payouts must be live before we promise a card pay link — the client's
  // pay page calls createInvoicePaymentIntent, which needs the connected
  // account. The Connect onboarding UI (/payouts) is the actionable next step.
  const tradieSnap = await db.doc(`tradespeople/${uid}`).get();
  const payouts = (tradieSnap.data()?.payouts ?? {}) as TradiePayouts;
  if (!payouts.payoutsEnabled || !payouts.stripeAccountId) {
    throw new HttpsError(
      "failed-precondition",
      "Finish Stripe Connect onboarding at /payouts before sending invoices.",
    );
  }
  if (payouts.onboardingStatus === "restricted") {
    throw new HttpsError(
      "failed-precondition",
      "Stripe needs more info on your account before you can collect payments. Open /payouts to see what's outstanding.",
    );
  }

  const jobRef = db.doc(`jobs/${inv.jobId}`);
  const [tradieUser, clientUser, jobSnap] = await Promise.all([
    db.doc(`users/${inv.tradespersonId}`).get(),
    db.doc(`users/${inv.clientId}`).get(),
    jobRef.get(),
  ]);
  const job = (jobSnap.data() ?? {}) as {
    status?: string;
    chatId?: string | null;
    clientInvite?: { emailLower?: string; clientName?: string; status?: string };
  };
  const tradieName =
    (tradieUser.data() as { displayName?: string })?.displayName ?? "Tradesperson";
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

  // The invoice flip and the job's status move go in one batch: an invoice
  // that says "sent" while the job still says "in progress" is exactly the
  // stuck state this is fixing, so they must not be able to diverge.
  const batch = db.batch();
  batch.set(
    invRef,
    {
      status: "sent",
      sentAt: FieldValue.serverTimestamp(),
      pdfUrl: downloadUrl,
      // Empty payment skeleton — the PaymentIntent + service-fee snapshot are
      // created at pay time. Preserve any prior payment state (a re-send from
      // overdue may already carry an in-flight intent / refund history).
      payment: {
        paymentIntentId: inv.payment?.paymentIntentId ?? null,
        clientSecret: inv.payment?.clientSecret ?? null,
        chargeId: inv.payment?.chargeId ?? null,
        serviceFee: inv.payment?.serviceFee ?? null,
        transferId: inv.payment?.transferId ?? null,
        transferDestination: payouts.stripeAccountId,
        refundedAmount: inv.payment?.refundedAmount ?? 0,
        refunds: inv.payment?.refunds ?? [],
        disputeId: inv.payment?.disputeId ?? null,
        disputeStatus: inv.payment?.disputeStatus ?? null,
        lastWebhookEventId: inv.payment?.lastWebhookEventId ?? null,
      },
    },
    { merge: true },
  );

  // The bill is out, so the job is now waiting on money rather than on work.
  // This is what makes closing the job out reachable at all for an invoice
  // written by hand on the Invoice tab: createManualInvoice deliberately
  // leaves the job in "in_progress", and markJobPaid only accepts
  // "awaiting_payment" — so before this, a hand-written invoice could be sent
  // and paid but the job could never be completed without dragging the client
  // through the wrap-up/approval flow.
  //
  // Guarded on "in_progress" so the wrap-up paths (which set the status
  // themselves) and a re-send from "overdue" never rewind the job.
  const advancedJob = job.status === "in_progress";
  if (advancedJob) batch.update(jobRef, { status: "awaiting_payment" });
  await batch.commit();

  // Chat line, post-commit + best-effort: onJobUpdated suppresses its generic
  // "Status changed to Awaiting payment" for this transition in favour of this
  // one, which carries the invoice number and amount.
  if (advancedJob && job.chatId) {
    try {
      await postSystemMessage(
        job.chatId,
        `${tradieName} sent invoice ${inv.invoiceNumber} — ${fmtMoney(inv.total, inv.currency)} due.`,
      );
    } catch (err) {
      logger.warn("sendInvoice: chat line skipped", { invoiceId, jobId: inv.jobId, err });
    }
  }

  // Itemized breakdown shared by both delivery paths below (the claimed-client
  // transactional email and the unclaimed-invite magic-link email).
  const invoiceBreakdown = breakdownHtml({
    kind: "invoice",
    number: inv.invoiceNumber,
    currency: inv.currency,
    lineItems: inv.lineItems.map((li) => ({
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
    })),
    subtotal: inv.subtotal,
    discountAmount: inv.discountAmount ?? 0,
    taxTotal: inv.taxTotal,
    total: inv.total,
    paymentInstructions: inv.paymentInstructions,
    pdfUrl: downloadUrl,
  });

  if (clientEmail) {
    // Transactional: the invoice email always sends (it's a bill, not a
    // marketing notification), so it goes direct via enqueueMail rather than
    // through notify() — which gates on the email opt-out and runs at "low"
    // priority (in-app only) for invoices. The itemized breakdown is embedded
    // in the body; the branded shell + PDF link mirror the in-app pay page.
    // No dollar figure here — the embedded breakdown's Total carries it, so
    // repeating it in the greeting just reads as the price twice. The card-fee
    // disclosure lives on the pay page (and PDF), shown at the actual point of
    // payment — no need to lead with it in the email.
    const readyLine = `Hi ${clientName}, your invoice is ready.`;
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
      html: brandedEmailHtml({
        title: `Invoice ${inv.invoiceNumber} from ${tradieName}`,
        bodyLines: [readyLine],
        contentHtml: invoiceBreakdown,
        ctaLabel: "View & pay",
        ctaUrl: payLink(invoiceId),
        preheader: `Your invoice for ${fmtMoney(inv.total, inv.currency)} is ready.`,
      }),
    });
  } else {
    // Unclaimed bring-your-own-client job: inv.clientId is still null, so there
    // was no user account to resolve an email from. Reach the off-platform
    // client at their invited address with a magic-link CTA (mirrors the quote
    // path in submitQuote). One tap signs them in and claimJobInvite backfills
    // the invoice's clientId, so the pay page + receipt then work normally.
    // Best-effort — the tradesperson can still mark the invoice paid offline.
    try {
      const invite = job.clientInvite;
      if (invite?.status === "invited" && invite.emailLower) {
        const inviteClientName = invite.clientName?.trim() || "there";
        await sendInviteClientJobEmail({
          toEmail: invite.emailLower,
          clientName: inviteClientName,
          tradieName,
          jobId: inv.jobId,
          subject: `Invoice ${inv.invoiceNumber} from ${tradieName}`,
          bodyLine: `Hi ${inviteClientName}, your invoice from ${tradieName} is ready — the full breakdown is below. Tap through to view and pay it (no password needed).`,
          contentHtml: invoiceBreakdown,
          ctaLabel: "View & pay",
        });
      }
    } catch (err) {
      logger.warn("sendInvoice: invite-client email skipped", {
        invoiceId,
        jobId: inv.jobId,
        err,
      });
    }
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

  return { ok: true, pdfUrl: downloadUrl };
});
