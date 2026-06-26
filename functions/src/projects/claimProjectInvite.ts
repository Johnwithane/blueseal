// Authenticated callable: a magic-link-signed-in user claims every PROJECT invite
// matching THEIR verified email, becoming each project's client. Security rests on
// request.auth.token.email_verified (Firebase email-link sign-in sets it true,
// proving inbox control) — same contract as claimJobInvite.
//
// Two-phase so the UI can show "you were invited to <project>" BEFORE attaching:
// confirm:false returns the matching invites without touching anything; confirm:true
// claims them all (idempotent per-project transactions). Claiming attaches clientId
// and flips status invited → claimed; ACCEPTING the bundle is a separate step
// (respondToProject), which is what triggers dispatch (P3b-2).

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAuth } from "../lib/auth";

const Input = z.object({
  confirm: z.boolean().default(false),
});

interface InviteData {
  emailLower: string;
  clientName: string;
  status: string;
}

interface ProjectData {
  projectManagerId: string;
  clientId: string | null;
  label?: string;
  status?: string;
  jobSpecs?: Array<unknown>;
  projectInvite?: InviteData | null;
}

export const claimProjectInvite = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const token = (req.auth?.token ?? {}) as {
    email?: string;
    email_verified?: boolean;
    roles?: unknown;
    role?: unknown;
  };
  if (!token.email_verified || !token.email) {
    return { status: "needs_verification" as const };
  }
  // Admins must never attach themselves to member projects via an invite.
  const roles = Array.isArray(token.roles) ? token.roles : [token.role];
  if (roles.includes("admin")) {
    throw new HttpsError("permission-denied", "Admin accounts can't claim project invites.");
  }
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { confirm } = parsed.data;

  const email = token.email.trim().toLowerCase();

  const userSnap = await db.doc(`users/${uid}`).get();
  const user = (userSnap.data() ?? {}) as { deletedAt?: unknown };
  if (user.deletedAt) {
    throw new HttpsError("failed-precondition", "This account is closed.");
  }

  const matchSnap = await db
    .collection("projects")
    .where("projectInvite.emailLower", "==", email)
    .where("projectInvite.status", "==", "invited")
    .get();

  // Self-claim block: a PM can never become their own client.
  const candidates = matchSnap.docs.filter(
    (d) => (d.data() as ProjectData).projectManagerId !== uid,
  );
  if (candidates.length === 0) return { status: "none" as const, invites: [] };

  if (!confirm) {
    // Preview phase — the caller just proved they control the invited inbox.
    return {
      status: "preview" as const,
      invites: candidates.map((d) => {
        const p = d.data() as ProjectData;
        return {
          projectId: d.id,
          label: p.label ?? "Project",
          clientName: p.projectInvite?.clientName ?? "",
          jobCount: Array.isArray(p.jobSpecs) ? p.jobSpecs.length : 0,
        };
      }),
    };
  }

  const claimedProjectIds: string[] = [];
  for (const projectDoc of candidates) {
    try {
      const claimed = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(projectDoc.ref);
        if (!fresh.exists) return false;
        const project = fresh.data() as ProjectData;
        // Idempotence + revoke/race safety: only attach to a still-invited,
        // still-unclaimed project (a stale magic link on a revoked invite signs
        // the holder in but can never get past this check).
        if (
          project.clientId !== null ||
          project.projectInvite?.status !== "invited" ||
          project.projectInvite.emailLower !== email ||
          project.projectManagerId === uid
        ) {
          return false;
        }
        tx.update(projectDoc.ref, {
          clientId: uid,
          status: "claimed",
          claimedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          "projectInvite.status": "claimed",
          "projectInvite.claimedAt": FieldValue.serverTimestamp(),
          "projectInvite.tokenHash": null,
        });
        return true;
      });
      if (claimed) claimedProjectIds.push(projectDoc.id);
    } catch (err) {
      logger.error("claimProjectInvite: claim transaction failed", { uid, projectId: projectDoc.id, err });
    }
  }

  logger.info("claimProjectInvite: claimed", { uid, claimed: claimedProjectIds.length });
  return {
    status: "claimed" as const,
    claimed: claimedProjectIds.length,
    projectIds: claimedProjectIds,
  };
});
