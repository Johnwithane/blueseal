// The owning PM edits a project that hasn't been accepted yet — its label, client
// name, photo, property link, and the list of jobs. Callable-only (the projects
// rules deny direct client writes; status/invite/commission fields stay
// server-managed). Editing is allowed ONLY while status is "invited" or "claimed":
// once the client accepts, dispatch has fanned the jobs out to contractors as
// scoped postings, so the job list is no longer a safe free edit. Changing the
// client's EMAIL is a separate flow (resendProjectInvite, which re-mints the token).

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { requirePmActive } from "../lib/projectManager";

const Input = z.object({
  projectId: z.string().trim().min(1).max(200),
  label: z.string().trim().min(2).max(120),
  clientName: z.string().trim().min(1).max(80),
  propertyId: z.string().trim().min(1).max(200).nullable().default(null),
  unit: z.string().trim().max(40).nullable().default(null),
  photoUrl: z.string().trim().max(1000).nullable().default(null),
  jobs: z
    .array(
      z.object({
        trade: z.string().trim().min(1).max(50),
        title: z.string().trim().min(3).max(140),
        description: z.string().trim().min(1).max(4000),
        // Storage paths (jobPosts/{uuid}/photos/) the PM attached; carried onto the
        // dispatched posting so contractors see them like a client-posted job.
        photos: z.array(z.string().trim().min(1).max(500)).max(8).default([]),
      }),
    )
    .min(1)
    .max(20),
});

export const updateProject = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "projectManager");
  await requirePmActive(uid);

  const parsed = Input.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const input = parsed.data;

  const ref = db.doc(`projects/${input.projectId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Project not found.");
  const p = snap.data() as { projectManagerId: string; status?: string };
  if (p.projectManagerId !== uid) {
    throw new HttpsError("permission-denied", "This project isn't yours.");
  }
  if (p.status !== "invited" && p.status !== "claimed") {
    throw new HttpsError(
      "failed-precondition",
      "Only a project your client hasn't accepted yet can be edited.",
    );
  }

  // A named property must be one this PM owns (mirrors createProject).
  if (input.propertyId) {
    const propSnap = await db.doc(`properties/${input.propertyId}`).get();
    if (!propSnap.exists || propSnap.get("projectManagerId") !== uid) {
      throw new HttpsError("failed-precondition", "That property isn't in your book.");
    }
  }

  await ref.update({
    label: input.label,
    clientName: input.clientName,
    photoUrl: input.photoUrl,
    propertyId: input.propertyId,
    unit: input.unit,
    jobSpecs: input.jobs,
    // Keep the denormalized invite name in step with the client name.
    "projectInvite.clientName": input.clientName,
    updatedAt: FieldValue.serverTimestamp(),
  });

  logger.info("updateProject", { uid, projectId: input.projectId, jobs: input.jobs.length });
  return { ok: true as const };
});
