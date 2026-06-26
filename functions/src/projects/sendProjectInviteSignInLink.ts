// DELIBERATELY UNAUTHENTICATED callable — the only way a no-account client holding
// a copied/texted project-invite link can act. Given a valid (token, email) pair
// where the email matches the one the PM stored on the invite, it sends a fresh
// Firebase magic sign-in link TO THAT STORED ADDRESS. It never signs anyone in,
// never returns the link to the browser, and never emails a caller-chosen address.
// Inbox control stays the credential. Mirrors sendJobInviteSignInLink exactly.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { enforceRateLimit } from "../lib/rateLimit";
import { sha256 } from "../prospects/helpers";
import { isInviteEmailSuppressed } from "../jobs/inviteHelpers";
import { projectMagicLink, sendProjectInviteEmail } from "./inviteHelpers";

const Input = z.object({
  token: z.string().min(20).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
});

const PER_TOKEN_DAILY_CAP = 5;
const PER_IP_DAILY_CAP = 30;

const GENERIC_FAIL = new HttpsError(
  "failed-precondition",
  "That link is invalid, expired, or the email doesn't match the invite. Ask your project manager to re-send it.",
);

interface ProjectData {
  projectManagerId: string;
  clientId: string | null;
  label: string;
  jobSpecs?: Array<unknown>;
  projectInvite?: {
    emailLower: string;
    clientName: string;
    status: string;
    expiresAt: { toMillis(): number } | null;
  } | null;
}

export const sendProjectInviteSignInLink = onCall(CALLABLE_OPTS, async (req) => {
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { token, email } = parsed.data;
  const tokenHash = sha256(token);

  // Rate limits BEFORE any lookup so the endpoint can't be brute-forced into an
  // oracle. Pseudo-uids keep the shared rateLimits/{action}_{uid}_{day} doc shape.
  const ip = req.rawRequest.ip ?? "unknown";
  try {
    await enforceRateLimit(`tok_${tokenHash.slice(0, 16)}`, "project_invite_verify", PER_TOKEN_DAILY_CAP);
    await enforceRateLimit(`ip_${sha256(ip).slice(0, 16)}`, "project_invite_verify_ip", PER_IP_DAILY_CAP);
  } catch (err) {
    if (err instanceof HttpsError && err.code === "resource-exhausted") {
      throw new HttpsError("resource-exhausted", "Too many attempts. Try again tomorrow.");
    }
    throw err;
  }

  const match = await db
    .collection("projects")
    .where("projectInvite.tokenHash", "==", tokenHash)
    .limit(1)
    .get();
  if (match.empty) throw GENERIC_FAIL;

  const projectDoc = match.docs[0];
  const project = projectDoc.data() as ProjectData;
  const invite = project.projectInvite;
  if (
    !invite ||
    invite.status !== "invited" ||
    project.clientId !== null ||
    invite.emailLower !== email ||
    (invite.expiresAt && invite.expiresAt.toMillis() < Date.now())
  ) {
    throw GENERIC_FAIL;
  }

  if (await isInviteEmailSuppressed(invite.emailLower)) {
    throw new HttpsError(
      "failed-precondition",
      "This email address has unsubscribed from Blue Seal invite emails.",
    );
  }

  const userSnap = await db.doc(`users/${project.projectManagerId}`).get();
  const pmName =
    (typeof userSnap.get("displayName") === "string" && (userSnap.get("displayName") as string).trim()) ||
    "Your project manager";

  const signinLink = await projectMagicLink(invite.emailLower);
  if (!signinLink) {
    throw new HttpsError("unavailable", "Sign-in links are temporarily unavailable. Try again later.");
  }
  const emailed = await sendProjectInviteEmail({
    toEmail: invite.emailLower,
    clientName: invite.clientName,
    pmName,
    projectLabel: project.label,
    jobCount: Array.isArray(project.jobSpecs) ? project.jobSpecs.length : 1,
    signinLink,
    projectId: projectDoc.id,
  });
  if (!emailed) {
    throw new HttpsError("unavailable", "Email sending isn't configured yet. Try again later.");
  }

  await projectDoc.ref.update({
    "projectInvite.emailedAt": FieldValue.serverTimestamp(),
    "projectInvite.lastSentAt": FieldValue.serverTimestamp(),
  });

  logger.info("sendProjectInviteSignInLink: sent", { projectId: projectDoc.id });
  return { ok: true };
});
