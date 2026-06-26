// Authenticated callable: the client who claimed a project accepts or declines the
// bundle. Accepting is the commitment that, in P3b-2, fans each jobSpec out to the
// PM's preferred contractors for quotes (the dispatch + commission seam). For P3b-1
// it simply flips status claimed → accepted/declined and notifies the PM.
//
// Only the project's own client (clientId == uid) may respond, and only while the
// project is still "claimed" (idempotent — a double-tap on accept/decline can't
// re-fire dispatch or flip an already-decided project).

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAuth } from "../lib/auth";
import { notify } from "../lib/notify";
import { dispatchScopedPostings, type DispatchJobSpec } from "./dispatch";

// On accept, the client confirms a structured address for the work (P3b decision:
// the address lives where the knowledge is). It's required to accept; geocoding
// for the public-board fallback follows in P3b-2b.
const AddressInput = z.object({
  line1: z.string().trim().min(2).max(200),
  city: z.string().trim().min(2).max(100),
  region: z.string().trim().min(2).max(100),
  postalCode: z.string().trim().min(3).max(12),
});

const Input = z.object({
  projectId: z.string().min(1).max(200),
  response: z.enum(["accept", "decline"]),
  address: AddressInput.nullable().default(null),
});

interface ProjectData {
  projectManagerId: string;
  clientId: string | null;
  propertyId?: string | null;
  label?: string;
  status?: string;
  jobSpecs?: DispatchJobSpec[];
}

export const respondToProject = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { projectId, response } = parsed.data;

  const ref = db.doc(`projects/${projectId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Project not found.");
  const project = snap.data() as ProjectData;

  if (project.clientId !== uid) {
    throw new HttpsError("permission-denied", "This project isn't yours to respond to.");
  }
  if (project.status !== "claimed") {
    throw new HttpsError("failed-precondition", "This project has already been responded to.");
  }

  const userSnap = await db.doc(`users/${uid}`).get();
  const user = (userSnap.data() ?? {}) as { displayName?: unknown };
  const clientName =
    (typeof user.displayName === "string" && user.displayName.trim()) || "Your client";

  if (response === "accept") {
    if (!parsed.data.address) {
      throw new HttpsError("invalid-argument", "An address is required to accept.");
    }
    const address = parsed.data.address;

    // Flip claimed -> accepted in a transaction so two concurrent accepts can't
    // both dispatch (the loser's guard fails). Dispatch happens AFTER, keyed off
    // the now-accepted project.
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      if (!fresh.exists) throw new HttpsError("not-found", "Project not found.");
      const p = fresh.data() as ProjectData;
      if (p.clientId !== uid) {
        throw new HttpsError("permission-denied", "This project isn't yours to respond to.");
      }
      if (p.status !== "claimed") {
        throw new HttpsError("failed-precondition", "This project has already been responded to.");
      }
      tx.update(ref, {
        status: "accepted",
        acceptedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    // Dispatch one scoped posting per jobSpec to the PM's matching preferred
    // contractors. Best-effort: a dispatch failure leaves the project accepted but
    // un-posted (logged) rather than rolling back the client's accept.
    let jobPostIds: string[] = [];
    try {
      jobPostIds = await dispatchScopedPostings({
        projectId,
        projectManagerId: project.projectManagerId,
        propertyId: project.propertyId ?? null,
        clientId: uid,
        jobSpecs: Array.isArray(project.jobSpecs) ? project.jobSpecs : [],
        address,
      });
      await ref.update({ jobPostIds, updatedAt: FieldValue.serverTimestamp() });
    } catch (err) {
      logger.error("respondToProject: dispatch failed after accept", { uid, projectId, err });
    }

    try {
      await notify({
        userId: project.projectManagerId,
        type: "invite_claimed",
        title: "Your client accepted the project",
        body: `${clientName} accepted "${project.label ?? "your project"}" on Blue Seal.`,
        link: "/manage",
        actorUid: uid,
        recipientRole: "projectManager",
        priority: "high",
      });
    } catch (err) {
      logger.error("respondToProject: notify failed", { uid, projectId, err });
    }
    logger.info("respondToProject: accepted", { uid, projectId, postCount: jobPostIds.length });
    return { status: "accepted" as const, jobPostIds };
  }

  await ref.update({
    status: "declined",
    declinedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  try {
    await notify({
      userId: project.projectManagerId,
      type: "invite_claimed",
      title: "Your client declined the project",
      body: `${clientName} declined "${project.label ?? "your project"}" on Blue Seal.`,
      link: "/manage",
      actorUid: uid,
      recipientRole: "projectManager",
      priority: "normal",
    });
  } catch (err) {
    logger.error("respondToProject: notify failed", { uid, projectId, err });
  }
  logger.info("respondToProject: declined", { uid, projectId });
  return { status: "declined" as const };
});
