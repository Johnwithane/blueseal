import { FieldValue } from "firebase-admin/firestore";

/**
 * Canonical default shape for a freshly-provisioned `tradespeople/{uid}` doc.
 *
 * This used to be copy-pasted across `addRoleToSelf` (draft) and
 * `grantAllRolesForAdminTesting` (approved). Centralizing it keeps the two
 * paths in sync and fixes a latent gap where the approved path omitted
 * `companyName` / `languages`.
 *
 * - `approved: false` → draft, hidden, unverified (the normal "become a
 *   tradesperson" entry point; the user still has to pass vetting to go live).
 * - `approved: true` → visible, approved, ID-verified (admin testing /
 *   dogfooding, where the vetting gate is intentionally bypassed).
 *
 * Written via the Admin SDK only, so the owner-create rules (which require a
 * draft/hidden doc) don't apply to the `approved: true` variant.
 */
export function newTradieDocDefaults(opts: {
  displayName?: string | null;
  photoURL?: string | null;
  approved: boolean;
}): Record<string, unknown> {
  const approved = opts.approved;
  return {
    // Denormalized from the user doc so the public profile renders the tradie's
    // name + photo without read access to /users/.
    displayName: typeof opts.displayName === "string" ? opts.displayName : "",
    photoURL: opts.photoURL ?? null,
    companyName: null,
    languages: [],
    bio: approved ? "Admin testing profile." : "",
    trades: [],
    yearsExperience: {},
    pricingModel: "quote",
    hourlyRate: null,
    providesFreeQuotes: true,
    // Exact location + address are private (contact subdoc), created lazily on
    // setLocation. Public doc carries only coarse search fields, unset until then.
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
    idVerified: approved,
    vettingStatus: approved ? "approved" : "draft",
    vettingNotes: approved ? "Admin testing grant." : "",
    isVisible: approved,
    weeklyAvailability: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
    nextInvoiceNumber: 1,
    nextQuoteNumber: 1,
    invoicePrefix: "INV",
    quotePrefix: "Q",
    companyLogoUrl: null,
    paymentInstructions: "",
    submittedAt: approved ? FieldValue.serverTimestamp() : null,
    approvedAt: approved ? FieldValue.serverTimestamp() : null,
    createdAt: FieldValue.serverTimestamp(),
  };
}
