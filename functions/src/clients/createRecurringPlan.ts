// Create a recurring charge for a client-book contact (Blue Seal Pro). A
// recurring charge is NOT a new billing system — it reuses the existing
// solo-job + recurring-invoice engine:
//
//   1. one hidden backing "service job" (like createInviteJob: clientId null /
//      off-platform, acceptedOffline so it never feeds reviews, originType
//      "recurring_plan" so it's filtered out of the kanban/calendar), plus
//   2. one TEMPLATE invoice at invoices/{jobId} flagged recurring.enabled with
//      a nextRunAt one period out.
//
// The template draft IS the first invoice to review + send now. The daily
// scheduledRecurringInvoices engine then clones a fresh DRAFT each period from
// the template's current content (never auto-sending) and advances nextRunAt —
// zero engine changes. Editing the template changes future bills; pausing
// (setRecurringPlanState) stops them.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { assertPro } from "../lib/subscription";
import { requireVisibleTradie } from "../jobPosts/helpers";
import { computeTotals } from "../lib/quoteTotals";

const LineItemSchema = z.object({
  description: z.string().trim().min(1).max(200),
  quantity: z.number().min(0).max(10_000),
  unitPrice: z.number().int().min(0).max(100_000_000), // cents
  taxRate: z.number().min(0).max(1),
});

const DiscountSchema = z.object({
  type: z.enum(["percent", "fixed"]),
  value: z.number().min(0),
  label: z.string().max(60).nullable(),
});

const Input = z.object({
  clientId: z.string().min(1).max(128),
  label: z.string().trim().min(1).max(140),
  frequency: z.enum(["weekly", "monthly", "quarterly"]),
  lineItems: z.array(LineItemSchema).min(1).max(20),
  discount: DiscountSchema.nullable().default(null),
});

type Frequency = "weekly" | "monthly" | "quarterly";

// Mirrors scheduledRecurringInvoices.advance — the next occurrence after `ts`.
function advance(ts: Timestamp, freq: Frequency): Timestamp {
  const d = ts.toDate();
  if (freq === "weekly") d.setDate(d.getDate() + 7);
  else if (freq === "quarterly") d.setMonth(d.getMonth() + 3);
  else d.setMonth(d.getMonth() + 1);
  return Timestamp.fromDate(d);
}

export const createRecurringPlan = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  await requireVisibleTradie(uid);
  await assertPro(uid); // throws BLUESEAL_PRO_REQUIRED for the client paywall

  const parsed = Input.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const input = parsed.data;

  const clientRef = db.doc(`clients/${input.clientId}`);
  const tradieRef = db.doc(`tradespeople/${uid}`);
  const userRef = db.doc(`users/${uid}`);
  const [clientSnap, tradieSnap, userSnap] = await Promise.all([
    clientRef.get(),
    tradieRef.get(),
    userRef.get(),
  ]);

  if (!clientSnap.exists) throw new HttpsError("not-found", "Client not found.");
  const client = clientSnap.data() as {
    tradespersonId: string;
    displayName: string;
    linkedUserId?: string | null;
    address?: { line1: string; city: string; region: string; postalCode: string } | null;
    archivedAt?: Timestamp | null;
  };
  if (client.tradespersonId !== uid) throw new HttpsError("permission-denied", "Not your client.");
  if (client.archivedAt) {
    throw new HttpsError("failed-precondition", "Restore this client before adding recurring billing.");
  }

  const tradie = (tradieSnap.data() ?? {}) as {
    nextInvoiceNumber?: number;
    invoicePrefix?: string;
    paymentInstructions?: string;
    trades?: string[];
  };
  const user = (userSnap.data() ?? {}) as { displayName?: unknown; photoURL?: unknown };
  const tradieName =
    (typeof user.displayName === "string" && user.displayName.trim()) || "Tradesperson";
  const tradiePhoto = typeof user.photoURL === "string" ? user.photoURL : null;

  const totals = computeTotals(input.lineItems, input.discount);
  if (totals.total <= 0) {
    throw new HttpsError("failed-precondition", "The recurring charge total must be greater than zero.");
  }

  const now = Timestamp.now();
  const nextRunAt = advance(now, input.frequency);

  const jobRef = db.collection("jobs").doc();
  const chatRef = db.collection("chats").doc();
  const invoiceRef = db.doc(`invoices/${jobRef.id}`); // deterministic template id

  const seq = tradie.nextInvoiceNumber ?? 1;
  const prefix = (tradie.invoicePrefix ?? "INV").trim() || "INV";
  const year = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
  }).format(now.toDate());
  const invoiceNumber = `${prefix}-${year}-${String(seq).padStart(4, "0")}`;

  const ctx = { fn: "createRecurringPlan", uid, clientId: input.clientId };
  logger.info("starting", ctx);
  try {
    const batch = db.batch();

    // Hidden backing job. clientId stays null (off-platform billing vehicle) —
    // never completes, never feeds reviews (acceptedOffline), filtered out of
    // the board (originType). inviteOriginated makes onJobCreated skip its lead
    // notification.
    batch.set(jobRef, {
      clientId: client.linkedUserId ?? null,
      tradespersonId: uid,
      clientName: client.displayName,
      clientPhotoURL: null,
      tradespersonName: tradieName,
      tradespersonPhotoURL: tradiePhoto,
      status: "in_progress",
      trade: tradie.trades?.[0] ?? "general",
      title: input.label,
      description: `Recurring ${input.frequency} billing for ${client.displayName}.`,
      intakeFormData: {},
      intakePhotos: [],
      address: client.address
        ? { ...client.address, geo: null }
        : { line1: "", city: "", region: "", postalCode: "", geo: null },
      preferredDateWindow: { start: null, end: null },
      urgency: "flexible",
      scheduledStart: null,
      scheduledEnd: null,
      createdAt: FieldValue.serverTimestamp(),
      completedAt: null,
      clientApprovalRequestedAt: null,
      clientApprovedAt: null,
      cancelledAt: null,
      cancelledReason: null,
      cancelledBy: null,
      chatId: chatRef.id,
      sourcePostId: null,
      billingType: "fixed",
      inviteOriginated: true,
      acceptedOffline: true,
      originType: "recurring_plan",
      clientRef: input.clientId,
      recurringPlanId: jobRef.id,
    });

    batch.set(chatRef, {
      jobId: jobRef.id,
      clientId: client.linkedUserId ?? null,
      tradespersonId: uid,
      lastMessageAt: null,
      lastMessagePreview: "",
      unreadCounts: { [uid]: 0 },
    });

    // Template invoice (the first bill + the recurring template). Draft so the
    // tradesperson reviews + sends it; recurring.enabled keeps the engine
    // cloning a fresh draft each period.
    batch.set(invoiceRef, {
      tradespersonId: uid,
      clientId: client.linkedUserId ?? null,
      jobId: jobRef.id,
      invoiceNumber,
      status: "draft",
      lineItems: input.lineItems,
      subtotal: totals.subtotal,
      discount: input.discount,
      discountAmount: totals.discountAmount,
      taxTotal: totals.taxTotal,
      total: totals.total,
      currency: "CAD",
      issuedAt: FieldValue.serverTimestamp(),
      dueAt: null,
      sentAt: null,
      viewedAt: null,
      paidAt: null,
      pdfUrl: null,
      paymentInstructions: tradie.paymentInstructions ?? "",
      paymentMethod: "manual",
      recurring: { enabled: true, frequency: input.frequency, nextRunAt },
      upfrontFeeCredit: null,
    });

    batch.update(tradieRef, { nextInvoiceNumber: seq + 1 });
    batch.set(
      clientRef,
      { activeRecurringPlans: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );

    await batch.commit();
    logger.info("success", { ...ctx, jobId: jobRef.id, invoiceId: invoiceRef.id });
    return { jobId: jobRef.id, invoiceId: invoiceRef.id, total: totals.total };
  } catch (err) {
    logger.error("failed", { ...ctx, err });
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", "Couldn't create the recurring charge.");
  }
});
