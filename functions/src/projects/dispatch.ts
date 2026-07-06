// Project dispatch: when a client accepts a PM project (respondToProject), fan each
// jobSpec out to the PM's preferred contractors as a SCOPED job posting. A scoped
// posting uses the "invited" JobPostStatus (NOT "open"), so it stays off the public
// geohash feed; only the contractors in `invitedContractorIds` can see + apply
// (read rule + the invited-feed query gate on it). The same set is mirrored into the
// bid-blind meta as `preferredContractorIds` (never cleared) so acceptApplicationQuote
// can decide PM-driven commission even after a public fallback wipes the live scope.
//
// Address: the client confirms a structured address at accept (P3b decision). It's
// stored without geo here (geohashPublic / geo empty); the public-board fallback
// (P3b-2b) geocodes it. Scoped postings don't need a geohash — they're found by
// array-contains, not proximity.
//
// Two dispatch paths share one posting shape (buildScopedPosting):
//  - dispatchScopedPostings: the WHOLE bundle at the original accept (batch, sets
//    jobPostIds). Skips specs the client hasn't approved yet ("pendingClient") or
//    declined — only those exist after the added-jobs feature.
//  - dispatchAddedSpec: ONE post-accept added job the client just approved
//    (transaction, APPENDS to jobPostIds). See respondToProjectJob.

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";
import { firstNameOnly } from "../jobPosts/helpers";
import { notify } from "../lib/notify";

const EXPIRY_DAYS = 30;

export interface DispatchResult {
  /** Created posting ids (one per dispatched jobSpec), also written onto the project. */
  postIds: string[];
  /** Unique hand-picked contractors invited across all postings (notified). */
  invitedUids: string[];
  /** Trades with NO matching saved+visible contractor (empty-scope postings). */
  unmatchedTrades: string[];
}

export interface DispatchJobSpec {
  trade: string;
  title: string;
  description: string;
  /** Storage paths the PM attached (jobPosts/{uuid}/photos/); copied verbatim onto
   *  the posting so contractors see them like a client-posted job. */
  photos?: string[];
  /** Set only on post-accept added jobs; absent === an original (dispatched) spec. */
  id?: string;
  status?: "dispatched" | "pendingClient" | "declined";
}

export interface DispatchAddress {
  line1: string;
  city: string;
  region: string;
  postalCode: string;
}

export interface DispatchParams {
  projectId: string;
  projectManagerId: string;
  propertyId: string | null;
  clientId: string;
  jobSpecs: DispatchJobSpec[];
  address: DispatchAddress;
}

// The PM's preferred contractors (saved trades) that are visible, mapped to their
// trade keys. A saved tradie who went invisible/deleted is dropped.
export async function resolvePreferredByTrade(pmId: string): Promise<Map<string, string[]>> {
  const savedSnap = await db.collection(`users/${pmId}/savedTradies`).get();
  const result = new Map<string, string[]>();
  await Promise.all(
    savedSnap.docs.map(async (d) => {
      const t = await db.doc(`tradespeople/${d.id}`).get();
      const data = t.data() as { isVisible?: boolean; trades?: unknown } | undefined;
      if (data?.isVisible === true && Array.isArray(data.trades)) {
        result.set(d.id, data.trades.filter((x): x is string => typeof x === "string"));
      }
    }),
  );
  return result;
}

function fsaOf(postal: string): string {
  return postal.replace(/[\s-]/g, "").slice(0, 3).toUpperCase();
}

interface PostingContext {
  projectId: string;
  projectManagerId: string;
  propertyId: string | null;
  clientId: string;
  clientName: string;
  clientPhotoURL: string | null;
  address: DispatchAddress;
  expiresAt: Timestamp;
}

// Build the post + meta doc data for ONE jobSpec, scoped to the PM's preferred
// contractors matching that trade. Single source of truth for the scoped-posting
// shape — both the bundle batch and the single-spec transaction write this. The
// caller persists it (batch.set / tx.set). A spec with no matching preferred
// contractor still gets a posting (empty scope) and `unmatched: true` — the client
// opens it to the public board via the fallback.
function buildScopedPosting(
  spec: DispatchJobSpec,
  preferred: Map<string, string[]>,
  ctx: PostingContext,
): {
  postData: Record<string, unknown>;
  metaData: Record<string, unknown>;
  matching: string[];
  unmatched: boolean;
} {
  const matching: string[] = [];
  for (const [uid, trades] of preferred) {
    if (trades.includes(spec.trade)) matching.push(uid);
  }
  const postData = {
    clientId: ctx.clientId,
    clientName: ctx.clientName,
    clientPhotoURL: ctx.clientPhotoURL,
    status: "invited",
    trade: spec.trade,
    title: spec.title,
    description: spec.description,
    intakeFormData: {},
    photos: Array.isArray(spec.photos) ? spec.photos : [],
    addressPublic: {
      city: ctx.address.city,
      region: ctx.address.region,
      postalFsa: fsaOf(ctx.address.postalCode),
      geohashPublic: "", // geocoded only on public fallback (P3b-2b)
    },
    budget: { min: 0, max: 0, currency: "CAD" },
    urgency: "flexible",
    preferredDateWindow: { start: null, end: null },
    convertedJobId: null,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: ctx.expiresAt,
    closedAt: null,
    acceptedAt: null,
    editedAt: null,
    invitedContractorIds: matching,
    createdByProjectManagerId: ctx.projectManagerId,
    projectId: ctx.projectId,
    propertyId: ctx.propertyId,
  };
  const metaData = {
    addressPrivate: {
      line1: ctx.address.line1,
      fullPostal: ctx.address.postalCode,
      geo: null,
      geohashExact: "",
    },
    applicationCount: 0,
    selectedApplicantId: null,
    preferredContractorIds: matching,
  };
  return { postData, metaData, matching, unmatched: matching.length === 0 };
}

async function resolveParties(
  projectManagerId: string,
  clientId: string,
): Promise<{ clientName: string; clientPhotoURL: string | null; pmName: string }> {
  const clientSnap = await db.doc(`users/${clientId}`).get();
  const clientUser = clientSnap.data() as
    | { displayName?: string; photoURL?: string | null }
    | undefined;
  const pmSnap = await db.doc(`users/${projectManagerId}`).get();
  const pmName =
    firstNameOnly((pmSnap.data() as { displayName?: string } | undefined)?.displayName) ||
    "A project manager";
  return {
    clientName: firstNameOnly(clientUser?.displayName),
    clientPhotoURL: clientUser?.photoURL ?? null,
    pmName,
  };
}

// Best-effort: tell each hand-picked contractor they were invited to quote and
// deep-link them straight to the posting. The whole point of a scoped dispatch is
// the personal invite — without this they'd only discover it by chance in Browse
// jobs. Keyed by contractor uid → the posting(s) they matched; a tradie saved
// under >1 trade can match several in one dispatch, and no single deep link fits
// that, so they fall back to the invited feed in Browse.
async function notifyInvited(
  invitedPosts: Map<string, string[]>,
  pmName: string,
  projectId: string,
): Promise<void> {
  await Promise.all(
    [...invitedPosts].map(([uid, postIds]) => {
      const single = postIds.length === 1;
      return notify({
        userId: uid,
        type: "invited_to_quote",
        title: "You've been invited to quote",
        body: single
          ? `${pmName} invited you to quote on a job. Open it to submit your quote.`
          : `${pmName} invited you to quote on ${postIds.length} jobs. Open Browse jobs to submit your quotes.`,
        link: single ? `/jobs/posted/${postIds[0]}` : "/jobs/browse",
        ctaLabel: single ? "View the job" : "Browse jobs",
        recipientRole: "tradesperson",
        priority: "high",
      }).catch((err) => logger.error("dispatch: notify failed", { uid, projectId, err }));
    }),
  );
}

/**
 * Create one scoped "invited" posting per (approved) jobSpec, scoped to the PM's
 * preferred contractors matching that trade. The created postIds are written ONTO
 * the project in the same batch (atomic — closes the "postings committed but
 * jobPostIds write failed" gap), so the PM can enumerate them for read-only
 * visibility (P3b-3) and a recovery path can tell "dispatched" from
 * "accepted-but-un-dispatched". Jobs the client hasn't approved yet ("pendingClient")
 * or declined are skipped — they only become postings via dispatchAddedSpec. Each
 * hand-picked contractor is notified after commit.
 */
export async function dispatchScopedPostings(p: DispatchParams): Promise<DispatchResult> {
  const preferred = await resolvePreferredByTrade(p.projectManagerId);
  const { clientName, clientPhotoURL, pmName } = await resolveParties(
    p.projectManagerId,
    p.clientId,
  );

  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const ctx: PostingContext = {
    projectId: p.projectId,
    projectManagerId: p.projectManagerId,
    propertyId: p.propertyId,
    clientId: p.clientId,
    clientName,
    clientPhotoURL,
    address: p.address,
    expiresAt,
  };

  // Only original/approved jobs dispatch here; a "pendingClient" or "declined" add
  // never goes out without its own per-job approval.
  const specsToDispatch = p.jobSpecs.filter(
    (s) => s.status !== "pendingClient" && s.status !== "declined",
  );

  const postIds: string[] = [];
  // uid → the posting(s) that contractor was invited to. One tradie can match
  // more than one posting (saved under multiple trades), so this drives a
  // per-contractor deep link (or a Browse fallback when they matched several).
  const invitedPosts = new Map<string, string[]>();
  const unmatchedTrades: string[] = [];
  const batch = db.batch();
  for (const spec of specsToDispatch) {
    const postRef = db.collection("jobPosts").doc();
    const metaRef = postRef.collection("private").doc("meta");
    const built = buildScopedPosting(spec, preferred, ctx);
    built.matching.forEach((u) => {
      const posts = invitedPosts.get(u);
      if (posts) posts.push(postRef.id);
      else invitedPosts.set(u, [postRef.id]);
    });
    if (built.unmatched) unmatchedTrades.push(spec.trade);
    batch.set(postRef, built.postData);
    batch.set(metaRef, built.metaData);
    postIds.push(postRef.id);
    if (built.unmatched) {
      logger.info("dispatchScopedPostings: no preferred contractor for trade", {
        projectId: p.projectId,
        trade: spec.trade,
        postId: postRef.id,
      });
    }
  }

  // Write the postIds onto the project in the SAME batch so the create + the
  // project's record of them commit atomically (recovery keys off an accepted
  // project with an empty jobPostIds).
  batch.update(db.doc(`projects/${p.projectId}`), {
    jobPostIds: postIds,
    dispatchedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  logger.info("dispatchScopedPostings: created", {
    projectId: p.projectId,
    count: postIds.length,
    unmatched: unmatchedTrades.length,
  });

  const invitedUids = [...invitedPosts.keys()];
  await notifyInvited(invitedPosts, pmName, p.projectId);

  return { postIds, invitedUids, unmatchedTrades };
}

export interface AddedSpecDispatchResult {
  postId: string;
  invitedUids: string[];
  /** No preferred contractor matched the trade — the posting went out empty-scope. */
  unmatched: boolean;
}

/**
 * Dispatch ONE post-accept added job the client just approved (respondToProjectJob).
 * Unlike the bundle dispatch, this APPENDS a single posting and flips the spec to
 * "dispatched" in a TRANSACTION, so a double-approve (or a concurrent re-tap) can't
 * create two postings: the transaction re-reads the spec and bails if it's no longer
 * "pendingClient". Reuses the same posting shape + invite notification as the bundle.
 */
export async function dispatchAddedSpec(params: {
  projectId: string;
  projectManagerId: string;
  propertyId: string | null;
  clientId: string;
  specId: string;
  address: DispatchAddress;
}): Promise<AddedSpecDispatchResult> {
  const preferred = await resolvePreferredByTrade(params.projectManagerId);
  const { clientName, clientPhotoURL, pmName } = await resolveParties(
    params.projectManagerId,
    params.clientId,
  );

  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const ctx: PostingContext = {
    projectId: params.projectId,
    projectManagerId: params.projectManagerId,
    propertyId: params.propertyId,
    clientId: params.clientId,
    clientName,
    clientPhotoURL,
    address: params.address,
    expiresAt,
  };

  const postRef = db.collection("jobPosts").doc();
  const metaRef = postRef.collection("private").doc("meta");
  const projRef = db.doc(`projects/${params.projectId}`);

  const out = await db.runTransaction(async (tx) => {
    const snap = await tx.get(projRef);
    if (!snap.exists) throw new HttpsError("not-found", "Project not found.");
    const proj = snap.data() as { jobSpecs?: DispatchJobSpec[]; jobPostIds?: string[] };
    const specs = Array.isArray(proj.jobSpecs) ? proj.jobSpecs : [];
    const idx = specs.findIndex((s) => s.id === params.specId && s.status === "pendingClient");
    if (idx === -1) {
      // Lost a race / already responded — idempotent guard, no second posting.
      throw new HttpsError("failed-precondition", "This job has already been responded to.");
    }
    const built = buildScopedPosting(specs[idx], preferred, ctx);
    tx.set(postRef, built.postData);
    tx.set(metaRef, built.metaData);
    const nextSpecs = specs.slice();
    nextSpecs[idx] = { ...specs[idx], status: "dispatched" };
    const nextPostIds = Array.isArray(proj.jobPostIds)
      ? [...proj.jobPostIds, postRef.id]
      : [postRef.id];
    tx.update(projRef, {
      jobSpecs: nextSpecs,
      jobPostIds: nextPostIds,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { matching: built.matching, unmatched: built.unmatched };
  });

  logger.info("dispatchAddedSpec: created", {
    projectId: params.projectId,
    postId: postRef.id,
    unmatched: out.unmatched,
  });
  await notifyInvited(
    new Map(out.matching.map((u): [string, string[]] => [u, [postRef.id]])),
    pmName,
    params.projectId,
  );

  return { postId: postRef.id, invitedUids: out.matching, unmatched: out.unmatched };
}
