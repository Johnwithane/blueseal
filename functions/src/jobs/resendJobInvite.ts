// Re-deliver (or repair) a job invite. Rotates the copyable-link token every
// time — old links die, which doubles as instant revocation of a forwarded
// or mistyped link — and resets the expiry. `newEmail` fixes a typo'd
// address (and re-opens a revoked invite); `channel` picks whether we email
// a fresh magic link or just hand back a new copyable link.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { adminAuth, db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { enforceRateLimit } from "../lib/rateLimit";
import { appBaseUrl, emailHashOf, sha256 } from "../prospects/helpers";
import { inviteMagicLink, isInviteEmailSuppressed, sendInviteEmail } from "./inviteHelpers";

const Input = z.object({
  jobId: z.string().min(1).max(128),
  channel: z.enum(["email", "link"]),
  newEmail: z.string().trim().toLowerCase().email().max(200).optional(),
  newClientName: z.string().trim().min(1).max(80).optional(),
});

const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_COOLDOWN_MS = 24 * 60 * 60 * 1000; // don't let resend become a nag channel
const RESEND_DAILY_CAP = 10;

interface InviteData {
  emailLower: string;
  clientName: string;
  status: "invited" | "claimed" | "revoked";
  lastSentAt: Timestamp | null;
  resendCount: number;
}

interface JobData {
  tradespersonId: string;
  clientId: string | null;
  trade: string;
  tradespersonName?: string | null;
  clientInvite?: InviteData | null;
}

export const resendJobInvite = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId, channel, newEmail, newClientName } = parsed.data;

  try {
    await enforceRateLimit(uid, "invite_resend", RESEND_DAILY_CAP);
  } catch (err) {
    if (err instanceof HttpsError && err.code === "resource-exhausted") {
      throw new HttpsError("resource-exhausted", "Too many invite updates today. Try again tomorrow.");
    }
    throw err;
  }

  const jobRef = db.doc(`jobs/${jobId}`);
  const snap = await jobRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Job not found.");
  const job = snap.data() as JobData;
  if (job.tradespersonId !== uid) throw new HttpsError("permission-denied", "Not your job.");
  if (job.clientId !== null) {
    throw new HttpsError("failed-precondition", "Your client already joined — nothing to resend.");
  }
  const invite = job.clientInvite;
  if (!invite) throw new HttpsError("failed-precondition", "This job has no invite.");
  // A revoked invite can only come back via an explicit newEmail (re-invite);
  // a plain resend of a revoked invite is almost certainly a mistake.
  if (invite.status === "revoked" && !newEmail) {
    throw new HttpsError(
      "failed-precondition",
      "This invite was revoked — provide the client's email to re-invite.",
    );
  }

  const targetEmail = newEmail ?? invite.emailLower;
  const targetName = newClientName ?? invite.clientName;

  // Self-invite block, same as createInviteJob.
  const callerEmail = (await adminAuth.getUser(uid)).email ?? "";
  if (callerEmail && emailHashOf(callerEmail) === emailHashOf(targetEmail)) {
    throw new HttpsError("failed-precondition", "You can't invite your own email address.");
  }

  // Email-channel cooldown (rotating the copy link any time is fine — only
  // actual sends are throttled).
  if (channel === "email" && invite.lastSentAt) {
    const since = Date.now() - invite.lastSentAt.toMillis();
    if (since < EMAIL_COOLDOWN_MS) {
      throw new HttpsError(
        "failed-precondition",
        "An invite email already went out in the last 24 hours. Copy the link and text it instead.",
      );
    }
  }

  const token = randomBytes(32).toString("base64url");
  const update: Record<string, unknown> = {
    "clientInvite.emailLower": targetEmail,
    "clientInvite.clientName": targetName,
    "clientInvite.status": "invited",
    "clientInvite.revokedAt": null,
    "clientInvite.tokenHash": sha256(token),
    "clientInvite.expiresAt": Timestamp.fromMillis(Date.now() + INVITE_TTL_MS),
    "clientInvite.resendCount": FieldValue.increment(1),
  };
  // Keep the denormalized counterparty name in sync when the tradesperson
  // corrects it (admin SDK bypasses the rules pin on clientName, by design).
  if (newClientName) update.clientName = targetName;

  let emailed = false;
  if (channel === "email") {
    if (!(await isInviteEmailSuppressed(targetEmail))) {
      const signinLink = await inviteMagicLink(targetEmail);
      if (signinLink) {
        emailed = await sendInviteEmail({
          toEmail: targetEmail,
          clientName: targetName,
          tradieName: job.tradespersonName?.trim() || "Your tradesperson",
          tradeName: job.trade,
          signinLink,
          jobId,
        });
      }
    }
    if (emailed) {
      update["clientInvite.emailedAt"] = FieldValue.serverTimestamp();
      update["clientInvite.lastSentAt"] = FieldValue.serverTimestamp();
    }
  }

  await jobRef.update(update);

  logger.info("resendJobInvite", { jobId, uid, channel, emailed, emailChanged: !!newEmail });
  return { inviteLink: `${appBaseUrl()}/invite/${token}`, emailed };
});
