import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, db } from "../lib/admin";
import { requireAuth } from "../lib/auth";

const Input = z.object({ role: z.enum(["client", "tradesperson"]) });

/**
 * Lets a signed-in user grant themselves the other public role
 * (client ⇄ tradesperson), Airbnb-style "become a host" flow.
 *
 * - Adding "tradesperson" provisions a draft `tradespeople/{uid}` doc with
 *   `vettingStatus: "draft"` and `isVisible: false`, so the role is in the
 *   user's claims but they don't show up in search until cert + ID review
 *   passes (same gate as a fresh tradie signup).
 * - Adding "client" is unrestricted — no vetting needed.
 *
 * "admin" cannot be self-added. That stays behind `setAdminRole`.
 */
export const addRoleToSelf = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = requireAuth(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
  const { role } = parsed.data;

  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError("not-found", "User record missing.");
  const userData = userSnap.data() as {
    roles?: unknown;
    role?: unknown;
    activeRole?: unknown;
    displayName?: unknown;
    photoURL?: unknown;
  };
  const currentRoles = Array.isArray(userData.roles)
    ? (userData.roles as unknown[]).filter((r): r is string => typeof r === "string")
    : typeof userData.role === "string"
      ? [userData.role]
      : [];

  if (currentRoles.includes(role)) {
    // Already have it — no-op, but refresh claims defensively so a stale
    // token from before a prior cutover gets the right shape on next refresh.
    return { ok: true, alreadyHad: true };
  }

  const nextRoles = [...currentRoles, role];

  // For tradesperson: provision the draft tradespeople doc if it doesn't
  // already exist. This is the same shape the OnboardingWizard expects.
  if (role === "tradesperson") {
    const tradieRef = db.doc(`tradespeople/${uid}`);
    const tradieSnap = await tradieRef.get();
    if (!tradieSnap.exists) {
      await tradieRef.set({
        // Denormalized from the user doc so the public profile renders the
        // tradie's name + photo without needing read access to /users/.
        displayName: typeof userData.displayName === "string" ? userData.displayName : "",
        photoURL: typeof userData.photoURL === "string" ? userData.photoURL : null,
        companyName: null,
        languages: [],
        bio: "",
        trades: [],
        yearsExperience: {},
        pricingModel: "quote",
        hourlyRate: null,
        providesFreeQuotes: true,
        location: null,
        geohash: "",
        serviceRadiusKm: 25,
        primaryAddressText: "",
        portfolioPhotos: [],
        ratingAvg: 0,
        ratingCount: 0,
        ratingDimensions: {
          quality: { avg: 0, count: 0 },
          punctuality: { avg: 0, count: 0 },
          communication: { avg: 0, count: 0 },
          value: { avg: 0, count: 0 },
        },
        verifiedTrades: [],
        idVerified: false,
        vettingStatus: "draft",
        vettingNotes: "",
        isVisible: false,
        weeklyAvailability: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
        nextInvoiceNumber: 1,
        paymentInstructions: "",
        submittedAt: null,
        approvedAt: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  }

  // User doc first (rules check writes `roles == resource.data.roles` and
  // `activeRole in resource.data.roles` for client writes — we're going
  // through the Admin SDK here so that gate doesn't apply, but we still
  // honor the shape). Set activeRole to the newly-added role so the user
  // lands in the new view after the call.
  await userRef.set({ roles: nextRoles, activeRole: role }, { merge: true });

  // Claims next — merge with existing so admin/tenant claims survive.
  const authUser = await adminAuth.getUser(uid);
  const existing = (authUser.customClaims ?? {}) as Record<string, unknown>;
  const claimRoles = Array.from(
    new Set([
      ...(Array.isArray(existing.roles)
        ? (existing.roles as unknown[]).filter((r): r is string => typeof r === "string")
        : typeof existing.role === "string"
          ? [existing.role as string]
          : []),
      role,
    ]),
  );
  await adminAuth.setCustomUserClaims(uid, {
    ...existing,
    roles: claimRoles,
    role,
  });
  logger.info("Added role to self", { uid, role, roles: claimRoles });

  return { ok: true, roles: nextRoles, activeRole: role };
});
