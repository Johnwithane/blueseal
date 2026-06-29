// The owning PM adds one or more jobs to a project the client has ALREADY accepted.
// Editing the bundle before accept is updateProject; after accept, dispatch has
// already fanned the original jobs out, so a NEW job isn't a free edit — it's extra
// work the client must agree to. So each added job lands as a "pendingClient"
// jobSpec (no posting yet) and the client approves/declines it per-job
// (respondToProjectJob), which is what dispatches it. Callable-only (the projects
// rules deny direct client writes; status/jobSpecs stay server-managed).

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { randomBytes } from "node:crypto";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { requirePmActive } from "../lib/projectManager";
import { notify } from "../lib/notify";

const Input = z.object({
  projectId: z.string().trim().min(1).max(200),
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

// Mirror projectSchema's bundle cap: a project never holds more than 20 jobs total,
// counting everything still live (declined adds don't count against the ceiling).
const MAX_PROJECT_JOBS = 20;

interface SpecLike {
  status?: string;
}

export const proposeProjectJobs = onCall(CALLABLE_OPTS, async (req) => {
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
  const p = snap.data() as {
    projectManagerId: string;
    clientId?: string | null;
    status?: string;
    label?: string;
    jobSpecs?: SpecLike[];
  };
  if (p.projectManagerId !== uid) {
    throw new HttpsError("permission-denied", "This project isn't yours.");
  }
  // Adding jobs only makes sense once the client has accepted (before that, edit the
  // bundle via updateProject). The client must exist to approve the additions.
  if (p.status !== "accepted" || !p.clientId) {
    throw new HttpsError(
      "failed-precondition",
      "You can only add jobs to a project your client has accepted.",
    );
  }

  const existing = Array.isArray(p.jobSpecs) ? p.jobSpecs : [];
  const liveCount = existing.filter((s) => s.status !== "declined").length;
  if (liveCount + input.jobs.length > MAX_PROJECT_JOBS) {
    throw new HttpsError(
      "failed-precondition",
      `A project can hold up to ${MAX_PROJECT_JOBS} jobs.`,
    );
  }

  const added = input.jobs.map((j) => ({
    id: randomBytes(8).toString("hex"),
    trade: j.trade,
    title: j.title,
    description: j.description,
    status: "pendingClient" as const,
  }));

  await ref.update({
    jobSpecs: FieldValue.arrayUnion(...added),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Tell the client there's new work to approve. High priority — nothing dispatches
  // until they act, so the PM is blocked on them.
  try {
    await notify({
      userId: p.clientId,
      type: "project_jobs_added",
      title: "New jobs added to your project",
      body: `Your project manager added ${added.length === 1 ? "a job" : `${added.length} jobs`} to "${p.label ?? "your project"}". Review and approve to line up quotes.`,
      link: "/dashboard",
      actorUid: uid,
      recipientRole: "client",
      priority: "high",
    });
  } catch (err) {
    logger.error("proposeProjectJobs: notify failed", { uid, projectId: input.projectId, err });
  }

  logger.info("proposeProjectJobs", {
    uid,
    projectId: input.projectId,
    added: added.length,
  });
  return { ok: true as const, added: added.length, specIds: added.map((a) => a.id) };
});
