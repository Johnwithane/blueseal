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

const Input = z.object({
  projectId: z.string().min(1).max(200),
  response: z.enum(["accept", "decline"]),
});

interface ProjectData {
  projectManagerId: string;
  clientId: string | null;
  label?: string;
  status?: string;
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
    await ref.update({
      status: "accepted",
      acceptedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    // P3b-2 DISPATCH HOOK: on accept, fan each jobSpec out to the PM's preferred
    // contractors as a scoped ("invited") job posting. Added in the next increment.
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
    logger.info("respondToProject: accepted", { uid, projectId });
    return { status: "accepted" as const };
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
