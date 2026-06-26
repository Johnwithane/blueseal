// Authenticated callable: recover a project whose dispatch failed. respondToProject
// flips the project to "accepted" and then dispatches; if the dispatch throws (a
// transient read/commit failure), the project is left "accepted" with an empty
// jobPostIds — postings never got created and nobody was invited. Either party (the
// client or the owning PM) can re-run the dispatch here, reusing the address the
// client confirmed at accept. Idempotency: refuses to run once jobPostIds is
// non-empty, so it can never double-dispatch a project that already has postings.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAuth } from "../lib/auth";
import { dispatchScopedPostings, type DispatchAddress, type DispatchJobSpec } from "./dispatch";

const Input = z.object({ projectId: z.string().min(1).max(200) });

interface ProjectData {
  projectManagerId: string;
  clientId: string | null;
  propertyId?: string | null;
  status?: string;
  jobSpecs?: DispatchJobSpec[];
  jobPostIds?: string[];
  address?: DispatchAddress | null;
}

export const redispatchProject = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { projectId } = parsed.data;

  const ref = db.doc(`projects/${projectId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Project not found.");
  const project = snap.data() as ProjectData;

  if (project.clientId !== uid && project.projectManagerId !== uid) {
    throw new HttpsError("permission-denied", "This project isn't yours.");
  }
  if (project.status !== "accepted") {
    throw new HttpsError("failed-precondition", "Only an accepted project can be dispatched.");
  }
  if (Array.isArray(project.jobPostIds) && project.jobPostIds.length > 0) {
    throw new HttpsError("failed-precondition", "This project's jobs were already sent out.");
  }
  if (!project.clientId || !project.address) {
    throw new HttpsError("failed-precondition", "This project isn't ready to dispatch.");
  }

  try {
    const res = await dispatchScopedPostings({
      projectId,
      projectManagerId: project.projectManagerId,
      propertyId: project.propertyId ?? null,
      clientId: project.clientId,
      jobSpecs: Array.isArray(project.jobSpecs) ? project.jobSpecs : [],
      address: project.address,
    });
    logger.info("redispatchProject: dispatched", {
      uid,
      projectId,
      postCount: res.postIds.length,
    });
    return { ok: true as const, jobPostIds: res.postIds, unmatchedTrades: res.unmatchedTrades };
  } catch (err) {
    logger.error("redispatchProject: dispatch failed", { uid, projectId, err });
    throw new HttpsError("internal", "Couldn't send the jobs out. Please try again.");
  }
});
