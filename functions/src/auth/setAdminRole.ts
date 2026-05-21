import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { adminAuth, db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";

const Input = z.object({ targetUid: z.string().min(1).max(128) });

export const setAdminRole = onCall({ enforceAppCheck: false }, async (req) => {
  const actor = requireAdmin(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
  const { targetUid } = parsed.data;

  // Refuse to mint a claim for a UID that doesn't exist as an Auth user.
  let current;
  try {
    current = await adminAuth.getUser(targetUid);
  } catch {
    throw new HttpsError("not-found", "Target user does not exist.");
  }

  // Merge with existing claims so we don't drop other claims (tenant, region, etc.).
  const mergedClaims = { ...(current.customClaims ?? {}), role: "admin" };

  // Firestore first, then claim. If the claim write fails after the doc write,
  // re-running this callable is idempotent. The reverse would leave a claim
  // without a doc, which is worse.
  await db.doc(`users/${targetUid}`).set({ role: "admin" }, { merge: true });
  try {
    await adminAuth.setCustomUserClaims(targetUid, mergedClaims);
  } catch (err) {
    logger.error("setCustomUserClaims failed; rolling back doc write", { targetUid, err });
    await db.doc(`users/${targetUid}`).set({ role: current.customClaims?.role ?? null }, { merge: true });
    throw new HttpsError("internal", "Failed to set role; please retry.");
  }

  await logAdminAction({
    actorUid: actor,
    action: "setAdminRole",
    targetType: "user",
    targetId: targetUid,
  });
  return { ok: true };
});
