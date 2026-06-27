import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { adminAuth, db } from "../lib/admin";
import { requireAuth } from "../lib/auth";
import { requirePmActive } from "../lib/projectManager";
import { isInviteEmailSuppressed } from "../jobs/inviteHelpers";
import { sendRosterInviteEmail } from "./rosterInviteHelpers";

const Input = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(200),
});

// Cheap outgoing-volume guard — caps how many invites a single PM can have in
// flight, without a separate rateLimits doc. Mirrors the vouch invite guard.
const MAX_PENDING = 50;

/**
 * A project manager invites a tradesperson to their roster by NAME + EMAIL.
 *
 * Email-only path (the in-cockpit search handles people already on Blue Seal):
 *   - reject an email that already has an account → steer them to the search.
 *   - respect the shared invite opt-out list.
 *   - create a /rosterInvites doc (status pending_signup) and email a compliant
 *     invite. linkRosterInvitesOnSignup adds them to this PM's roster + grants
 *     the free Pro month (via referredByPmId → maybeMarkVisible) when they sign
 *     up as a tradesperson with this email.
 */
export const sendRosterInvite = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  await requirePmActive(uid);

  const parsed = Input.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", "Enter a name and a valid email.");
  }
  const { name, email } = parsed.data;

  if (email === (req.auth?.token.email ?? "").trim().toLowerCase()) {
    throw new HttpsError("invalid-argument", "That's your own email.");
  }

  // Already on Blue Seal → don't email; steer to the in-cockpit search instead.
  try {
    await adminAuth.getUserByEmail(email);
    throw new HttpsError(
      "already-exists",
      'That email already has a Blue Seal account. Search their name under "Already on Blue Seal" to add them.',
    );
  } catch (e) {
    // getUserByEmail throws auth/user-not-found for a fresh invite — that's the
    // happy path. Re-throw our own HttpsError (account exists); swallow the rest.
    if (e instanceof HttpsError) throw e;
  }

  // Permanent opt-out (shared with job/project invites) — never email again.
  if (await isInviteEmailSuppressed(email)) {
    throw new HttpsError(
      "failed-precondition",
      "That address opted out of Blue Seal invite emails. Share your invite link with them directly instead.",
    );
  }

  const pendingCount = await db
    .collection("rosterInvites")
    .where("pmId", "==", uid)
    .where("status", "==", "pending_signup")
    .count()
    .get();
  if (pendingCount.data().count >= MAX_PENDING) {
    throw new HttpsError(
      "resource-exhausted",
      `You already have ${MAX_PENDING} invites awaiting signup. Wait for some to join first.`,
    );
  }

  // Dedupe per (pmId, email) so a PM can't spam the same address.
  const dupe = await db
    .collection("rosterInvites")
    .where("pmId", "==", uid)
    .where("emailLower", "==", email)
    .where("status", "==", "pending_signup")
    .limit(1)
    .get();
  if (!dupe.empty) {
    throw new HttpsError("already-exists", "You've already invited this email.");
  }

  const pmName =
    ((await db.doc(`users/${uid}`).get()).get("displayName") as string | undefined)?.trim() ||
    "A project manager";

  const ref = db.collection("rosterInvites").doc();
  await ref.set({
    pmId: uid,
    pmName,
    inviteeName: name,
    emailLower: email,
    status: "pending_signup",
    tradieId: null,
    createdAt: FieldValue.serverTimestamp(),
    lastSentAt: FieldValue.serverTimestamp(),
    resendCount: 0,
    joinedAt: null,
  });

  let emailed = false;
  try {
    emailed = await sendRosterInviteEmail({
      toEmail: email,
      inviteeName: name,
      pmName,
      inviteId: ref.id,
    });
  } catch (err) {
    // Email enqueue failed — the invite doc still exists and the signup linker
    // will pick it up if they reach Blue Seal another way. Log for ops.
    logger.error("sendRosterInvite: invite email enqueue failed", { uid, inviteId: ref.id, err });
  }

  logger.info("sendRosterInvite", { uid, inviteId: ref.id, emailed });
  return { inviteId: ref.id, emailed };
});
