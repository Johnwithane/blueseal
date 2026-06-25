import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { requireRepActive } from "../lib/salesRep";
import { assertRepOwnsTradie } from "../lib/vettingActor";

const Input = z.object({ tradieUid: z.string().min(1).max(128) });

/**
 * A rep's owned application with its certifications + ID doc, so the rep can
 * review it before approving. Reps can't read these via Firestore rules (pending
 * tradesperson docs + cert/ID docs are admin/owner-only), so this Admin-SDK call
 * gates on ownership and returns the docs. Admin uses the existing admin views.
 */
export const getApplicationDetails = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "sales");
  await requireRepActive(uid);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
  const { tradieUid } = parsed.data;
  await assertRepOwnsTradie(uid, tradieUid);

  const [tradieSnap, idSnap, certsSnap] = await Promise.all([
    db.doc(`tradespeople/${tradieUid}`).get(),
    db.doc(`idVerifications/${tradieUid}`).get(),
    db.collection("certifications").where("tradespersonId", "==", tradieUid).get(),
  ]);
  return {
    tradie: tradieSnap.exists ? { id: tradieSnap.id, ...tradieSnap.data() } : null,
    idVerification: idSnap.exists ? { id: idSnap.id, ...idSnap.data() } : null,
    certifications: certsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
});
