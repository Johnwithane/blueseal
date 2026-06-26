// Authenticated callable: the owning PM cancels a still-pending project (a mistaken
// project, a wrong invite email, or one the client never acted on). Only pre-dispatch
// statuses (invited / claimed) can be cancelled — once accepted, postings exist and the
// job board owns the lifecycle. Flips the project + its invite to a terminal state, so
// it drops out of the client's pending list and the PM's active view.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";

const Input = z.object({ projectId: z.string().min(1).max(200) });

export const cancelProject = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "projectManager");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { projectId } = parsed.data;

  const ref = db.doc(`projects/${projectId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Project not found.");
  const p = snap.data() as { projectManagerId: string; status?: string };
  if (p.projectManagerId !== uid) {
    throw new HttpsError("permission-denied", "This project isn't yours.");
  }
  if (p.status !== "invited" && p.status !== "claimed") {
    throw new HttpsError("failed-precondition", "Only a pending project can be cancelled.");
  }

  await ref.update({
    status: "cancelled",
    cancelledAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    "projectInvite.status": "revoked",
    "projectInvite.revokedAt": FieldValue.serverTimestamp(),
  });
  logger.info("cancelProject", { uid, projectId });
  return { ok: true as const };
});
