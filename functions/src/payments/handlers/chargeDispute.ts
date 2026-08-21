// `charge.dispute.created` and `charge.dispute.closed` webhook handlers.
//
// Dispute lifecycle in Stripe:
//   created  → status one of {warning_needs_response, warning_under_review,
//              needs_response, under_review}
//   updated  → same statuses, evidence_details refreshed
//   closed   → status one of {warning_closed, won, lost}; outcome decided
//
// We write `/disputes/{dp_…}` on `created` and update it (with `outcome`)
// on `closed`. The `payment.disputeId` + `payment.disputeStatus` mirror
// on the invoice gives the existing invoice rules + UI a single field to
// read; the full dispute record lives in /disputes for the admin queue
// and party-visible detail views.
//
// TWO THINGS HAPPEN ON `created` BEYOND RECORD-KEEPING:
//   1. Fund recovery (disputeRecovery.ts) — we reverse the tradesperson's
//      transfer so the disputed money sits on the platform balance instead of
//      Blue Seal absorbing a loss that ToS § 8.4 puts on the tradesperson.
//      Reversed on `won`, kept on `lost`.
//   2. Evidence staging (disputeEvidence.ts) — we assemble the job's signed
//      quote, chat, photos and completion record into Stripe's evidence fields
//      as a DRAFT. An admin reviews and submits; we never auto-submit, because
//      submission is one-shot and closes the window to add anything better.
//
// Idempotency: per-dispute `lastWebhookEventId` short-circuits replays.
// The global webhookEvents sentinel is the first line; this is belt +
// suspenders for retries that change the event id (rare but documented).

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

import { db } from "../../lib/admin";
import { logAdminAction } from "../../lib/audit";
import { notify, notifyMany } from "../../lib/notify";
import { reverseCommission } from "../../lib/commissionAccrual";
import { reversePmServiceFee } from "../../lib/pmCommission";
import { getStripe } from "../stripeClient";
import { reverseTransferForDispute, restoreTransferForDispute } from "../disputeRecovery";
import { stageDisputeEvidence } from "../disputeEvidence";
import type { StripeDispute } from "./shared";

function chargeId(d: StripeDispute): string {
  return typeof d.charge === "string" ? d.charge : d.charge.id;
}

function paymentIntentId(d: StripeDispute): string | null {
  if (!d.payment_intent) return null;
  return typeof d.payment_intent === "string"
    ? d.payment_intent
    : d.payment_intent.id;
}

async function listAdminUids(): Promise<string[]> {
  // Admins are sparse (a handful at most) and dispute events are rare, so
  // the query cost is fine. Caching across function invocations would be
  // wrong — a new admin added during the day should hear about the next
  // dispute immediately.
  const snap = await db
    .collection("users")
    .where("roles", "array-contains", "admin")
    .get();
  return snap.docs.map((d) => d.id);
}

async function findInvoiceForCharge(
  cid: string,
): Promise<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> } | null> {
  const q = await db
    .collection("invoices")
    .where("payment.chargeId", "==", cid)
    .limit(1)
    .get();
  if (q.empty) return null;
  return { ref: q.docs[0].ref, data: q.docs[0].data() };
}

export async function handleChargeDisputeCreated(
  dispute: StripeDispute,
  eventId: string,
): Promise<void> {
  const cid = chargeId(dispute);
  const piId = paymentIntentId(dispute);
  const disputeRef = db.doc(`disputes/${dispute.id}`);

  // Resolve invoice context for the dispute doc + notifications. If the
  // charge has no matching invoice (data drift, manual Stripe charges) we
  // still create the dispute doc — admins need to see it. We just leave
  // the invoice/parties fields nullish-on-best-effort.
  const inv = await findInvoiceForCharge(cid);
  const invData = inv?.data ?? {};

  const evidenceDueBy = dispute.evidence_details?.due_by
    ? Timestamp.fromMillis(dispute.evidence_details.due_by * 1000)
    : null;

  // Atomic create-or-update: a second delivery of `dispute.created` (rare
  // but possible) shouldn't double-write. Use the sentinel field to
  // short-circuit.
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(disputeRef);
    if (snap.exists) {
      const existing = snap.data() as { lastWebhookEventId?: string };
      if (existing.lastWebhookEventId === eventId) return;
    }
    tx.set(
      disputeRef,
      {
        invoiceId: inv?.ref.id ?? null,
        jobId: (invData.jobId as string) ?? null,
        tradespersonId: (invData.tradespersonId as string) ?? null,
        clientId: (invData.clientId as string) ?? null,
        chargeId: cid,
        paymentIntentId: piId,
        amount: dispute.amount,
        currency: dispute.currency.toUpperCase(),
        reason: dispute.reason,
        status: dispute.status,
        outcome: null,
        evidenceDueBy,
        createdAt: snap.exists ? snap.get("createdAt") : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastWebhookEventId: eventId,
      },
      { merge: true },
    );
  });

  // Mirror onto the invoice's payment field and flip status to `disputed`.
  // Skip if no matching invoice (we already logged it above implicitly).
  if (inv) {
    await inv.ref.set(
      {
        status: "disputed",
        payment: {
          disputeId: dispute.id,
          disputeStatus: dispute.status,
        },
      },
      { merge: true },
    );
  }

  // ── Fund recovery (ToS § 8.4) ────────────────────────────────────────────
  // Claw the tradesperson's transfer back to the platform balance while the
  // dispute is decided. Guarded: a recovery failure is a debt to chase, and
  // must never stop the dispute from being recorded and surfaced to admins.
  const stripe = getStripe();
  const recovery = await reverseTransferForDispute(stripe, {
    disputeId: dispute.id,
    chargeId: cid,
    disputeAmountCents: dispute.amount,
  });
  await disputeRef.set(
    {
      recovery: {
        status: recovery.status,
        transferId: recovery.transferId,
        reversalId: recovery.reversalId,
        reversedCents: recovery.reversedCents,
        destinationAccountId: recovery.destinationAccountId,
        restoreTransferId: null,
        restoredCents: 0,
        failureMessage: recovery.failureMessage,
        updatedAt: FieldValue.serverTimestamp(),
      },
    },
    { merge: true },
  );

  // ── Evidence staging ─────────────────────────────────────────────────────
  // Draft only — an admin reviews and submits from the dispute detail view.
  try {
    await stageDisputeEvidence(stripe, { disputeId: dispute.id, submit: false });
  } catch (err) {
    logger.error("dispute_created: evidence staging failed", {
      disputeId: dispute.id,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Audit log — disputes are the highest-impact thing that can happen
  // post-payment; we want a permanent record.
  await logAdminAction({
    actorUid: "stripe-webhook",
    action: "dispute_created",
    targetType: "invoice",
    targetId: inv?.ref.id ?? dispute.id,
    metadata: {
      disputeId: dispute.id,
      chargeId: cid,
      reason: dispute.reason,
      status: dispute.status,
      amount: dispute.amount,
      currency: dispute.currency,
      recoveryStatus: recovery.status,
      recoveredCents: recovery.reversedCents,
    },
  });

  // Notify admins (action-required) + the tradesperson (heads-up).
  // Client gets no notification — they initiated the dispute via their
  // bank, they know what happened and chasing them about it is the wrong
  // move while it's under review.
  try {
    const adminUids = await listAdminUids();
    if (adminUids.length > 0) {
      // Lead with the recovery result: a FAILED reversal is the one that needs
      // a human today (the funds already left, so it's a debt to chase), and
      // burying that under generic dispute copy is how it gets missed.
      const recoveryLine =
        recovery.status === "reversed"
          ? `Held back ${dispute.currency.toUpperCase()} ${(recovery.reversedCents / 100).toFixed(2)} from the tradesperson's payout.`
          : recovery.status === "failed"
            ? `⚠ Could not hold back the tradesperson's payout — this is a recoverable debt, not an automatic loss.`
            : `No transfer to hold back on this charge.`;
      await notifyMany(adminUids, {
        type: "dispute_opened",
        title: `Dispute opened on ${dispute.currency.toUpperCase()} ${(dispute.amount / 100).toFixed(2)}`,
        body: `Reason: ${dispute.reason.replace(/_/g, " ")}. ${recoveryLine} Evidence has been drafted — review and submit it from the disputes queue.`,
        link: `/admin/disputes/${dispute.id}`,
        actorUid: null,
        recipientRole: "admin",
        priority: "high",
      });
    } else {
      logger.warn("dispute_created: no admins to notify", {
        disputeId: dispute.id,
      });
    }
  } catch (err) {
    logger.error("dispute_created: admin notify failed", {
      disputeId: dispute.id,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  if (invData.tradespersonId) {
    // The old copy said "no action needed from you". That was never true and
    // now contradicts the Terms (§ 8.2): the tradesperson owes cooperation on
    // evidence, and the disputed amount is held back from them meanwhile.
    // Telling them otherwise loses winnable disputes and blindsides them when
    // the payout is short.
    await notify({
      userId: invData.tradespersonId as string,
      type: "dispute_opened",
      title: `Action needed: a payment is being disputed`,
      body: `Invoice ${(invData.invoiceNumber as string) ?? ""} is under dispute (reason: ${dispute.reason.replace(/_/g, " ")}). The disputed amount is held back from your payout until the bank decides. We've drafted a response from your job records — send us anything else that proves the work (photos, messages, sign-off) as soon as you can.`,
      link: invData.jobId ? `/jobs/${invData.jobId}` : null,
      actorUid: null,
      recipientRole: "tradesperson",
      priority: "high",
    });
  }
}

export async function handleChargeDisputeClosed(
  dispute: StripeDispute,
  eventId: string,
): Promise<void> {
  const cid = chargeId(dispute);
  const disputeRef = db.doc(`disputes/${dispute.id}`);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(disputeRef);
    if (snap.exists) {
      const existing = snap.data() as { lastWebhookEventId?: string };
      if (existing.lastWebhookEventId === eventId) return;
    }
    tx.set(
      disputeRef,
      {
        // Stripe's `status` on a closed dispute IS the outcome (won / lost /
        // warning_closed); duplicate into `outcome` so the UI can branch
        // cleanly without status-string parsing.
        status: dispute.status,
        outcome: dispute.status,
        updatedAt: FieldValue.serverTimestamp(),
        lastWebhookEventId: eventId,
      },
      { merge: true },
    );
  });

  // ── Give the money back on a WON dispute ─────────────────────────────────
  // We clawed the tradesperson's transfer back when the dispute opened; a win
  // means those funds are ours to return, so re-transfer them. On a LOSS the
  // clawback stands — that is the tradesperson absorbing it (ToS § 8.2) — and
  // there is nothing further to do here.
  const won = dispute.status === "won" || dispute.status === "warning_closed";
  if (won) {
    const dSnap = await disputeRef.get();
    const rec = (dSnap.data()?.recovery ?? {}) as {
      status?: string;
      reversedCents?: number;
      restoredCents?: number;
      destinationAccountId?: string | null;
    };
    const owed = (rec.reversedCents ?? 0) - (rec.restoredCents ?? 0);
    if (rec.status === "reversed" && owed > 0) {
      const acct = rec.destinationAccountId ?? null;
      if (acct) {
        const restore = await restoreTransferForDispute(getStripe(), {
          disputeId: dispute.id,
          destinationAccountId: acct,
          amountCents: owed,
          currency: dispute.currency,
        });
        await disputeRef.set(
          {
            recovery: {
              status: restore.status === "restored" ? "restored" : rec.status,
              restoreTransferId: restore.transferId,
              restoredCents: (rec.restoredCents ?? 0) + restore.restoredCents,
              failureMessage: restore.failureMessage,
              updatedAt: FieldValue.serverTimestamp(),
            },
          },
          { merge: true },
        );
      } else {
        logger.error("disputeClosed: won but no destination account to restore to", {
          disputeId: dispute.id,
          owed,
        });
      }
    }
  }

  // Mirror back onto the invoice. Status: lost → stay `disputed` (the
  // money has actually left); won → restore to `paid` (funds returned);
  // warning_closed (inquiry closed without becoming a real dispute) →
  // restore to `paid`.
  const inv = await findInvoiceForCharge(cid);
  if (inv) {
    const invoiceStatus =
      dispute.status === "lost" ? "disputed" : "paid";
    await inv.ref.set(
      {
        status: invoiceStatus,
        payment: { disputeStatus: dispute.status },
      },
      { merge: true },
    );

    // A LOST dispute means the bank clawed back the funds — including the
    // application fee Blue Seal kept — so reverse the rep's commission on that
    // service-fee revenue. won / warning_closed leave the money with us → no
    // reversal. Shares the deterministic reversal id with the refund path, so a
    // refund-then-dispute (or replay) can only ever produce one reversal entry.
    if (dispute.status === "lost") {
      try {
        await reverseCommission({ source: "service_fee", sourceRef: inv.ref.id });
      } catch (err) {
        logger.error("disputeClosed: commission reversal failed", {
          invoiceId: inv.ref.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      // Mirror for the PM commission (P4) when the job was PM-driven. No-ops otherwise.
      // A lost dispute is a full clawback (proportion defaults to 1).
      try {
        const invSnap = await inv.ref.get();
        const jobId = (invSnap.data()?.jobId as string | undefined) ?? inv.ref.id;
        await reversePmServiceFee({ jobId, sourceRef: inv.ref.id });
      } catch (err) {
        logger.error("disputeClosed: PM commission reversal failed", {
          invoiceId: inv.ref.id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  await logAdminAction({
    actorUid: "stripe-webhook",
    action: "dispute_closed",
    targetType: "invoice",
    targetId: inv?.ref.id ?? dispute.id,
    metadata: {
      disputeId: dispute.id,
      chargeId: cid,
      outcome: dispute.status,
    },
  });
}
