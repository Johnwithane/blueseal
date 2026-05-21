import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { adminAuth, db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";

const Input = z.object({ targetUid: z.string().min(1) });

export const setAdminRole = onCall({ enforceAppCheck: false }, async (req) => {
  const actor = requireAdmin(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { targetUid } = parsed.data;

  await adminAuth.setCustomUserClaims(targetUid, { role: "admin" });
  await db.doc(`users/${targetUid}`).set({ role: "admin" }, { merge: true });
  await logAdminAction({ actorUid: actor, action: "setAdminRole", targetType: "user", targetId: targetUid });
  return { ok: true };
});
