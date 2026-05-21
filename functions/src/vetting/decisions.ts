import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";
import { enqueueMail } from "../lib/mail";
import { maybeMarkVisible } from "./visibility";

const ApproveInput = z.object({ tradieUid: z.string().min(1) });
const InfoInput = z.object({ tradieUid: z.string().min(1), notes: z.string().min(1) });
const RejectInput = z.object({ tradieUid: z.string().min(1), reason: z.string().min(1) });

async function tradieEmail(uid: string): Promise<string | null> {
  const u = await db.doc(`users/${uid}`).get();
  return (u.data() as { email?: string } | undefined)?.email ?? null;
}

export const approveApplication = onCall({ enforceAppCheck: false }, async (req) => {
  const actor = requireAdmin(req);
  const parsed = ApproveInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { tradieUid } = parsed.data;

  await db.doc(`tradespeople/${tradieUid}`).update({
    vettingStatus: "approved",
    vettingNotes: "",
  });
  await maybeMarkVisible(tradieUid);
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
  await logAdminAction({
    actorUid: actor,
    action: "rejectApplication",
    targetType: "tradesperson",
    targetId: tradieUid,
    reason,
  });
  return { ok: true };
});
