// P5b — featuring preferred contractors on a PM's PUBLIC profile, with consent.
//
// The public profile (projectManagers/{pmId}) is world-readable, but a PM's
// savedTradies are PRIVATE, so the featured set is DENORMALIZED onto the public doc
// (featuredContractors[]) and SERVER-MANAGED here (the rules pin it against owner
// writes) so a PM can't forge a contractor's identity or feature someone who opted
// out. Two callables:
//   - setFeaturedContractor (PM): feature/unfeature a saved, visible contractor who
//     hasn't opted out; notifies them + keeps a reverse index so they can find who
//     features them.
//   - setPmFeatureOptOut (contractor): opt out of a given PM's profile (removes them
//     from that PM's featured list + blocks future featuring), or opt back in.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireRole } from "../lib/auth";
import { requirePmActive } from "../lib/projectManager";
import { notify } from "../lib/notify";

const MAX_FEATURED = 24;

interface FeaturedContractor {
  tradieId: string;
  displayName: string | null;
  photoURL: string | null;
  trades: string[];
}

function currentFeatured(data: Record<string, unknown> | undefined): FeaturedContractor[] {
  const arr = data?.featuredContractors;
  return Array.isArray(arr) ? (arr as FeaturedContractor[]) : [];
}

const FeatureInput = z.object({
  tradieId: z.string().min(1).max(128),
  featured: z.boolean(),
});

export const setFeaturedContractor = onCall(CALLABLE_OPTS, async (req) => {
  const pmId = requireRole(req, "projectManager");
  await requirePmActive(pmId);
  const parsed = FeatureInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { tradieId, featured } = parsed.data;

  const profileRef = db.doc(`projectManagers/${pmId}`);

  if (!featured) {
    // Unfeature: drop from the public list + clear the reverse index.
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(profileRef);
      if (!snap.exists) return;
      const next = currentFeatured(snap.data()).filter((c) => c.tradieId !== tradieId);
      tx.update(profileRef, { featuredContractors: next, updatedAt: FieldValue.serverTimestamp() });
    });
    await db.doc(`users/${tradieId}/featuredByPms/${pmId}`).delete();
    logger.info("setFeaturedContractor: unfeatured", { pmId, tradieId });
    return { ok: true as const };
  }

  // Feature — consent + eligibility gates first.
  const optOut = await db.doc(`users/${tradieId}/pmFeatureOptOuts/${pmId}`).get();
  if (optOut.exists) {
    throw new HttpsError("failed-precondition", "This contractor has opted out of being featured.");
  }
  const saved = await db.doc(`users/${pmId}/savedTradies/${tradieId}`).get();
  if (!saved.exists) {
    throw new HttpsError("failed-precondition", "Save this contractor to your trusted trades first.");
  }
  const tSnap = await db.doc(`tradespeople/${tradieId}`).get();
  const t = tSnap.data() as
    | { isVisible?: boolean; displayName?: string | null; photoURL?: string | null; trades?: unknown }
    | undefined;
  if (!tSnap.exists || t?.isVisible !== true) {
    throw new HttpsError("failed-precondition", "That tradesperson isn't available to feature.");
  }
  const entry: FeaturedContractor = {
    tradieId,
    displayName: typeof t.displayName === "string" ? t.displayName : null,
    photoURL: typeof t.photoURL === "string" ? t.photoURL : null,
    trades: Array.isArray(t.trades) ? t.trades.filter((x): x is string => typeof x === "string") : [],
  };

  let pmName = "A project manager";
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(profileRef);
    if (!snap.exists) {
      throw new HttpsError("failed-precondition", "Set up your public profile first.");
    }
    const data = snap.data() ?? {};
    pmName =
      (typeof data.companyName === "string" && data.companyName) ||
      (typeof data.displayName === "string" && data.displayName) ||
      "A project manager";
    const next = [...currentFeatured(data).filter((c) => c.tradieId !== tradieId), entry];
    if (next.length > MAX_FEATURED) {
      throw new HttpsError("failed-precondition", `You can feature up to ${MAX_FEATURED} contractors.`);
    }
    tx.update(profileRef, { featuredContractors: next, updatedAt: FieldValue.serverTimestamp() });
  });

  // Reverse index so the contractor can see (and opt out of) who features them.
  await db.doc(`users/${tradieId}/featuredByPms/${pmId}`).set({
    pmName,
    featuredAt: FieldValue.serverTimestamp(),
  });

  try {
    await notify({
      userId: tradieId,
      type: "pm_featured",
      title: "You're featured on a Blue Seal profile",
      body: `${pmName} added you to the trades they feature on their public profile. You can opt out any time.`,
      link: "/featured-by-pms",
      actorUid: pmId,
      recipientRole: "tradesperson",
      priority: "normal",
    });
  } catch (err) {
    logger.error("setFeaturedContractor: notify failed", { pmId, tradieId, err });
  }

  logger.info("setFeaturedContractor: featured", { pmId, tradieId });
  return { ok: true as const };
});

const OptOutInput = z.object({
  pmId: z.string().min(1).max(128),
  optedOut: z.boolean(),
});

export const setPmFeatureOptOut = onCall(CALLABLE_OPTS, async (req) => {
  const tradieId = requireRole(req, "tradesperson");
  const parsed = OptOutInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid request.");
  const { pmId, optedOut } = parsed.data;

  const optRef = db.doc(`users/${tradieId}/pmFeatureOptOuts/${pmId}`);

  if (!optedOut) {
    // Opt back in (lets the PM feature them again; does NOT auto-re-feature).
    await optRef.delete();
    logger.info("setPmFeatureOptOut: opted back in", { tradieId, pmId });
    return { ok: true as const };
  }

  await optRef.set({ optedOutAt: FieldValue.serverTimestamp() });
  // Pull them off the PM's public profile now.
  const profileRef = db.doc(`projectManagers/${pmId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(profileRef);
    if (!snap.exists) return;
    const featured = currentFeatured(snap.data());
    if (featured.some((c) => c.tradieId === tradieId)) {
      tx.update(profileRef, {
        featuredContractors: featured.filter((c) => c.tradieId !== tradieId),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });
  await db.doc(`users/${tradieId}/featuredByPms/${pmId}`).delete();

  logger.info("setPmFeatureOptOut: opted out", { tradieId, pmId });
  return { ok: true as const };
});
