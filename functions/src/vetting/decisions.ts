import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/admin";
import { logAdminAction } from "../lib/audit";
import { notify } from "../lib/notify";
import { maybeMarkVisible } from "./visibility";
import { requireVettingActor, assertRepOwnsTradie } from "../lib/vettingActor";

const ApproveInput = z.object({ tradieUid: z.string().min(1).max(128) });
const InfoInput = z.object({
  tradieUid: z.string().min(1).max(128),
  notes: z.string().trim().min(1).max(2000),
});
const RejectInput = z.object({
  tradieUid: z.string().min(1).max(128),
  reason: z.string().trim().min(1).max(2000),
});

/** Load the tradie's current vetting state (throws if the doc is missing). */
async function getTradieVetting(
  tradieUid: string,
): Promise<{ vettingStatus?: string; vettingNotes?: string }> {
  const snap = await db.doc(`tradespeople/${tradieUid}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Tradesperson not found.");
  return snap.data() as { vettingStatus?: string; vettingNotes?: string };
}

export const approveApplication = onCall(CALLABLE_OPTS, async (req) => {
  const { uid: actor, role: actorRole } = await requireVettingActor(req);
  const parsed = ApproveInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { tradieUid } = parsed.data;
  // A rep may only act on tradies they own (referral or region); admin: any.
  if (actorRole === "sales") await assertRepOwnsTradie(actor, tradieUid);
  // Single-click "approve everything": flips every PENDING cert + the pending
  // ID to approved, marks the application approved, and writes the
  // denormalized idVerified/verifiedTrades on the tradie doc so isVisible
  // flips immediately (without waiting for the per-doc triggers to fire).
  // Already-rejected items are NOT un-rejected — admin must explicitly
  // un-reject if they changed their mind.
  const tradieRef = db.doc(`tradespeople/${tradieUid}`);
  const idRef = db.doc(`idVerifications/${tradieUid}`);
  const [tradieSnap, idSnap, certsSnap] = await Promise.all([
    tradieRef.get(),
    idRef.get(),
    db.collection("certifications").where("tradespersonId", "==", tradieUid).get(),
  ]);
  if (!tradieSnap.exists) throw new HttpsError("not-found", "Tradesperson not found.");
  if (!idSnap.exists) {
    throw new HttpsError("failed-precondition", "No ID document on file.");
  }
  if (certsSnap.empty) {
    throw new HttpsError("failed-precondition", "No certifications on file.");
  }

  const idStatus = (idSnap.data() as { status?: string }).status;
  if (idStatus === "rejected") {
    throw new HttpsError(
      "failed-precondition",
      "ID has been rejected — un-reject it before approving.",
    );
  }

  // Collect every cert that's pending or already approved — these are the
  // trades the user will be verified for. Rejected certs are excluded.
  const certsToApprove: FirebaseFirestore.DocumentSnapshot[] = [];
  const verifiedTrades = new Set<string>();
  for (const certDoc of certsSnap.docs) {
    const c = certDoc.data() as { status?: string; trade?: string };
    if (!c.trade) continue;
    if (c.status === "pending") {
      certsToApprove.push(certDoc);
      verifiedTrades.add(c.trade);
    } else if (c.status === "approved") {
      verifiedTrades.add(c.trade);
    }
  }
  if (verifiedTrades.size === 0) {
    throw new HttpsError(
      "failed-precondition",
      "Every certification on file is rejected — un-reject at least one before approving.",
    );
  }

  const now = FieldValue.serverTimestamp();

  // Flip pending certs to approved. Batch so partial-failure can't leave
  // half-approved state.
  if (certsToApprove.length > 0) {
    const batch = db.batch();
    for (const certDoc of certsToApprove) {
      batch.update(certDoc.ref, {
        status: "approved",
        reviewedBy: actor,
        reviewedAt: now,
        rejectionReason: null,
      });
    }
    await batch.commit();
  }

  // Flip ID to approved if it's still pending.
  if (idStatus === "pending") {
    await idRef.update({
      status: "approved",
      reviewedBy: actor,
      reviewedAt: now,
      rejectionReason: null,
    });
  }

  // Tradie doc: write the denormalized verified state directly so isVisible
  // can flip on the next line without waiting for the per-doc triggers.
  // The triggers will still fire and idempotently re-apply these writes.
  await tradieRef.update({
    vettingStatus: "approved",
    vettingNotes: "",
    idVerified: true,
    verifiedTrades: FieldValue.arrayUnion(...Array.from(verifiedTrades)),
  });
  // maybeMarkVisible owns the single "you're live" welcome email — it fires
  // exactly once, transactionally, when the profile actually transitions to
  // visible (it's also reached via the per-doc cert/ID approval triggers).
  // Sending a second "approved" email from here is what produced the duplicate
  // welcome emails, on top of the impatient-double-tap multiplier.
  await maybeMarkVisible(tradieUid);
  await logAdminAction({
    actorUid: actor,
    action: "approveApplication",
    targetType: "tradesperson",
    targetId: tradieUid,
    metadata: { actorRole },
  });
  return { ok: true };
});

export const requestApplicationInfo = onCall(CALLABLE_OPTS, async (req) => {
  const { uid: actor, role: actorRole } = await requireVettingActor(req);
  const parsed = InfoInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { tradieUid, notes } = parsed.data;
  if (actorRole === "sales") await assertRepOwnsTradie(actor, tradieUid);
  const current = await getTradieVetting(tradieUid);

  // Idempotent: re-issuing the SAME request (already info_requested with these
  // exact notes) is a no-op, so an impatient double-tap can't email the tradie
  // twice. A genuine follow-up with different notes still goes through.
  if (current.vettingStatus === "info_requested" && (current.vettingNotes ?? "") === notes) {
    return { ok: true };
  }

  await db.doc(`tradespeople/${tradieUid}`).update({
    vettingStatus: "info_requested",
    vettingNotes: notes,
  });
  // notify() sends ONE branded HTML email (plus the in-app row) — the bare
  // plain-text enqueueMail that used to run alongside it was the duplicate
  // "plain-text + HTML" email.
  await notify({
    userId: tradieUid,
    type: "vetting_info_requested",
    title: "We need a bit more info",
    body: notes,
    link: "/onboarding",
    recipientRole: "tradesperson",
  });
  await logAdminAction({
    actorUid: actor,
    action: "requestApplicationInfo",
    targetType: "tradesperson",
    targetId: tradieUid,
    reason: notes,
    metadata: { actorRole },
  });
  return { ok: true };
});

export const rejectApplication = onCall(CALLABLE_OPTS, async (req) => {
  const { uid: actor, role: actorRole } = await requireVettingActor(req);
  const parsed = RejectInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { tradieUid, reason } = parsed.data;
  if (actorRole === "sales") await assertRepOwnsTradie(actor, tradieUid);
  const current = await getTradieVetting(tradieUid);

  // Idempotent: re-rejecting with the SAME reason is a no-op so a double-tap
  // can't email the tradie twice. Re-rejecting with a different reason still
  // sends (admin changed their mind on the wording).
  if (current.vettingStatus === "rejected" && (current.vettingNotes ?? "") === reason) {
    return { ok: true };
  }

  await db.doc(`tradespeople/${tradieUid}`).update({
    vettingStatus: "rejected",
    vettingNotes: reason,
    isVisible: false,
    rejectedAt: FieldValue.serverTimestamp(),
  });
  // notify() sends ONE branded HTML email (plus the in-app row) — the bare
  // plain-text enqueueMail that used to run alongside it was the duplicate
  // "plain-text + HTML" email.
  await notify({
    userId: tradieUid,
    type: "vetting_rejected",
    title: "Application not approved",
    body: reason,
    link: "/dashboard/tradie",
    recipientRole: "tradesperson",
  });
  await logAdminAction({
    actorUid: actor,
    action: "rejectApplication",
    targetType: "tradesperson",
    targetId: tradieUid,
    reason,
    metadata: { actorRole },
  });
  return { ok: true };
});
