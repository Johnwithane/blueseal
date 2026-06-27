// Authenticated callable: the owning PM re-sends a pending project invite — to nudge a
// client who never got it, or to CORRECT a wrong email. Passing newEmail re-mints the
// invite token (invalidating the old copy-link) and points the invite at the new
// address; otherwise it just re-sends to the stored email. Only valid while the invite
// is still "invited". Mirrors createProject's email-degradation (copy-link if the CASL
// mail gate isn't configured).

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { adminAuth, db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { requirePmActive } from "../lib/projectManager";
import { enforceRateLimit } from "../lib/rateLimit";
import { appBaseUrl, emailHashOf, sha256 } from "../prospects/helpers";
import { isInviteEmailSuppressed } from "../jobs/inviteHelpers";
import { projectMagicLink, sendProjectInviteEmail } from "./inviteHelpers";

const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RESEND_DAILY_CAP = 30;

const Input = z.object({
  projectId: z.string().min(1).max(200),
  newEmail: z.string().trim().toLowerCase().email().max(200).optional(),
});

export const resendProjectInvite = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "projectManager");
  await requirePmActive(uid);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const { projectId, newEmail } = parsed.data;

  const ref = db.doc(`projects/${projectId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Project not found.");
  const p = snap.data() as {
    projectManagerId: string;
    status?: string;
    label?: string;
    clientName?: string;
    jobSpecs?: unknown[];
    projectInvite?: { emailLower?: string } | null;
  };
  if (p.projectManagerId !== uid) {
    throw new HttpsError("permission-denied", "This project isn't yours.");
  }
  if (p.status !== "invited") {
    throw new HttpsError("failed-precondition", "Only a pending invite can be resent.");
  }

  await enforceRateLimit(uid, "project_resend", RESEND_DAILY_CAP);

  const targetEmail = newEmail ?? p.projectInvite?.emailLower ?? "";
  if (!targetEmail) throw new HttpsError("failed-precondition", "No invite email on this project.");

  // Self-deal block (also checked at create): the PM can't redirect the invite to
  // their own inbox and claim it themselves.
  const callerEmail = (await adminAuth.getUser(uid)).email ?? "";
  if (callerEmail && emailHashOf(callerEmail) === emailHashOf(targetEmail)) {
    throw new HttpsError("failed-precondition", "You can't invite your own email address.");
  }

  const changingEmail = !!newEmail && newEmail !== p.projectInvite?.emailLower;
  // Every resend re-mints the token and hands back a fresh shareable link. The
  // raw token is never stored (only its hash), so re-sharing an existing invite is
  // impossible WITHOUT re-minting — and re-minting is the correct latest-wins
  // behaviour (the newest link is the one to use). This lets a PM grab a link to
  // text/DM a client directly, not only at create time or on an email correction.
  const token = randomBytes(32).toString("base64url");
  const update: Record<string, unknown> = {
    "projectInvite.tokenHash": sha256(token),
    "projectInvite.invitedAt": FieldValue.serverTimestamp(),
    "projectInvite.expiresAt": Timestamp.fromMillis(Date.now() + INVITE_TTL_MS),
    "projectInvite.resendCount": FieldValue.increment(1),
    "projectInvite.lastSentAt": FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (changingEmail) update["projectInvite.emailLower"] = newEmail;
  const inviteLink = `${appBaseUrl()}/project-invite/${token}`;
  await ref.update(update);

  const pmSnap = await db.doc(`users/${uid}`).get();
  const pmName =
    ((pmSnap.data() as { displayName?: string } | undefined)?.displayName ?? "").trim() ||
    "Your project manager";
  const jobCount = Array.isArray(p.jobSpecs) ? p.jobSpecs.length : 1;

  let emailed = false;
  try {
    if (!(await isInviteEmailSuppressed(targetEmail))) {
      const signinLink = await projectMagicLink(targetEmail);
      if (signinLink) {
        emailed = await sendProjectInviteEmail({
          toEmail: targetEmail,
          clientName: p.clientName ?? "there",
          pmName,
          projectLabel: p.label ?? "your project",
          jobCount,
          signinLink,
          projectId,
        });
      }
    }
    if (emailed) await ref.update({ "projectInvite.emailedAt": FieldValue.serverTimestamp() });
  } catch (err) {
    logger.warn("resendProjectInvite: email skipped", { uid, projectId, err });
  }

  logger.info("resendProjectInvite", { uid, projectId, changingEmail, emailed });
  return { ok: true as const, emailed, inviteLink };
});
