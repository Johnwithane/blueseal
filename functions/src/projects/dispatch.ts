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

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";
import { firstNameOnly } from "../jobPosts/helpers";

const EXPIRY_DAYS = 30;

export interface DispatchJobSpec {
  trade: string;
  title: string;
  description: string;
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
async function resolvePreferredByTrade(pmId: string): Promise<Map<string, string[]>> {
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

/**
 * Create one scoped "invited" posting per jobSpec, scoped to the PM's preferred
 * contractors matching that trade. Returns the created postIds (stored on the
 * project so the PM can enumerate them for read-only visibility, P3b-3). A spec
 * with no matching preferred contractor still gets a posting (empty scope) — the
 * client opens it to the public board via the fallback (P3b-2b).
 */
export async function dispatchScopedPostings(p: DispatchParams): Promise<string[]> {
  const preferred = await resolvePreferredByTrade(p.projectManagerId);

  const clientSnap = await db.doc(`users/${p.clientId}`).get();
  const clientUser = clientSnap.data() as
    | { displayName?: string; photoURL?: string | null }
    | undefined;
  const clientName = firstNameOnly(clientUser?.displayName);
  const clientPhotoURL = clientUser?.photoURL ?? null;

  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const postIds: string[] = [];
  const batch = db.batch();
  for (const spec of p.jobSpecs) {
    const matching: string[] = [];
    for (const [uid, trades] of preferred) {
      if (trades.includes(spec.trade)) matching.push(uid);
    }
    const postRef = db.collection("jobPosts").doc();
    const metaRef = postRef.collection("private").doc("meta");
    batch.set(postRef, {
      clientId: p.clientId,
      clientName,
      clientPhotoURL,
      status: "invited",
      trade: spec.trade,
      title: spec.title,
      description: spec.description,
      intakeFormData: {},
      photos: [],
      addressPublic: {
        city: p.address.city,
        region: p.address.region,
        postalFsa: fsaOf(p.address.postalCode),
        geohashPublic: "", // geocoded only on public fallback (P3b-2b)
      },
      budget: { min: 0, max: 0, currency: "CAD" },
      urgency: "flexible",
      preferredDateWindow: { start: null, end: null },
      convertedJobId: null,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
      closedAt: null,
      acceptedAt: null,
      editedAt: null,
      invitedContractorIds: matching,
      createdByProjectManagerId: p.projectManagerId,
      projectId: p.projectId,
      propertyId: p.propertyId,
    });
    batch.set(metaRef, {
      addressPrivate: {
        line1: p.address.line1,
        fullPostal: p.address.postalCode,
        geo: null,
        geohashExact: "",
      },
      applicationCount: 0,
      selectedApplicantId: null,
      preferredContractorIds: matching,
    });
    postIds.push(postRef.id);
    if (matching.length === 0) {
      logger.info("dispatchScopedPostings: no preferred contractor for trade", {
        projectId: p.projectId,
        trade: spec.trade,
        postId: postRef.id,
      });
    }
  }
  await batch.commit();
  logger.info("dispatchScopedPostings: created", {
    projectId: p.projectId,
    count: postIds.length,
  });
  return postIds;
}
