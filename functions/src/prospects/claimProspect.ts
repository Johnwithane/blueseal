// Authenticated callable: a magic-link-signed-in user claims the seeded
// prospect(s) matching THEIR verified email. Security rests on
// request.auth.token.email_verified — Firebase email-link sign-in sets it true,
// proving the caller controls that inbox. (The old onDocumentCreated trigger
// that trusted the attacker-writable users/{uid}.email field is removed.)
//
// Order is chosen for crash-safety: matched prospects are flipped out of search
// (isListed:false, status:claimed) FIRST, so even if a later step dies the
// just-joined person can't be re-discovered or re-emailed. Then the seeded
// profile migrates into tradespeople/{uid} as a draft, held leads convert into
// real jobs (idempotently, per-lead transactions), the tradesperson gets one
// summary notification, and the prospect docs are deleted (best-effort).

import { onCall } from "firebase-functions/v2/https";
import { FieldValue, GeoPoint } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAuth } from "../lib/auth";
import { notify } from "../lib/notify";
import { buildProspectDraft, emailHashOf, prospectDraftOverlay } from "./helpers";

export const claimProspect = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const token = (req.auth?.token ?? {}) as { email?: string; email_verified?: boolean };
  if (!token.email_verified || !token.email) {
    return { status: "needs_verification" as const };
  }
  const email = token.email.trim().toLowerCase();
  const emailHash = emailHashOf(email);

  const matchSnap = await db
    .collection("prospects")
    .where("emailHash", "==", emailHash)
    .where("status", "in", ["listed", "outreach_sent"])
    .get();
  if (matchSnap.empty) return { status: "none" as const };

  // 0) DURABLE first write: flip every matched prospect out of search + mark
  //    claimed. If anything below crashes, they're already un-discoverable and
  //    un-requestable (requestProspectOutreach short-circuits on these).
  const claimBatch = db.batch();
  for (const pdoc of matchSnap.docs) {
    claimBatch.update(pdoc.ref, {
      status: "claimed",
      isListed: false,
      claimedByUid: uid,
      claimedAt: FieldValue.serverTimestamp(),
    });
  }
  await claimBatch.commit();

  const prospect = matchSnap.docs[0].data() as Record<string, unknown>;
  const userSnap = await db.doc(`users/${uid}`).get();
  const userData = (userSnap.data() ?? {}) as { displayName?: unknown; photoURL?: unknown };

  // 1) Migrate seeded profile → tradespeople/{uid} draft, idempotently.
  const tradieRef = db.doc(`tradespeople/${uid}`);
  const tradieSnap = await tradieRef.get();
  if (!tradieSnap.exists) {
    await tradieRef.set(buildProspectDraft(prospect, userData));
    await tradieRef
      .collection("private")
      .doc("contact")
      .set(
        {
          location: (prospect.locationApprox as GeoPoint | null) ?? new GeoPoint(0, 0),
          primaryAddressText: typeof prospect.locationLabel === "string" ? prospect.locationLabel : "",
          businessAddress: null,
          businessPhone: null,
          gstNumber: null,
        },
        { merge: true },
      );
  } else {
    // A draft already exists. Only overlay the seeded fields if the tradie
    // hasn't started editing/submitting (else a re-entry would clobber edits).
    const td = tradieSnap.data() as { vettingStatus?: string; submittedAt?: unknown };
    if (td.vettingStatus === "draft" && !td.submittedAt) {
      await tradieRef.set(prospectDraftOverlay(prospect), { merge: true });
    }
  }

  // 2) Convert held leads → real jobs (idempotent per-lead transaction).
  const tradieName =
    (typeof userData.displayName === "string" && userData.displayName.trim()) ||
    (typeof prospect.displayName === "string" ? prospect.displayName : "") ||
    "Tradesperson";
  const tradiePhoto =
    (typeof userData.photoURL === "string" ? userData.photoURL : null) ??
    (typeof prospect.photoURL === "string" ? prospect.photoURL : null);

  const leadsSnap = await db
    .collection("prospectLeads")
    .where("emailHash", "==", emailHash)
    .where("status", "==", "pending_signup")
    .get();

  let jobsCreated = 0;
  for (const leadDoc of leadsSnap.docs) {
    const leadRef = leadDoc.ref;
    try {
      const result = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(leadRef);
        if (!fresh.exists || fresh.get("status") !== "pending_signup") return null; // idempotent
        const lead = fresh.data() as Record<string, unknown>;
        const addr = (lead.address as Record<string, unknown>) ?? {};
        const jobRef = db.collection("jobs").doc();
        const chatRef = db.collection("chats").doc();
        tx.set(jobRef, {
          clientId: String(lead.clientId),
          tradespersonId: uid,
          clientName: (lead.clientName as string | null) ?? null,
          clientPhotoURL: (lead.clientPhotoURL as string | null) ?? null,
          tradespersonName: tradieName,
          tradespersonPhotoURL: tradiePhoto,
          status: "requested",
          trade: String(lead.trade ?? ""),
          title: String(lead.title ?? "Job request"),
          description: String(lead.description ?? ""),
          intakeFormData: (lead.intakeFormData as Record<string, unknown>) ?? {},
          intakePhotos: (lead.intakePhotos as string[]) ?? [],
          address: {
            line1: String(addr.line1 ?? ""),
            city: String(addr.city ?? ""),
            region: String(addr.region ?? ""),
            postalCode: String(addr.postalCode ?? ""),
            geo: null,
          },
          preferredDateWindow: { start: null, end: null },
          urgency: String(lead.urgency ?? "flexible"),
          scheduledStart: null,
          scheduledEnd: null,
          createdAt: FieldValue.serverTimestamp(),
          completedAt: null,
          clientApprovalRequestedAt: null,
          clientApprovedAt: null,
          cancelledAt: null,
          cancelledReason: null,
          cancelledBy: null,
          chatId: chatRef.id,
          sourcePostId: null,
          // Skips the per-job onJobCreated page; claimProspect sends one summary.
          claimOriginated: true,
        });
        tx.set(chatRef, {
          jobId: jobRef.id,
          clientId: String(lead.clientId),
          tradespersonId: uid,
          lastMessageAt: null,
          lastMessagePreview: "",
          unreadCounts: { [String(lead.clientId)]: 0, [uid]: 0 },
        });
        tx.update(leadRef, {
          status: "claimed",
          claimedJobId: jobRef.id,
          respondedAt: FieldValue.serverTimestamp(),
        });
        return { jobId: jobRef.id, clientId: String(lead.clientId), title: String(lead.title ?? "your request") };
      });
      if (result) {
        jobsCreated += 1;
        try {
          await notify({
            userId: result.clientId,
            type: "prospect_claimed",
            title: `${tradieName} joined Blue Seal`,
            body: `The pro you requested for "${result.title}" is now on Blue Seal — your request is live.`,
            link: `/jobs/${result.jobId}`,
            actorUid: uid,
            recipientRole: "client",
            priority: "high",
          });
        } catch (err) {
          logger.error("claimProspect: client notify failed", { uid, leadId: leadDoc.id, err });
        }
      }
    } catch (err) {
      logger.error("claimProspect: lead→job failed", { uid, leadId: leadDoc.id, err });
    }
  }

  // One summary notification to the new tradesperson (not one per lead).
  if (jobsCreated > 0) {
    try {
      await notify({
        userId: uid,
        type: "job_requested",
        title: `${jobsCreated} customer${jobsCreated === 1 ? "" : "s"} waiting for you`,
        body: `${jobsCreated} job request${jobsCreated === 1 ? "" : "s"} came in while you were listed on Blue Seal. Finish your profile to respond.`,
        link: `/dashboard/tradie`,
        actorUid: null,
        recipientRole: "tradesperson",
        priority: "normal",
      });
    } catch (err) {
      logger.error("claimProspect: tradie summary notify failed", { uid, err });
    }
  }

  // 3) Delete the claimed prospect docs (best-effort; they're already
  //    isListed:false so a failed delete leaves no discoverable/requestable doc).
  for (const pdoc of matchSnap.docs) {
    await pdoc.ref.collection("private").doc("contact").delete().catch(() => {});
    await pdoc.ref.delete().catch((err) => logger.error("claimProspect: prospect delete failed", { prospectId: pdoc.id, err }));
  }

  logger.info("claimProspect: claimed", { uid, prospects: matchSnap.size, jobsCreated });
  return { status: "claimed" as const, jobsCreated, prospectsClaimed: matchSnap.size };
});
