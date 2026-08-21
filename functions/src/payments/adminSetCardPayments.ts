// Admin kill switch for a single tradesperson's card payments.
//
// This is the button behind the right reserved in ToS § 7.7 — "we may decline a
// payment, or suspend or withdraw your access to in-app payments … to manage
// fraud, chargeback, or credit risk on the platform". Without it, the only
// lever for a tradesperson who is generating disputes was suspending their
// whole account, which also stops legitimate work in flight.
//
// Deliberately narrow: pausing blocks NEW card payments (assertTradieChargeable
// rejects them) and nothing else. The tradesperson keeps their account, their
// jobs, their chat, and the fee-free offline payment path — clients are told
// only that card payment is unavailable and to pay by e-transfer or cash.
//
// Not reversible by the tradesperson: `payments` is server-only in
// firestore.rules, so this callable and admins are the only writers.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";

const Input = z.object({
  tradespersonId: z.string().min(1).max(128),
  paused: z.boolean(),
  reason: z.string().max(500).optional(),
});

export const adminSetCardPayments = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAdmin(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
  const { tradespersonId, paused, reason } = parsed.data;

  const ref = db.doc(`tradespeople/${tradespersonId}`);
  if (!(await ref.get()).exists) {
    throw new HttpsError("not-found", "Tradesperson not found.");
  }

  await ref.set(
    {
      payments: {
        cardPaymentsPausedAt: paused ? FieldValue.serverTimestamp() : null,
        cardPaymentsPausedReason: paused ? (reason ?? null) : null,
        cardPaymentsPausedBy: paused ? uid : null,
      },
    },
    { merge: true },
  );

  await logAdminAction({
    actorUid: uid,
    action: paused ? "card_payments_paused" : "card_payments_resumed",
    targetType: "tradesperson",
    targetId: tradespersonId,
    reason: reason ?? null,
    metadata: { paused },
  });

  logger.info("adminSetCardPayments", { uid, tradespersonId, paused });
  return { ok: true, paused };
});
