import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { adminAuth, db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { notify } from "../lib/notify";
import {
  loadVoucheeDisplay,
  loadVoucherDisplay,
  sendInviteEmail,
} from "./helpers";

// Mirror of src/validation/schemas.ts → sendVouchRequestSchema. Duplicated
// so the callable's input contract is locked in even if the client-side
// schema is later edited in isolation.
const Input = z
  .object({
    toUserId: z.string().min(1).max(128).optional(),
    toEmail: z
      .string()
      .trim()
      .toLowerCase()
      .email()
      .max(200)
      .optional(),
    toDisplayName: z.string().trim().min(1).max(80),
    message: z.string().trim().max(500).optional(),
  })
  .refine((v) => (v.toUserId == null) !== (v.toEmail == null), {
    message: "Provide either toUserId or toEmail, not both",
  });

const MAX_OUTGOING_PENDING = 50;

/**
 * Tradesperson initiates a vouch for another tradesperson.
 *
 * Three paths, all converging on a single /vouches doc:
 *   1) toUserId provided → pending_acceptance, notify the recipient.
 *   2) toEmail provided AND matches an existing Firebase Auth account →
 *      treat as (1) using the resolved uid.
 *   3) toEmail provided AND no account → pending_signup, email invite.
 *      linkPendingVouchesOnSignup converts to accepted on signup.
 *
 * Dedupe: at most one open or accepted vouch per (fromUserId, target). The
 * target is the resolved uid in (1)/(2), or the email in (3).
 */
export const sendVouchRequest = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = requireRole(req, "tradesperson");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.message);
  }
  const { toUserId: rawToUserId, toEmail: rawToEmail, toDisplayName, message } =
    parsed.data;

  // Self-vouch is meaningless and would create a confusing chip on your own
  // profile — block it explicitly.
  if (rawToUserId === uid) {
    throw new HttpsError("invalid-argument", "You can't vouch for yourself.");
  }

  // Cheap outgoing-volume guard: limit how many pending vouches a single
  // tradesperson can have in flight at any time. Stops bulk-spam invites
  // without needing a separate rateLimits doc.
  const pendingSnap = await db
    .collection("vouches")
    .where("fromUserId", "==", uid)
    .where("status", "in", ["pending_acceptance", "pending_signup"])
    .count()
    .get();
  if (pendingSnap.data().count >= MAX_OUTGOING_PENDING) {
    throw new HttpsError(
      "resource-exhausted",
      `You already have ${MAX_OUTGOING_PENDING} pending vouches. Wait for some to be accepted first.`,
    );
  }

  // Path resolution: turn toEmail into a known uid if possible.
  let toUserId: string | null = rawToUserId ?? null;
  let toEmail: string | null = rawToEmail ?? null;
  if (toEmail && !toUserId) {
    try {
      const existing = await adminAuth.getUserByEmail(toEmail);
      toUserId = existing.uid;
      toEmail = null;
    } catch {
      // Email isn't registered yet — stays as a pending_signup invite.
    }
  }

  if (toUserId === uid) {
    throw new HttpsError("invalid-argument", "You can't vouch for yourself.");
  }

  if (toUserId) {
    // Existing user path — verify the user actually exists (defends against
    // a stale or typo'd uid passed by the client).
    const targetSnap = await db.doc(`users/${toUserId}`).get();
    if (!targetSnap.exists) {
      throw new HttpsError("not-found", "That user doesn't exist.");
    }

    // Dedupe: at most one open/accepted vouch per (from → to) pair.
    const dupeSnap = await db
      .collection("vouches")
      .where("fromUserId", "==", uid)
      .where("toUserId", "==", toUserId)
      .where("status", "in", [
        "pending_acceptance",
        "pending_signup",
        "accepted",
      ])
      .limit(1)
      .get();
    if (!dupeSnap.empty) {
      throw new HttpsError(
        "already-exists",
        "You've already vouched for this person.",
      );
    }

    const [voucherDisplay, voucheeDisplay] = await Promise.all([
      loadVoucherDisplay(uid),
      loadVoucheeDisplay(toUserId),
    ]);

    const vouchRef = db.collection("vouches").doc();
    await vouchRef.set({
      fromUserId: uid,
      ...voucherDisplay,
      toUserId,
      // Use the vouchee's live displayName, falling back to the voucher-typed
      // hint if their profile name is empty.
      toDisplayName: voucheeDisplay.displayName || toDisplayName,
      toPhotoURL: voucheeDisplay.photoURL,
      toPrimaryTrade: voucheeDisplay.primaryTrade,
      toEmail: null,
      status: "pending_acceptance",
      message: message ?? "",
      createdAt: FieldValue.serverTimestamp(),
      respondedAt: null,
    });

    await notify({
      userId: toUserId,
      type: "vouch_requested",
      title: `${voucherDisplay.fromDisplayName} vouched for you`,
      body: message
        ? `"${message}" — accept to show this on your profile.`
        : "Accept to show this endorsement on your profile.",
      link: "/account/vouches",
      actorUid: uid,
      recipientRole: "tradesperson",
      priority: "normal",
    });

    logger.info("sendVouchRequest: existing user", {
      uid,
      toUserId,
      vouchId: vouchRef.id,
    });
    return { vouchId: vouchRef.id, status: "pending_acceptance" as const };
  }

  // Email-invite path (no existing account).
  if (!toEmail) {
    // Should be unreachable given the XOR refine above.
    throw new HttpsError("invalid-argument", "Missing target.");
  }

  // Dedupe on (fromUserId, toEmail) so a tradesperson can't spam-invite the
  // same email repeatedly. They can still revoke + re-invite if needed.
  const dupeEmailSnap = await db
    .collection("vouches")
    .where("fromUserId", "==", uid)
    .where("toEmail", "==", toEmail)
    .where("status", "==", "pending_signup")
    .limit(1)
    .get();
  if (!dupeEmailSnap.empty) {
    throw new HttpsError(
      "already-exists",
      "You've already invited this email.",
    );
  }

  const voucherDisplay = await loadVoucherDisplay(uid);

  const vouchRef = db.collection("vouches").doc();
  await vouchRef.set({
    fromUserId: uid,
    ...voucherDisplay,
    toUserId: null,
    toDisplayName,
    toPhotoURL: null,
    toPrimaryTrade: null,
    toEmail,
    status: "pending_signup",
    message: message ?? "",
    createdAt: FieldValue.serverTimestamp(),
    respondedAt: null,
  });

  try {
    await sendInviteEmail({
      toEmail,
      voucherName: voucherDisplay.fromDisplayName,
      voucherTrade: voucherDisplay.fromPrimaryTrade,
      inviteeName: toDisplayName,
      message: message ?? "",
    });
  } catch (err) {
    // Email enqueue failed — the vouch still exists and the signup linker
    // will still pick it up if the invitee finds Blue Seal another way.
    // Log so ops can spot a pattern.
    logger.error("sendVouchRequest: invite email enqueue failed", {
      uid,
      vouchId: vouchRef.id,
      err,
    });
  }

  logger.info("sendVouchRequest: email invite", {
    uid,
    toEmail,
    vouchId: vouchRef.id,
  });
  return { vouchId: vouchRef.id, status: "pending_signup" as const };
});
