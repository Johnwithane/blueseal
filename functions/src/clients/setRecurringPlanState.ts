// Pause or resume a client's recurring charge (Blue Seal Pro). Flips the
// template invoice's recurring.enabled (the engine drafts nothing while paused
// but the plan is preserved) and keeps the client's activeRecurringPlans
// counter in lockstep — both in one transaction so the badge never drifts.
// The template invoice lives at invoices/{planJobId} (deterministic id ==
// backing job id), so the plan is addressable by its job id.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { assertPro } from "../lib/subscription";

const Input = z.object({
  planJobId: z.string().min(1).max(128),
  enabled: z.boolean(),
});

export const setRecurringPlanState = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  await assertPro(uid);

  const parsed = Input.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { planJobId, enabled } = parsed.data;

  const invoiceRef = db.doc(`invoices/${planJobId}`);
  const jobRef = db.doc(`jobs/${planJobId}`);

  await db.runTransaction(async (tx) => {
    const [invSnap, jobSnap] = await Promise.all([tx.get(invoiceRef), tx.get(jobRef)]);
    if (!invSnap.exists) throw new HttpsError("not-found", "Recurring plan not found.");
    const inv = invSnap.data() as {
      tradespersonId: string;
      recurring?: { enabled?: boolean; frequency?: string; nextRunAt?: unknown } | null;
    };
    if (inv.tradespersonId !== uid) throw new HttpsError("permission-denied", "Not your plan.");
    if (!inv.recurring) {
      throw new HttpsError("failed-precondition", "This invoice isn't a recurring plan.");
    }
    const wasEnabled = inv.recurring.enabled === true;
    if (wasEnabled === enabled) return; // no-op — counter stays correct

    tx.update(invoiceRef, { "recurring.enabled": enabled });

    // Keep the client badge accurate. clientRef lives on the backing job.
    const clientRef = (jobSnap.data() as { clientRef?: string | null } | undefined)?.clientRef;
    if (clientRef) {
      tx.set(
        db.doc(`clients/${clientRef}`),
        {
          activeRecurringPlans: FieldValue.increment(enabled ? 1 : -1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
  });

  return { ok: true, enabled };
});
