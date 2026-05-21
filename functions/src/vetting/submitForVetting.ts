import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/admin";
import { requireAuth } from "../lib/auth";

export const submitForVetting = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = requireAuth(req);
  const tradieRef = db.doc(`tradespeople/${uid}`);
  const idRef = db.doc(`idVerifications/${uid}`);
  const certsSnap = await db
    .collection("certifications")
    .where("tradespersonId", "==", uid)
    .get();
  const [tradieSnap, idSnap] = await Promise.all([tradieRef.get(), idRef.get()]);
  if (!tradieSnap.exists) throw new HttpsError("failed-precondition", "Profile not started.");
  if (!idSnap.exists) throw new HttpsError("failed-precondition", "ID not uploaded.");

  const tradie = tradieSnap.data() as { trades?: string[] };
  const requiredTrades = new Set(tradie.trades ?? []);
  const certTrades = new Set(certsSnap.docs.map((d) => (d.data() as { trade: string }).trade));
  for (const t of requiredTrades) {
    if (!certTrades.has(t)) {
      throw new HttpsError("failed-precondition", `Missing certification for ${t}.`);
    }
  }

  await tradieRef.update({
    vettingStatus: "pending",
    submittedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});
