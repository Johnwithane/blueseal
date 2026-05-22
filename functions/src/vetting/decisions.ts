import { onCall, HttpsError } from "firebase-functions/v2/https";
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

export const approveApplication = onCall({ enforceAppCheck: false }, async (req) => {
  const actor = requireAdmin(req);
  const parsed = ApproveInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { tradieUid } = parsed.data;
  // Eligibility precheck: an approved application without approved ID + at
  // least one approved cert lands the tradesperson in a half-state where
  // isVisible never flips and submitForVetting refuses to re-submit. Block
  // approval until those are done so they only get the "you're live" email
  // when they're actually live.
  const [tradieSnap, idSnap, certsSnap] = await Promise.all([
    db.doc(`tradespeople/${tradieUid}`).get(),
    db.doc(`idVerifications/${tradieUid}`).get(),
    db.collection("certifications").where("tradespersonId", "==", tradieUid).get(),
  ]);
  if (!tradieSnap.exists) throw new HttpsError("not-found", "Tradesperson not found.");
  const idStatus = (idSnap.data() as { status?: string } | undefined)?.status;
  if (idStatus !== "approved") {
    throw new HttpsError(
      "failed-precondition",
      "Approve the ID verification before approving the application.",
    );
  }
  const hasApprovedCert = certsSnap.docs.some(
    (d) => (d.data() as { status?: string }).status === "approved",
  );
  if (!hasApprovedCert) {
    throw new HttpsError(
      "failed-precondition",
      "Approve at least one certification before approving the application.",
    );
  }

  await db.doc(`tradespeople/${tradieUid}`).update({
    vettingStatus: "approved",
    vettingNotes: "",
  });
  await maybeMarkVisible(tradieUid);
  await notify({
    userId: tradieUid,
    type: "vetting_approved",
    title: "You're approved — welcome to Blue Seal",
    body: "Your profile is live and discoverable. Start receiving job requests today.",
    link: "/dashboard/tradie",
    priority: "high",
  });
  await logAdminAction({
    actorUid: actor,
    action: "approveApplication",
    targetType: "tradesperson",
    targetId: tradieUid,
  });
  return { ok: true };
});

export const requestApplicationInfo = onCall({ enforceAppCheck: false }, async (req) => {
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

export const rejectApplication = onCall({ enforceAppCheck: false }, async (req) => {
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
