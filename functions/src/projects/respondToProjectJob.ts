// Authenticated callable: the project's client approves or declines ONE job their
// project manager added AFTER they accepted the project (proposeProjectJobs). This
// is the per-job mirror of respondToProject: approving an added job is the
// commitment that fans THAT job out to the PM's preferred contractors for quotes
// (dispatchAddedSpec). Declining marks the spec "declined" and notifies the PM.
//
// Only the project's own client (clientId == uid) may respond, only while the
// project is "accepted", and only for a spec still "pendingClient" — the dispatch
// transaction re-checks that last guard so a double-tap can't fire twice. The work
// address was captured at the original accept, so there's nothing more to ask for.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAuth } from "../lib/auth";
import { notify } from "../lib/notify";
import { dispatchAddedSpec, type DispatchAddress } from "./dispatch";

const Input = z.object({
  projectId: z.string().trim().min(1).max(200),
  specId: z.string().trim().min(1).max(64),
  response: z.enum(["accept", "decline"]),
});

interface SpecData {
  id?: string;
  trade?: string;
  title?: string;
  status?: string;
}

interface ProjectData {
  projectManagerId: string;
  clientId?: string | null;
  propertyId?: string | null;
  label?: string;
  status?: string;
  jobSpecs?: SpecData[];
  address?: DispatchAddress | null;
}

export const respondToProjectJob = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { projectId, specId, response } = parsed.data;

  const ref = db.doc(`projects/${projectId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Project not found.");
  const project = snap.data() as ProjectData;

  if (project.clientId !== uid) {
    throw new HttpsError("permission-denied", "This project isn't yours to respond to.");
  }
  if (project.status !== "accepted") {
    throw new HttpsError("failed-precondition", "This project isn't accepting added jobs.");
  }
  const specs = Array.isArray(project.jobSpecs) ? project.jobSpecs : [];
  const spec = specs.find((s) => s.id === specId && s.status === "pendingClient");
  if (!spec) {
    throw new HttpsError("failed-precondition", "This job has already been responded to.");
  }

  const userSnap = await db.doc(`users/${uid}`).get();
  const user = (userSnap.data() ?? {}) as { displayName?: unknown };
  const clientName =
    (typeof user.displayName === "string" && user.displayName.trim()) || "Your client";
  const jobLabel = spec.title || "a job";

  if (response === "accept") {
    // Reuse the address the client confirmed at the original accept. (Accepted
    // projects always have it — respondToProject requires it; redispatch relies on
    // it too.) Guard anyway so we never dispatch with a half-built address.
    const address = project.address;
    if (!address || !address.line1 || !address.postalCode) {
      throw new HttpsError(
        "failed-precondition",
        "This project has no saved address — re-accept the project first.",
      );
    }

    // The transaction re-checks the spec is still "pendingClient", flips it to
    // "dispatched", creates the posting + appends the id — all atomically.
    const res = await dispatchAddedSpec({
      projectId,
      projectManagerId: project.projectManagerId,
      propertyId: project.propertyId ?? null,
      clientId: uid,
      specId,
      address,
    });

    try {
      await notify({
        userId: project.projectManagerId,
        type: "invite_claimed",
        title: "Your client approved an added job",
        body: `${clientName} approved "${jobLabel}" on "${project.label ?? "your project"}". It's out to your trades for quotes.`,
        link: `/manage/projects/${projectId}`,
        actorUid: uid,
        recipientRole: "projectManager",
        priority: "high",
      });
    } catch (err) {
      logger.error("respondToProjectJob: notify failed", { uid, projectId, specId, err });
    }

    logger.info("respondToProjectJob: accepted", {
      uid,
      projectId,
      specId,
      postId: res.postId,
      unmatched: res.unmatched,
    });
    return {
      status: "accepted" as const,
      postId: res.postId,
      unmatched: res.unmatched,
    };
  }

  // Decline: flip the spec to "declined" in a transaction (re-checking it's still
  // pending) so a concurrent approve can't both dispatch and decline it.
  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    if (!fresh.exists) throw new HttpsError("not-found", "Project not found.");
    const p = fresh.data() as ProjectData;
    const list = Array.isArray(p.jobSpecs) ? p.jobSpecs : [];
    const idx = list.findIndex((s) => s.id === specId && s.status === "pendingClient");
    if (idx === -1) {
      throw new HttpsError("failed-precondition", "This job has already been responded to.");
    }
    const next = list.slice();
    next[idx] = { ...list[idx], status: "declined" };
    tx.update(ref, { jobSpecs: next, updatedAt: FieldValue.serverTimestamp() });
  });

  try {
    await notify({
      userId: project.projectManagerId,
      type: "invite_claimed",
      title: "Your client declined an added job",
      body: `${clientName} declined "${jobLabel}" on "${project.label ?? "your project"}".`,
      link: `/manage/projects/${projectId}`,
      actorUid: uid,
      recipientRole: "projectManager",
      priority: "normal",
    });
  } catch (err) {
    logger.error("respondToProjectJob: notify failed", { uid, projectId, specId, err });
  }

  logger.info("respondToProjectJob: declined", { uid, projectId, specId });
  return { status: "declined" as const };
});
