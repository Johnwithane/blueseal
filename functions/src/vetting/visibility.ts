import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/admin";
import { notify } from "../lib/notify";

/**
 * Re-checks whether a tradie is eligible to go live (vettingStatus approved
 * + ID verified + at least one approved cert) and flips isVisible if so.
 * Idempotent — safe to call from multiple triggers.
 */
export async function maybeMarkVisible(tradieUid: string): Promise<void> {
  const tradieRef = db.doc(`tradespeople/${tradieUid}`);
  // Flip isVisible inside a transaction so the several callers that all fire on
  // a single approval (approveApplication + the per-doc cert/ID approval
  // triggers) can't each send a "you're live" email. Only the transaction that
  // actually performs the flip returns justWentLive — everyone else no-ops.
  const justWentLive = await db.runTransaction(async (tx) => {
    const snap = await tx.get(tradieRef);
    if (!snap.exists) return false;
    const t = snap.data() as {
      vettingStatus?: string;
      isVisible?: boolean;
      idVerified?: boolean;
      verifiedTrades?: string[];
    };
    const eligible =
      t.vettingStatus === "approved" &&
      t.idVerified === true &&
      (t.verifiedTrades?.length ?? 0) > 0;
    if (!eligible || t.isVisible) return false;
    tx.update(tradieRef, { isVisible: true, approvedAt: FieldValue.serverTimestamp() });
    return true;
  });
  if (!justWentLive) return;

  // The single welcome email lives here — notify() sends ONE branded HTML email
  // (plus the in-app row, web push and WhatsApp). It's owned by this chokepoint
  // so it fires exactly once on the transition to visible, regardless of which
  // trigger got here first. Best-effort: a notify failure must not roll back the
  // already-committed visibility flip. Links to /jobs/browse so a freshly-live
  // tradie lands straight on the marketplace.
  try {
    await notify({
      userId: tradieUid,
      type: "vetting_approved",
      title: "You're approved — welcome to Blue Seal",
      body: "Your profile is now live and visible to clients. Set up payouts at /payouts so you can collect payments, then browse open jobs.",
      link: "/jobs/browse",
      actorUid: null,
      recipientRole: "tradesperson",
      priority: "high",
    });
  } catch {
    /* best-effort; visibility flip already committed */
  }
}
