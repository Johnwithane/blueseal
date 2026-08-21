// Manual status control for SOLO jobs (issue #29).
//
// A tradesperson running a bring-your-own-client job (clientId null: the
// invite is unclaimed, or there never was one) often does the work entirely
// off-app — the pipeline's intermediate stops are their own bookkeeping, not
// a contract with anyone. So they can move such a job by hand:
//
//   start → in_progress   from requested / quoted / accepted
//   hold  → on_hold       from requested / quoted / accepted / in_progress
//                         (statusBeforeHold remembered; the existing
//                         resumeJob callable restores it)
//
// Completing stays with submitJobForApproval (#28) and resuming with
// resumeJob — this callable deliberately owns only the two transitions
// nothing else provides. Jobs WITH a client are rejected outright: their
// pipeline moves through quote acceptance / postpone consent, where the
// other party has a say.
//
// Chat: onJobUpdated suppresses its generic status line for every transition
// this callable makes (into on_hold is callable-owned there already; the
// starts were added alongside this file), so the line posted here is the
// only one.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { postSystemMessage } from "../lib/chatSystemMessage";

const Input = z.object({
  jobId: z.string().min(1).max(128),
  target: z.enum(["in_progress", "on_hold"]),
});

interface JobData {
  tradespersonId: string;
  clientId: string | null;
  status: string;
  chatId?: string | null;
}

const START_FROM = ["requested", "quoted", "accepted"];
const HOLD_FROM = ["requested", "quoted", "accepted", "in_progress"];

export const setSoloJobStatus = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId, target } = parsed.data;

  const jobRef = db.doc(`jobs/${jobId}`);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) throw new HttpsError("not-found", "Job not found.");
    const job = snap.data() as JobData;
    if (job.tradespersonId !== uid) {
      throw new HttpsError("permission-denied", "Not your job.");
    }
    if (job.clientId !== null) {
      throw new HttpsError(
        "failed-precondition",
        "This job has a client attached — its status moves through the normal pipeline.",
      );
    }
    const allowedFrom = target === "in_progress" ? START_FROM : HOLD_FROM;
    if (!allowedFrom.includes(job.status)) {
      throw new HttpsError(
        "failed-precondition",
        `Can't move this job to ${target} from "${job.status}".`,
      );
    }
    tx.update(
      jobRef,
      target === "on_hold"
        ? { status: "on_hold", statusBeforeHold: job.status }
        : { status: "in_progress" },
    );
    return { chatId: job.chatId ?? null, from: job.status };
  });

  // Post-commit, best-effort. No notify(): a solo job has nobody else to tell.
  if (result.chatId) {
    try {
      await postSystemMessage(
        result.chatId,
        target === "in_progress"
          ? "Work started — the job is now in progress."
          : "Job put on hold.",
      );
    } catch (err) {
      logger.warn("setSoloJobStatus: chat line skipped", { jobId, err });
    }
  }

  logger.info("setSoloJobStatus", { jobId, uid, target, from: result.from });
  return { ok: true };
});
