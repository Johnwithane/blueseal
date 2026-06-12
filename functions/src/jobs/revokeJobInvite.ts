// Kill a pending invite (wrong email, client changed their mind). The copy
// link dies immediately (tokenHash cleared); an already-emailed Firebase
// magic link can't be individually revoked, but it only ever signs the
// recipient IN — claimJobInvite re-checks invite.status inside its
// transaction, so a revoked invite can never attach anyone to the job.
// The job itself stays fully solo-runnable.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";

const Input = z.object({
  jobId: z.string().min(1).max(128),
});

interface JobData {
  tradespersonId: string;
  clientId: string | null;
  clientInvite?: { status: string } | null;
}

export const revokeJobInvite = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireRole(req, "tradesperson");
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", parsed.error.message);
  const { jobId } = parsed.data;

  const jobRef = db.doc(`jobs/${jobId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) throw new HttpsError("not-found", "Job not found.");
    const job = snap.data() as JobData;
    if (job.tradespersonId !== uid) throw new HttpsError("permission-denied", "Not your job.");
    if (job.clientId !== null) {
      throw new HttpsError("failed-precondition", "Your client already joined — the invite can't be revoked.");
    }
    if (!job.clientInvite || job.clientInvite.status !== "invited") {
      throw new HttpsError("failed-precondition", "No active invite to revoke.");
    }
    tx.update(jobRef, {
      "clientInvite.status": "revoked",
      "clientInvite.revokedAt": FieldValue.serverTimestamp(),
      "clientInvite.tokenHash": null,
    });
  });

  logger.info("revokeJobInvite", { jobId, uid });
  return { ok: true };
});
