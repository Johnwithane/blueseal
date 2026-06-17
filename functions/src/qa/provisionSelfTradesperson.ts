import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { GeoPoint } from "firebase-admin/firestore";
import { z } from "zod";
import { CALLABLE_OPTS } from "../lib/callable";
import { adminAuth, db } from "../lib/admin";
import { logAdminAction } from "../lib/audit";
import { newTradieDocDefaults } from "../lib/tradieProfile";
import { deriveGeohashes } from "../jobPosts/helpers";
import { TRADE_KEYS } from "../seed/seededProspectSchema";
import { assertQaProvisioningAllowed } from "./guard";

// Default service-area centroid for a freshly-provisioned QA profile: downtown
// Kelowna, BC (the Okanagan founding market). Gives the tester a usable service
// area immediately, so they appear in client search and can browse the job
// board without first walking the onboarding "Area" step. Only applied when the
// doc has no location yet — re-provisioning never clobbers an area the tester
// configured themselves.
const DEFAULT_LAT = 49.888;
const DEFAULT_LNG = -119.496;

// Self-scoped: roles granted are always exactly these (never admin). qa is
// included so the tester keeps the toolkit after provisioning.
const QA_ROLES = ["client", "tradesperson", "qa"] as const;

const Input = z.object({
  trades: z
    .array(z.enum(TRADE_KEYS))
    .min(1)
    .max(TRADE_KEYS.length)
    .refine((t) => new Set(t).size === t.length, "Trades must be unique"),
});

/**
 * QA self-serve: turn the caller's own account into an approved, visible
 * tradesperson on the chosen trades, so a tester can exercise the full
 * post-vetting experience (appear in search, browse + apply to job posts) in one
 * click. Mirrors `ensureAdminTestingProfile` but: caller-scoped only, NEVER
 * grants admin, and is parameterized by trades. The trust/visibility fields are
 * written directly via the Admin SDK (which bypasses the owner-write lock and
 * reproduces the `maybeMarkVisible` eligibility without waiting on the trigger).
 */
export const qaProvisionSelfTradesperson = onCall(CALLABLE_OPTS, async (req) => {
  const uid = assertQaProvisioningAllowed(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Pick at least one trade.");
  const trades = Array.from(new Set(parsed.data.trades));

  // 1. Roles → claims + user doc. Union the caller's existing roles with
  //    client + tradesperson + qa (never admin). This is the only non-admin
  //    path that writes the qa claim — but the caller already HOLDS qa (the
  //    guard checked), so it grants no new privilege.
  const authUser = await adminAuth.getUser(uid);
  const existingClaims = (authUser.customClaims ?? {}) as Record<string, unknown>;
  const existingClaimRoles = Array.isArray(existingClaims.roles)
    ? (existingClaims.roles as unknown[]).filter((r): r is string => typeof r === "string")
    : [];
  const roles = Array.from(new Set([...existingClaimRoles, ...QA_ROLES]));
  await adminAuth.setCustomUserClaims(uid, {
    ...existingClaims,
    roles,
    role: typeof existingClaims.role === "string" ? existingClaims.role : "tradesperson",
  });

  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  const userData = (userSnap.exists ? userSnap.data() ?? {} : {}) as {
    activeRole?: unknown;
    displayName?: unknown;
    photoURL?: unknown;
  };
  // Keep the tester's current view-mode if it's a real view; otherwise land them
  // in the tradesperson view. Never "qa" (it isn't a view-mode).
  const activeRole =
    typeof userData.activeRole === "string" && userData.activeRole !== "qa"
      ? userData.activeRole
      : "tradesperson";
  await userRef.set({ roles, activeRole }, { merge: true });

  // 2. tradespeople/{uid}: approved + visible, chosen trades marked verified,
  //    tagged isQa so the data can be swept before launch.
  const displayName = typeof userData.displayName === "string" ? userData.displayName : "";
  const photoURL = typeof userData.photoURL === "string" ? userData.photoURL : null;
  const tradieRef = db.doc(`tradespeople/${uid}`);
  const tradieSnap = await tradieRef.get();
  const existing = (tradieSnap.exists ? tradieSnap.data() ?? {} : {}) as {
    locationApprox?: GeoPoint | null;
  };

  const patch: Record<string, unknown> = tradieSnap.exists
    ? {
        isVisible: true,
        vettingStatus: "approved",
        idVerified: true,
        displayName,
        photoURL,
        trades,
        verifiedTrades: trades,
        isQa: true,
      }
    : {
        ...newTradieDocDefaults({ displayName, photoURL, approved: true }),
        trades,
        verifiedTrades: trades,
        isQa: true,
      };

  // Default service area only when there's no usable location yet (0,0 is the
  // "not set" sentinel) — don't overwrite an area the tester chose in onboarding.
  const hasLocation =
    existing.locationApprox != null && (existing.locationApprox.latitude ?? 0) !== 0;
  if (!hasLocation) {
    patch.locationApprox = new GeoPoint(DEFAULT_LAT, DEFAULT_LNG);
    patch.geohashPublic = deriveGeohashes(DEFAULT_LAT, DEFAULT_LNG).geohashPublic;
  }

  await tradieRef.set(patch, { merge: true });

  await logAdminAction({
    actorUid: uid,
    action: "qaProvisionSelfTradesperson",
    targetType: "tradesperson",
    targetId: uid,
    metadata: { trades },
  });
  logger.info("qaProvisionSelfTradesperson", { uid, trades });
  return { ok: true, roles, trades };
});
