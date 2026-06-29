// A project manager sets up a project (a bundle of trade jobs) for one client and
// invites them by email. The project starts unclaimed (clientId: null) with a
// server-managed projectInvite on the doc; the client claims it (claimProjectInvite
// attaches their uid) and then accepts (respondToProject), which is what triggers
// dispatch in P3b-2. Callable-only by design — the projects create rule denies all
// direct client writes — because:
//  1. the copyable invite token must be minted server-side (only its SHA-256 hash
//     is stored, so project-doc readability never leaks the credential),
//  2. project `status` drives the dispatch + commission seam, so it must never be
//     client-writable,
//  3. the invite email rides the server-only mail queue.

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

const Input = z.object({
  label: z.string().trim().min(2).max(120),
  clientName: z.string().trim().min(1).max(80),
  clientEmail: z.string().trim().toLowerCase().email().max(200),
  propertyId: z.string().trim().min(1).max(200).nullable().default(null),
  unit: z.string().trim().max(40).nullable().default(null),
  photoUrl: z.string().trim().max(1000).nullable().default(null),
  jobs: z
    .array(
      z.object({
        trade: z.string().trim().min(1).max(50),
        title: z.string().trim().min(3).max(140),
        description: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(20),
});

const PROJECT_CREATE_DAILY_CAP = 30;
const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days; gates copy-link verify only

export const createProject = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "projectManager");
  await requirePmActive(uid);

  const parsed = Input.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const input = parsed.data;

  // Self-dealing block: a PM inviting their own inbox could claim the project
  // themselves and act as both parties. Checked again at claim time.
  const callerEmail = (await adminAuth.getUser(uid)).email ?? "";
  if (callerEmail && emailHashOf(callerEmail) === emailHashOf(input.clientEmail)) {
    throw new HttpsError("failed-precondition", "You can't invite your own email address.");
  }

  try {
    await enforceRateLimit(uid, "project_create", PROJECT_CREATE_DAILY_CAP);
  } catch (err) {
    if (err instanceof HttpsError && err.code === "resource-exhausted") {
      throw new HttpsError(
        "resource-exhausted",
        `Daily limit of ${PROJECT_CREATE_DAILY_CAP} new projects reached. Please try again tomorrow.`,
      );
    }
    throw err;
  }

  // If a property is named, it must be one this PM owns (don't let a project
  // point at someone else's property book).
  if (input.propertyId) {
    const propSnap = await db.doc(`properties/${input.propertyId}`).get();
    if (!propSnap.exists || propSnap.get("projectManagerId") !== uid) {
      throw new HttpsError("failed-precondition", "That property isn't in your book.");
    }
  }

  const userSnap = await db.doc(`users/${uid}`).get();
  const user = (userSnap.data() ?? {}) as { displayName?: unknown };
  const pmName =
    (typeof user.displayName === "string" && user.displayName.trim()) || "Your project manager";

  // Copyable invite-link token. The raw token is returned ONCE (the UI builds
  // /project-invite/{token}); only the hash is stored. The link can't sign anyone
  // in — it can only trigger sending a magic link to the stored invite email.
  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);

  const ctx = { fn: "createProject", uid };
  logger.info("starting", ctx);
  try {
    const projectRef = db.collection("projects").doc();
    await projectRef.set({
      projectManagerId: uid,
      clientId: null,
      propertyId: input.propertyId,
      unit: input.unit,
      label: input.label,
      clientName: input.clientName,
      photoUrl: input.photoUrl,
      jobSpecs: input.jobs,
      status: "invited",
      claimedAt: null,
      acceptedAt: null,
      declinedAt: null,
      cancelledAt: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      projectInvite: {
        emailLower: input.clientEmail,
        clientName: input.clientName,
        status: "invited",
        invitedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + INVITE_TTL_MS),
        claimedAt: null,
        revokedAt: null,
        resendCount: 0,
        lastSentAt: null,
        emailedAt: null,
        tokenHash,
      },
    });

    // Best-effort invite email. Degrades to copy-link-only if any gate fails
    // (suppression list, magic-link generation, CASL mailing address) — the
    // project is already created either way.
    let emailed = false;
    try {
      if (!(await isInviteEmailSuppressed(input.clientEmail))) {
        const signinLink = await projectMagicLink(input.clientEmail);
        if (signinLink) {
          emailed = await sendProjectInviteEmail({
            toEmail: input.clientEmail,
            clientName: input.clientName,
            pmName,
            projectLabel: input.label,
            jobCount: input.jobs.length,
            signinLink,
            projectId: projectRef.id,
          });
        }
      }
      if (emailed) {
        await projectRef.update({
          "projectInvite.emailedAt": FieldValue.serverTimestamp(),
          "projectInvite.lastSentAt": FieldValue.serverTimestamp(),
        });
      }
    } catch (err) {
      logger.warn("createProject: invite email skipped", { ...ctx, projectId: projectRef.id, err });
    }

    logger.info("success", { ...ctx, projectId: projectRef.id, emailed });
    return {
      projectId: projectRef.id,
      inviteLink: `${appBaseUrl()}/project-invite/${token}`,
      emailed,
    };
  } catch (err) {
    logger.error("failed", { ...ctx, err });
    if (err instanceof HttpsError) throw err;
    throw new HttpsError("internal", "Something went wrong creating the project.");
  }
});
