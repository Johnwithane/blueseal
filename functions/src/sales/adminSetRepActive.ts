// Admin-only: activate / deactivate a sales rep. A deactivated rep's referral
// code stops attributing new signups and their owned tradespeople fall back to
// the region's rep for commission (resolveCommissionOwner checks salesRep.active
// !== false). Doesn't touch the role claim or existing accrued commissions —
// just flips the ownership/earning switch. Audited.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";

const Input = z.object({
  repId: z.string().trim().min(1).max(128),
  active: z.boolean(),
});

export const adminSetRepActive = onCall(CALLABLE_OPTS, async (req) => {
  const actor = requireAdmin(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input.");
  const { repId, active } = parsed.data;

  const ref = db.doc(`users/${repId}`);
  const snap = await ref.get();
  if (!snap.exists || !snap.data()?.salesRep) {
    throw new HttpsError("not-found", "That user is not a sales rep.");
  }

  await ref.set({ salesRep: { active } }, { merge: true });
  await logAdminAction({
    actorUid: actor,
    action: active ? "activateRep" : "deactivateRep",
    targetType: "user",
    targetId: repId,
    metadata: {},
  });
  logger.info("adminSetRepActive", { actor, repId, active });
  return { ok: true };
});
