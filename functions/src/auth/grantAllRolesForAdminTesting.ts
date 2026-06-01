import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { logger } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";

/**
 * Admin-only, idempotent callable that grants the *calling admin* all three
 * roles (client + tradesperson + admin) and ensures they have a visible,
 * approved tradespeople doc so they can exercise the full app — post jobs,
 * browse the marketplace, submit applications, etc.
 *
 * Intended purely for testing / staff dogfooding. The vetting gate that
 * applies to real client→tradesperson role-adds is intentionally bypassed
 * here because admins are already trusted.
 */
export const grantAllRolesForAdminTesting = onCall(
  CALLABLE_OPTS,
  async (req) => {
    const uid = requireAdmin(req);

    // Roles → claims + user doc. Always include all three for a clean state.
    const allRoles = ["client", "tradesperson", "admin"];

    const authUser = await adminAuth.getUser(uid);
    const existingClaims = (authUser.customClaims ?? {}) as Record<string, unknown>;
    await adminAuth.setCustomUserClaims(uid, {
      ...existingClaims,
      roles: allRoles,
      role: "admin",
    });

    const userRef = db.doc(`users/${uid}`);
    const userSnap = await userRef.get();
    const userData = (userSnap.exists ? userSnap.data() ?? {} : {}) as {
      activeRole?: unknown;
      displayName?: unknown;
      photoURL?: unknown;
    };
    const activeRole =
      typeof userData.activeRole === "string" ? userData.activeRole : "admin";
    await userRef.set(
      { roles: allRoles, activeRole, role: "admin" },
      { merge: true },
    );

    // Denormalized fields for the public tradesperson profile.
    const displayName =
      typeof userData.displayName === "string" ? userData.displayName : "";
    const photoURL =
      typeof userData.photoURL === "string" ? userData.photoURL : null;

    // Visible, approved tradesperson doc so the admin can be discovered in
    // search and can browse job posts (isVisibleTradie check passes).
    const tradieRef = db.doc(`tradespeople/${uid}`);
    const tradieSnap = await tradieRef.get();
    if (!tradieSnap.exists) {
      await tradieRef.set({
        displayName,
        photoURL,
        bio: "Admin testing profile.",
        trades: [],
        yearsExperience: {},
        pricingModel: "quote",
        hourlyRate: null,
        providesFreeQuotes: true,
        // Exact location + address are private (contact subdoc), created
        // lazily on setLocation. Public doc carries only coarse search fields.
        locationApprox: null,
        geohashPublic: "",
        serviceRadiusKm: 25,
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
        idVerified: true,
        vettingStatus: "approved",
        vettingNotes: "Admin testing grant.",
        isVisible: true,
        weeklyAvailability: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
        nextInvoiceNumber: 1,
        nextQuoteNumber: 1,
        invoicePrefix: "INV",
        quotePrefix: "Q",
        companyLogoUrl: null,
        paymentInstructions: "",
        submittedAt: FieldValue.serverTimestamp(),
        approvedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      });
    } else {
      await tradieRef.set(
        {
          isVisible: true,
          vettingStatus: "approved",
          idVerified: true,
          displayName,
          photoURL,
        },
        { merge: true },
      );
    }

    logger.info("Granted all roles for admin testing", { uid });
    return { ok: true, roles: allRoles };
  },
);

// Defensive: don't let this slip into a non-admin's reach even if claims drift.
// The requireAdmin check above already enforces it; this is for grep/audit.
void HttpsError;
