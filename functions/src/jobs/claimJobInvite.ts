// Authenticated callable: a magic-link-signed-in user claims every job
// invite matching THEIR verified email, becoming the job's client. Security
// rests on request.auth.token.email_verified (Firebase email-link sign-in
// sets it true, proving inbox control) — same contract as claimProspect.
//
// Two-phase so the UI can show "you were invited by <tradie> for <job>"
// BEFORE attaching: confirm:false returns the matching invites without
// touching anything; confirm:true claims them all (idempotent per-job
// transactions, claimProspect's pattern).
//
// The transaction backfills the denormalized clientId on the chat AND on
// quotes/{jobId} + invoices/{jobId} — their read rules key on
// resource.data.clientId == uid, so without the backfill the freshly-joined
// client would get permission-denied on exactly the docs this feature
// exists to show them. timeEntries/sessions rows keep their null clientId
// (reads authorize via the parent job; update rules pin the field).

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAuth } from "../lib/auth";
import { notify } from "../lib/notify";
import { postSystemMessage } from "../lib/chatSystemMessage";

const Input = z.object({
  confirm: z.boolean().default(false),
});

interface InviteData {
  emailLower: string;
  clientName: string;
  status: string;
}

interface JobData {
  tradespersonId: string;
  clientId: string | null;
  chatId: string;
  title?: string;
  trade?: string;
  status?: string;
  tradespersonName?: string | null;
  acceptedOffline?: boolean;
  clientInvite?: InviteData | null;
}

export const claimJobInvite = onCall(CALLABLE_OPTS, async (req) => {
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
  // Admins must never attach themselves to member jobs via an invite — and a
  // support person social-engineered into clicking a link shouldn't either.
  const roles = Array.isArray(token.roles) ? token.roles : [token.role];
  if (roles.includes("admin")) {
    throw new HttpsError("permission-denied", "Admin accounts can't claim job invites.");
  }
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { confirm } = parsed.data;

  const email = token.email.trim().toLowerCase();

  const userSnap = await db.doc(`users/${uid}`).get();
  const user = (userSnap.data() ?? {}) as {
    displayName?: unknown;
    photoURL?: unknown;
    deletedAt?: unknown;
  };
  if (user.deletedAt) {
    throw new HttpsError("failed-precondition", "This account is closed.");
  }

  const matchSnap = await db
    .collection("jobs")
    .where("clientInvite.emailLower", "==", email)
    .where("clientInvite.status", "==", "invited")
    .get();

  // Self-claim block: a tradesperson can never become their own client.
  const candidates = matchSnap.docs.filter(
    (d) => (d.data() as JobData).tradespersonId !== uid,
  );
  if (candidates.length === 0) return { status: "none" as const, invites: [] };

  if (!confirm) {
    // Preview phase — safe to show names/titles: the caller just proved they
    // control the invited inbox.
    return {
      status: "preview" as const,
      invites: candidates.map((d) => {
        const j = d.data() as JobData;
        return {
          jobId: d.id,
          title: j.title ?? "Job",
          trade: j.trade ?? "",
          tradieName: j.tradespersonName?.trim() || "Your tradesperson",
          clientName: j.clientInvite?.clientName ?? "",
          acceptedOffline: j.acceptedOffline === true,
        };
      }),
    };
  }

  const displayName = typeof user.displayName === "string" ? user.displayName.trim() : "";
  const photoURL = typeof user.photoURL === "string" ? user.photoURL : null;

  const claimedJobs: Array<{
    jobId: string;
    tradespersonId: string;
    title: string;
    chatId: string;
    status: string;
    acceptedOffline: boolean;
  }> = [];
  for (const jobDoc of candidates) {
    try {
      const result = await db.runTransaction(async (tx) => {
        const jobRef = jobDoc.ref;
        const fresh = await tx.get(jobRef);
        if (!fresh.exists) return null;
        const job = fresh.data() as JobData;
        // Idempotence + revoke/race safety: only attach to a still-invited,
        // still-unclaimed job (a stale magic link on a revoked invite signs
        // the holder in but can never get past this check).
        if (
          job.clientId !== null ||
          job.clientInvite?.status !== "invited" ||
          job.clientInvite.emailLower !== email ||
          job.tradespersonId === uid
        ) {
          return null;
        }
        const chatRef = db.doc(`chats/${job.chatId}`);
        const quoteRef = db.doc(`quotes/${jobRef.id}`);
        const invoiceRef = db.doc(`invoices/${jobRef.id}`);
        const [chatSnap, quoteSnap, invoiceSnap] = await Promise.all([
          tx.get(chatRef),
          tx.get(quoteRef),
          tx.get(invoiceRef),
        ]);

        tx.update(jobRef, {
          clientId: uid,
          clientName: displayName || job.clientInvite.clientName || null,
          clientPhotoURL: photoURL,
          "clientInvite.status": "claimed",
          "clientInvite.claimedAt": FieldValue.serverTimestamp(),
          "clientInvite.tokenHash": null,
        });
        if (chatSnap.exists) {
          tx.update(chatRef, {
            clientId: uid,
            [`unreadCounts.${uid}`]: 0,
          });
        }
        if (quoteSnap.exists) tx.update(quoteRef, { clientId: uid });
        if (invoiceSnap.exists) tx.update(invoiceRef, { clientId: uid });

        return {
          jobId: jobRef.id,
          tradespersonId: job.tradespersonId,
          title: job.title ?? "your job",
          chatId: job.chatId,
          status: job.status ?? "",
          acceptedOffline: job.acceptedOffline === true,
        };
      });
      if (result) claimedJobs.push(result);
    } catch (err) {
      logger.error("claimJobInvite: claim transaction failed", { uid, jobId: jobDoc.id, err });
    }
  }

  // Post-commit, best-effort: tell each tradesperson their client joined
  // (also their cue to double-check it's the RIGHT person — the notification
  // names the claimer), and drop an audit line in the job chat.
  for (const job of claimedJobs) {
    try {
      await postSystemMessage(
        job.chatId,
        `${displayName || "Your client"} joined the job on Blue Seal.`,
      );
      await notify({
        userId: job.tradespersonId,
        type: "invite_claimed",
        title: "Your client joined Blue Seal",
        body: `${displayName || "Your client"} accepted the invite for "${job.title}" — the job is now two-party.`,
        link: `/jobs/${job.jobId}`,
        actorUid: uid,
        jobId: job.jobId,
        recipientRole: "tradesperson",
        priority: "high",
      });
    } catch (err) {
      logger.error("claimJobInvite: post-claim notify failed", { uid, jobId: job.jobId, err });
    }
  }

  logger.info("claimJobInvite: claimed", { uid, claimed: claimedJobs.length });
  return {
    status: "claimed" as const,
    claimed: claimedJobs.length,
    jobIds: claimedJobs.map((j) => j.jobId),
    // Per-job detail so the landing page can route a client who claimed a
    // COMPLETED job straight into the review prompt (?review=1) — except on
    // offline-accepted jobs, which never produce public reviews (the
    // reputation firewall in firestore.rules).
    jobs: claimedJobs.map((j) => ({
      jobId: j.jobId,
      status: j.status,
      acceptedOffline: j.acceptedOffline,
    })),
  };
});
