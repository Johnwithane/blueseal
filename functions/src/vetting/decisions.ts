import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";
import { enqueueMail } from "../lib/mail";
import { notify } from "../lib/notify";
import { maybeMarkVisible } from "./visibility";

const ApproveInput = z.object({ tradieUid: z.string().min(1).max(128) });
const InfoInput = z.object({
  tradieUid: z.string().min(1).max(128),
  notes: z.string().trim().min(1).max(2000),
});
const RejectInput = z.object({
  tradieUid: z.string().min(1).max(128),
  reason: z.string().trim().min(1).max(2000),
});

async function requireTradieExists(tradieUid: string) {
  const snap = await db.doc(`tradespeople/${tradieUid}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "Tradesperson not found.");
}

async function tradieEmail(uid: string): Promise<string | null> {
  const u = await db.doc(`users/${uid}`).get();
  return (u.data() as { email?: string } | undefined)?.email ?? null;
}

export const approveApplication = onCall(CALLABLE_OPTS, async (req) => {
  const actor = requireAdmin(req);
  const parsed = ApproveInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { tradieUid } = parsed.data;
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
  // Whether this call is a real transition into "approved". Re-approving an
  // already-approved tradie (impatient double-tap, or a later re-review) must
  // NOT re-send the welcome email — that was the "20 approval emails" bug.
  const wasAlreadyApproved =
    (tradieSnap.data() as { vettingStatus?: string }).vettingStatus === "approved";
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
  await maybeMarkVisible(tradieUid);
  // Only on the transition into approved — re-approving doesn't re-notify.
  if (!wasAlreadyApproved) {
    await notify({
      userId: tradieUid,
      type: "vetting_approved",
      title: "You're approved — welcome to Blue Seal",
      body: "Your profile is live and discoverable. Start receiving job requests today.",
      link: "/dashboard/tradie",
      recipientRole: "tradesperson",
      priority: "high",
    });
  }
  await logAdminAction({
    actorUid: actor,
    action: "approveApplication",
    targetType: "tradesperson",
    targetId: tradieUid,
  });
  return { ok: true };
});

export const requestApplicationInfo = onCall(CALLABLE_OPTS, async (req) => {
  const actor = requireAdmin(req);
  const parsed = InfoInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { tradieUid, notes } = parsed.data;
  await requireTradieExists(tradieUid);

  await db.doc(`tradespeople/${tradieUid}`).update({
    vettingStatus: "info_requested",
    vettingNotes: notes,
  });
  const email = await tradieEmail(tradieUid);
  if (email) {
    await enqueueMail({
      to: email,
      subject: "Blue Seal: more info needed for your application",
      text: notes,
    });
  }
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
  });
  return { ok: true };
});

export const rejectApplication = onCall(CALLABLE_OPTS, async (req) => {
  const actor = requireAdmin(req);
  const parsed = RejectInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { tradieUid, reason } = parsed.data;
  await requireTradieExists(tradieUid);

  await db.doc(`tradespeople/${tradieUid}`).update({
    vettingStatus: "rejected",
    vettingNotes: reason,
    isVisible: false,
    rejectedAt: FieldValue.serverTimestamp(),
  });
  const email = await tradieEmail(tradieUid);
  if (email) {
    await enqueueMail({
      to: email,
      subject: "Blue Seal: application rejected",
      text: reason,
    });
  }
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
  });
  return { ok: true };
});
