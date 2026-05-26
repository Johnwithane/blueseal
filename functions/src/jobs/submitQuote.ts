import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { postSystemMessage } from "../lib/chatSystemMessage";
import { notify } from "../lib/notify";

const LineItemSchema = z.object({
  kind: z.enum(["hourly", "labour", "materials"]).optional(),
  description: z.string().min(1).max(200),
  quantity: z.number().min(0).max(10_000),
  unitPrice: z.number().int().min(0).max(100_000_000),
  taxRate: z.number().min(0).max(1),
});

const DiscountSchema = z.object({
  type: z.enum(["percent", "fixed"]),
  value: z.number().min(0),
  label: z.string().max(60).nullable(),
});

// Upfront fee input — discriminated union so the client can pass either
// shape unambiguously. amountCents is the dollar value at submit time;
// bps (basis points, 0–5000 = 0–50%) is only present for "percent".
// We re-derive amountCents server-side from the computed subtotal so a
// malicious client can't underpay relative to the quote they're agreeing to.
const UpfrontFeeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("fixed"),
    amountCents: z.number().int().min(1).max(100_000_000),
  }),
  z.object({
    type: z.literal("percent"),
    // 50% cap — see Quote upfront fee plan. 1bps = 0.01%.
    bps: z.number().int().min(1).max(5000),
  }),
]);

const Input = z.object({
  jobId: z.string().min(1).max(128),
  lineItems: z.array(LineItemSchema).min(1).max(40),
  discount: DiscountSchema.nullable().default(null),
  estimatedHours: z.number().min(0).max(10_000).nullable().default(null),
  validUntilDays: z.number().int().min(1).max(180).default(14),
  terms: z.string().max(2000).default(""),
  noteToClient: z.string().max(500).default(""),
  upfrontFee: UpfrontFeeSchema.nullable().default(null),
});

interface JobData {
  tradespersonId: string;
  clientId: string;
  title: string;
  status: string;
  chatId: string;
}

interface LineItem {
  kind?: "hourly" | "labour" | "materials";
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

interface Discount {
  type: "percent" | "fixed";
  value: number;
  label: string | null;
}

// Duplicated mirror of src/firebase/services/invoices.ts → recomputeTotals.
// See note in submitJobForApproval.ts for the duplication rationale.
function computeTotals(items: LineItem[], discount: Discount | null) {
  let subtotal = 0;
  for (const li of items) subtotal += li.quantity * li.unitPrice;

  let discountAmount = 0;
  if (discount && subtotal > 0) {
    if (discount.type === "percent") {
      const pct = Math.max(0, Math.min(100, discount.value));
      discountAmount = Math.round((subtotal * pct) / 100);
    } else {
      discountAmount = Math.max(0, Math.min(subtotal, Math.round(discount.value)));
    }
  }

  const factor = subtotal > 0 ? (subtotal - discountAmount) / subtotal : 1;
  let taxTotal = 0;
  for (const li of items) {
    const lineSub = li.quantity * li.unitPrice;
    taxTotal += Math.round(lineSub * factor * li.taxRate);
  }

  return { subtotal, discountAmount, taxTotal, total: subtotal - discountAmount + taxTotal };
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
export const submitQuote = onCall({ enforceAppCheck: false }, async (req) => {
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
  } = parsed.data;

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
  // accepted quote. For percent we re-derive amountCents server-side from
  // (subtotal − discountAmount) so the dollar value is always tied to the
  // quote's pre-tax basis (consistent with how InvoiceDiscount applies). For
  // fixed we accept the client's amountCents but clamp to the pre-tax
  // discounted subtotal so the fee can't exceed the quote itself.
  const preTaxBase = Math.max(0, totals.subtotal - totals.discountAmount);
  let upfrontFee: { type: "fixed" | "percent"; bps?: number; amountCents: number } | null = null;
  if (upfrontFeeInput) {
    if (upfrontFeeInput.type === "percent") {
      const cents = Math.round((preTaxBase * upfrontFeeInput.bps) / 10_000);
      if (cents <= 0) {
        throw new HttpsError(
          "failed-precondition",
          "Upfront fee resolves to zero — increase the percentage or pick a fixed amount.",
        );
      }
      upfrontFee = { type: "percent", bps: upfrontFeeInput.bps, amountCents: cents };
    } else {
      const cents = Math.min(upfrontFeeInput.amountCents, preTaxBase);
      if (cents <= 0) {
        throw new HttpsError("failed-precondition", "Upfront fee must be greater than zero.");
      }
      upfrontFee = { type: "fixed", amountCents: cents };
    }
  }

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

  await notify({
    userId: job.clientId,
    type: "invoice_sent",
    title: `${tradieName} sent you a quote`,
    body: `$${(totals.total / 100).toFixed(2)} — review and accept.`,
    link: `/jobs/${jobId}`,
    actorUid: uid,
    jobId,
    chatId: job.chatId ?? null,
    recipientRole: "client",
    priority: "high",
  });

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
