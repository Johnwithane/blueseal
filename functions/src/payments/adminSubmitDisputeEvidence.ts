// Admin control over the dispute evidence the webhook staged.
//
// The webhook drafts evidence from the job record the moment a dispute opens
// (disputeEvidence.ts), but never submits: Stripe accepts exactly one
// submission per dispute, and submitting closes the door on anything better
// the tradesperson might still send. So an admin decides.
//
//   restage  — rebuild the draft from the job's CURRENT records. Use after the
//              tradesperson adds photos or messages that strengthen the case.
//   submit   — one-shot, final. Stripe locks the evidence after this.
//
// Both paths write an audit entry: submitting evidence is the moment Blue Seal
// commits to a position on someone else's money.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";
import { stageDisputeEvidence } from "./disputeEvidence";
import { STRIPE_SECRET_KEY, getStripe } from "./stripeClient";
import { stripeFailure } from "./connectErrors";

const Input = z.object({
  disputeId: z.string().min(1).max(128),
  submit: z.boolean().default(false),
});

export const adminSubmitDisputeEvidence = onCall(
  { ...CALLABLE_OPTS, secrets: [STRIPE_SECRET_KEY] },
  async (req) => {
    const uid = requireAdmin(req);
    const parsed = Input.safeParse(req.data);
    if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
    const { disputeId, submit } = parsed.data;
    const ctx = { fn: "adminSubmitDisputeEvidence", uid, disputeId };

    const snap = await db.doc(`disputes/${disputeId}`).get();
    if (!snap.exists) throw new HttpsError("not-found", "Dispute not found.");
    if (snap.data()?.outcome) {
      throw new HttpsError(
        "failed-precondition",
        "This dispute is already closed — evidence can no longer be changed.",
      );
    }

    logger.info("adminSubmitDisputeEvidence: starting", { ...ctx, submit });
    let result: { staged: boolean; submitted: boolean };
    try {
      result = await stageDisputeEvidence(getStripe(), { disputeId, submit });
    } catch (err) {
      throw stripeFailure(err, ctx);
    }
    if (!result.staged) {
      throw new HttpsError("failed-precondition", "Couldn't assemble evidence for this dispute.");
    }

    await logAdminAction({
      actorUid: uid,
      action: submit ? "dispute_evidence_submitted" : "dispute_evidence_restaged",
      targetType: "dispute",
      targetId: disputeId,
      metadata: { disputeId, submitted: submit },
    });

    logger.info("adminSubmitDisputeEvidence: done", { ...ctx, submitted: result.submitted });
    return { ok: true, submitted: result.submitted };
  },
);
