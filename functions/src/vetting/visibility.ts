import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/admin";
import { enqueueMail } from "../lib/mail";
import { notify } from "../lib/notify";

/**
 * Re-checks whether a tradie is eligible to go live (vettingStatus approved
 * + ID verified + at least one approved cert) and flips isVisible if so.
 * Idempotent — safe to call from multiple triggers.
 */
export async function maybeMarkVisible(tradieUid: string): Promise<void> {
  const tradieRef = db.doc(`tradespeople/${tradieUid}`);
  const tradieSnap = await tradieRef.get();
  if (!tradieSnap.exists) return;
  const t = tradieSnap.data() as {
    vettingStatus?: string;
    isVisible?: boolean;
    idVerified?: boolean;
    verifiedTrades?: string[];
  };
  const eligible =
    t.vettingStatus === "approved" &&
    t.idVerified === true &&
    (t.verifiedTrades?.length ?? 0) > 0;
  if (!eligible || t.isVisible) return;

  await tradieRef.update({
    isVisible: true,
    approvedAt: FieldValue.serverTimestamp(),
  });

  const userSnap = await db.doc(`users/${tradieUid}`).get();
  const email = (userSnap.data() as { email?: string } | undefined)?.email;
  if (email) {
    await enqueueMail({
      to: email,
      subject: "You're live on Blue Seal",
      text: "Your profile has been approved and is visible to clients. Welcome aboard!",
    });
  }

  // In-app notification — the email is the "official" announcement but
  // the inbox is what the tradie checks every time they open the app.
  // Best-effort so a notify failure doesn't roll back the visibility
  // flip. Links to /jobs/browse so a freshly-live tradie can land
  // straight on the marketplace and start applying for work.
  try {
    await notify({
      userId: tradieUid,
      type: "vetting_approved",
      title: "You're live on Blue Seal",
      body: "Your profile is now visible to clients. Set up payouts at /payouts so you can collect payments, then browse open jobs.",
      link: "/jobs/browse",
      actorUid: null,
      priority: "high",
    });
  } catch {
    /* best-effort; visibility flip already committed */
  }
}
