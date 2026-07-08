import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import PDFDocument from "pdfkit";
import { db, storage } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { postSystemMessage } from "../lib/chatSystemMessage";
import { notify } from "../lib/notify";
import { breakdownHtml } from "../lib/emailBreakdown";
import { LineItemSchema, DiscountSchema, UpfrontFeeSchema } from "../lib/quoteSchemas";
import { computeTotals, resolveUpfrontFee } from "../lib/quoteTotals";
import { sendInviteClientJobEmail } from "./inviteHelpers";

const Input = z.object({
  jobId: z.string().min(1).max(128),
  lineItems: z.array(LineItemSchema).min(1).max(40),
  discount: DiscountSchema.nullable().default(null),
  estimatedHours: z.number().min(0).max(10_000).nullable().default(null),
  validUntilDays: z.number().int().min(1).max(180).default(14),
  terms: z.string().max(2000).default(""),
  noteToClient: z.string().max(500).default(""),
  upfrontFee: UpfrontFeeSchema.nullable().default(null),
  proposedStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  estimatedDuration: z.string().max(80).default(""),
});

interface JobData {
  tradespersonId: string;
  // null on an unclaimed bring-your-own-client job — the client hasn't taken
  // the magic-link invite yet, so there is no user account to notify.
  clientId: string | null;
  title: string;
  status: string;
  chatId: string;
  clientInvite?: {
    emailLower?: string;
    clientName?: string;
    status?: string;
  } | null;
}

/**
 * Tradesperson sends (or re-sends) a quote to the client. Mirrors
 * submitJobForApproval in shape — atomically drafts/refreshes the quote
 * doc, transitions the job to "quoted", posts a chat system message, and
 * notifies the client.
 *
 * Allowed source statuses:
 *   "requested"         — direct-request flow, client filled the intake.
 *   "accepted"          — marketplace flow + intake already in the doc
 *                          (rare; usually intake submit advances to
 *                          requested first, but allowed for robustness).
 *   "quoted"            — re-sending an updated quote (covers the
 *                          "client declined, tradesperson revised" case).
 *
 * Deterministic quote id = jobId, so the create is idempotent and a
 * re-fire of the callable just replaces the draft fields rather than
 * stamping a new quote number.
 *
 * onJobUpdated suppresses its generic status-changed line for the
 * "*->quoted" transitions because the message posted here is richer.
 */
export const submitQuote = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const {
    jobId,
    lineItems,
    discount,
    estimatedHours,
    validUntilDays,
    terms,
    noteToClient,
    upfrontFee: upfrontFeeInput,
    proposedStartDate,
    estimatedDuration,
  } = parsed.data;

  // Calendar date → UTC midnight Timestamp (so it round-trips as the same
  // day regardless of the viewer's timezone). Null when not provided.
  const proposedStartTs = proposedStartDate
    ? Timestamp.fromDate(new Date(`${proposedStartDate}T00:00:00Z`))
    : null;

  const jobRef = db.doc(`jobs/${jobId}`);
  const quoteRef = db.doc(`quotes/${jobId}`);
  const tradieRef = db.doc(`tradespeople/${uid}`);

  const [jobSnap, quoteSnap, tradieSnap] = await Promise.all([
    jobRef.get(),
    quoteRef.get(),
    tradieRef.get(),
  ]);

  if (!jobSnap.exists) throw new HttpsError("not-found", "Job not found.");
  const job = jobSnap.data() as JobData;
  if (job.tradespersonId !== uid) {
    throw new HttpsError("permission-denied", "Not your job.");
  }
  const allowedSourceStatuses = ["requested", "accepted", "quoted"];
  if (!allowedSourceStatuses.includes(job.status)) {
    throw new HttpsError(
      "failed-precondition",
      `Quote can only be sent from requested/accepted/quoted. Current: ${job.status}.`,
    );
  }
  if (!tradieSnap.exists) {
    throw new HttpsError("failed-precondition", "Tradesperson profile not found.");
  }
  const tradie = tradieSnap.data() as {
    displayName?: string;
    nextQuoteNumber?: number;
    quotePrefix?: string;
  };

  const totals = computeTotals(lineItems, discount);
  if (totals.total <= 0) {
    throw new HttpsError("failed-precondition", "Quote total must be greater than zero.");
  }

  // Resolve upfront fee against the same subtotal the client will see on the
  // accepted quote — re-derived server-side from (subtotal − discountAmount)
  // so the dollar value is always tied to the quote's pre-tax basis and can't
  // be tampered with. See resolveUpfrontFee in lib/quoteTotals.ts.
  const preTaxBase = Math.max(0, totals.subtotal - totals.discountAmount);
  const upfrontFee = resolveUpfrontFee(upfrontFeeInput, preTaxBase);

  const validUntilMs = Date.now() + validUntilDays * 24 * 60 * 60 * 1000;
  const validUntil = Timestamp.fromMillis(validUntilMs);

  const batch = db.batch();
  let quoteNumber: string;

  if (!quoteSnap.exists) {
    const seq = tradie.nextQuoteNumber ?? 1;
    const prefix = (tradie.quotePrefix ?? "Q").trim() || "Q";
    const year = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      year: "numeric",
    }).format(new Date());
    quoteNumber = `${prefix}-${year}-${String(seq).padStart(4, "0")}`;
    batch.set(quoteRef, {
      tradespersonId: uid,
      clientId: job.clientId,
      jobId,
      quoteNumber,
      status: "sent",
      lineItems,
      subtotal: totals.subtotal,
      discount,
      discountAmount: totals.discountAmount,
      taxTotal: totals.taxTotal,
      total: totals.total,
      currency: "CAD",
      estimatedHours,
      proposedStartDate: proposedStartTs,
      estimatedDuration,
      validUntil,
      terms,
      noteToClient,
      declinedReason: null,
      issuedAt: FieldValue.serverTimestamp(),
      sentAt: FieldValue.serverTimestamp(),
      viewedAt: null,
      acceptedAt: null,
      declinedAt: null,
      pdfUrl: null,
      upfrontFee,
    });
    batch.update(tradieRef, { nextQuoteNumber: seq + 1 });
  } else {
    quoteNumber = (quoteSnap.data() as { quoteNumber?: string }).quoteNumber ?? "Q-?";
    // Re-send overwrites the editable surface and resets to sent. Preserve
    // the original quote number + issuedAt; bump sentAt so the client sees
    // a fresh "valid until" window.
    batch.update(quoteRef, {
      status: "sent",
      lineItems,
      subtotal: totals.subtotal,
      discount,
      discountAmount: totals.discountAmount,
      taxTotal: totals.taxTotal,
      total: totals.total,
      estimatedHours,
      proposedStartDate: proposedStartTs,
      estimatedDuration,
      validUntil,
      terms,
      noteToClient,
      sentAt: FieldValue.serverTimestamp(),
      viewedAt: null,
      acceptedAt: null,
      // Keep declinedReason on the record so the tradesperson sees the
      // history during revision; clear it once accepted.
      upfrontFee,
    });
  }

  batch.update(jobRef, { status: "quoted" });

  await batch.commit();

  // ---------- chat + notification (post-commit, best-effort) ----------
  const tradieName = tradie.displayName?.trim() || "The tradesperson";
  const intro =
    job.status === "quoted"
      ? `${tradieName} sent a revised quote.`
      : `${tradieName} sent you a quote.`;
  const totalLine = `Total: $${(totals.total / 100).toFixed(2)} — valid until ${formatDate(validUntil)}.`;
  const noteLine = noteToClient.trim() ? `Note: "${noteToClient.trim()}"` : "";
  const upfrontLine = upfrontFee
    ? `Upfront fee required to start: $${(upfrontFee.amountCents / 100).toFixed(2)}${
        upfrontFee.type === "percent" ? ` (${(upfrontFee.bps! / 100).toFixed(0)}%)` : ""
      }.`
    : "";
  const message = [intro, noteLine, totalLine, upfrontLine, "Review and accept on the job page."]
    .filter(Boolean)
    .join("\n");

  if (job.chatId) await postSystemMessage(job.chatId, message);

  // Render + store a PDF copy of the quote so the email can link a download
  // (mirrors invoices). Best-effort: the quote is already committed, so a PDF
  // failure must never fail the send — swallow + log like the notify channels.
  let quotePdfUrl: string | null = null;
  try {
    const clientSnap = await db.doc(`users/${job.clientId}`).get();
    const clientName =
      (clientSnap.data() as { displayName?: string })?.displayName ?? "Client";
    const pdf = await renderQuotePdf({
      quoteNumber,
      tradieName,
      clientName,
      lineItems,
      subtotal: totals.subtotal,
      discountAmount: totals.discountAmount,
      taxTotal: totals.taxTotal,
      total: totals.total,
      validUntil,
      terms,
      currency: "CAD",
    });
    const file = storage.bucket().file(`quotes/${jobId}.pdf`);
    await file.save(pdf, { contentType: "application/pdf", resumable: false });
    const [url] = await file.getSignedUrl({
      action: "read",
      expires: Date.now() + 1000 * 60 * 60 * 24 * 30,
    });
    quotePdfUrl = url;
    await quoteRef.update({ pdfUrl: url });
  } catch (err) {
    logger.error("submitQuote: quote PDF render/store failed", { jobId, err });
  }

  // Itemized breakdown embedded in the notification email so the client can
  // read the whole quote in their inbox. The CTA still drives back into the
  // app, where acceptance (with e-signature) happens.
  const upfrontFeeLabel = upfrontFee
    ? `$${(upfrontFee.amountCents / 100).toFixed(2)}${
        upfrontFee.type === "percent" ? ` (${(upfrontFee.bps! / 100).toFixed(0)}%)` : ""
      }`
    : null;
  const quoteBreakdown = breakdownHtml({
    kind: "quote",
    number: quoteNumber,
    currency: "CAD",
    lineItems,
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    taxTotal: totals.taxTotal,
    total: totals.total,
    validUntilLabel: formatDate(validUntil),
    estimatedHours,
    estimatedDuration: estimatedDuration || null,
    proposedStartLabel: proposedStartTs ? formatDate(proposedStartTs) : null,
    upfrontFeeLabel,
    terms,
    pdfUrl: quotePdfUrl,
  });

  await notify({
    userId: job.clientId,
    // Dedicated quote type (P2-08); still lands on the Invoice tab (where a
    // quote is reviewed) via INVOICE_TAB_TYPES, and ctaLabel sets the button.
    type: "quote_received",
    title: `${tradieName} sent you a quote`,
    body: `$${(totals.total / 100).toFixed(2)} — review and approve.`,
    link: `/jobs/${jobId}`,
    actorUid: uid,
    jobId,
    chatId: job.chatId ?? null,
    recipientRole: "client",
    priority: "high",
    emailContentHtml: quoteBreakdown,
    ctaLabel: "Review & approve",
  });

  // Unclaimed bring-your-own-client job: notify() above no-ops on the null
  // clientId (there's no account), so reach the off-platform client directly
  // at their invited email with a magic-link CTA — one tap signs them in,
  // claims the job, and lands them on it to review + approve. Best-effort and
  // gated (suppression / CASL / email-link) exactly like the initial invite;
  // the tradesperson can still record acceptance offline if it doesn't send.
  const invite = job.clientInvite;
  if (!job.clientId && invite?.status === "invited" && invite.emailLower) {
    try {
      const clientName = invite.clientName?.trim() || "there";
      await sendInviteClientJobEmail({
        toEmail: invite.emailLower,
        clientName,
        tradieName,
        jobId,
        subject: `${tradieName} sent you a quote on Blue Seal`,
        bodyLine: `Hi ${clientName}, ${tradieName} sent you a quote — the full breakdown is below. Tap through to review and approve it (no password needed).`,
        contentHtml: quoteBreakdown,
        ctaLabel: "Review & approve",
      });
    } catch (err) {
      logger.warn("submitQuote: invite-client email skipped", { jobId, err });
    }
  }

  logger.info("submitQuote", {
    jobId,
    tradespersonId: uid,
    quoteNumber,
    total: totals.total,
    isResend: quoteSnap.exists,
  });

  return { ok: true, total: totals.total, quoteNumber };
});

function formatDate(ts: Timestamp): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
  }).format(ts.toDate());
}

function fmtMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
    cents / 100,
  );
}

/**
 * Basic pdfkit render of the quote — same shape as the invoice PDF
 * (functions/src/invoicing/sendInvoice.ts) so the two documents stay
 * consistent. Linked (signed URL) from the quote email, not attached.
 */
async function renderQuotePdf(q: {
  quoteNumber: string;
  tradieName: string;
  clientName: string;
  lineItems: Array<{ description: string; quantity: number; unitPrice: number }>;
  subtotal: number;
  discountAmount: number;
  taxTotal: number;
  total: number;
  validUntil: Timestamp;
  terms: string;
  currency: string;
}): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 });
    const buffers: Buffer[] = [];
    doc.on("data", (b: Buffer) => buffers.push(b));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    doc.fontSize(20).text("Blue Seal");
    doc.moveDown(0.5);
    doc.fontSize(14).text(`Quote ${q.quoteNumber}`);
    doc.fontSize(10).fillColor("#666").text(`From: ${q.tradieName}`);
    doc.text(`To: ${q.clientName}`);
    doc.text(`Valid until: ${formatDate(q.validUntil)}`);
    doc.moveDown();
    doc.fillColor("#000");
    q.lineItems.forEach((li) => {
      const line = `${li.description}  —  ${li.quantity} × ${fmtMoney(li.unitPrice, q.currency)}  =  ${fmtMoney(li.quantity * li.unitPrice, q.currency)}`;
      doc.fontSize(11).text(line);
    });
    doc.moveDown();
    doc.fontSize(11).text(`Subtotal: ${fmtMoney(q.subtotal, q.currency)}`);
    if (q.discountAmount > 0) {
      doc.text(`Discount: -${fmtMoney(q.discountAmount, q.currency)}`);
    }
    doc.text(`Tax: ${fmtMoney(q.taxTotal, q.currency)}`);
    doc
      .fontSize(13)
      .text(`Total: ${fmtMoney(q.total, q.currency)}`, { underline: true });
    if (q.terms && q.terms.trim()) {
      doc.moveDown();
      doc.fontSize(10).fillColor("#444").text("Terms:", { underline: true });
      doc.fillColor("#000").text(q.terms.trim());
    }
    doc.end();
  });
}
