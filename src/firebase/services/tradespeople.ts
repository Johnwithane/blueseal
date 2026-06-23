import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit as fbLimit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  GeoPoint,
  type Timestamp,
} from "firebase/firestore";
import { geohashForLocation, geohashQueryBounds, distanceBetween } from "geofire-common";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import type {
  TradespersonContact,
  TradespersonDoc,
  WithId,
  WeeklyAvailability,
} from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const tradieRef = (uid: string) =>
  doc(db, "tradespeople", uid).withConverter(typedConverter<TradespersonDoc>());

// Private contact subdoc — exact location + (home) address + billing details.
// Owner + admin only (firestore.rules). See TradespersonContact.
const contactRef = (uid: string) => doc(db, "tradespeople", uid, "private", "contact");

// Coarsen an exact coordinate to ~2 decimals (~1.1 km) for the public doc.
// Enough for "tradies within N km" discovery; not enough to find a home.
const toApprox = (n: number): number => Math.round(n * 100) / 100;

const tradiesCol = () =>
  collection(db, "tradespeople").withConverter(typedConverter<TradespersonDoc>());

export const emptyAvailability = (): WeeklyAvailability => ({
  mon: [],
  tue: [],
  wed: [],
  thu: [],
  fri: [],
  sat: [],
  sun: [],
});

export async function getTradesperson(uid: string): Promise<WithId<TradespersonDoc> | null> {
  const snap = await getDoc(tradieRef(uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Soft cap on how many visible-tradie docs we pull per search. At MVP
// scale (dozens-to-low-hundreds of visible tradies) this is cheap enough
// to filter client-side, which buys us case-insensitive substring
// matching without an external search index. Bump to Algolia/Typesense
// once we cross ~1k visible tradies.
const TRADIE_SEARCH_FETCH_CAP = 500;

/**
 * Case-insensitive substring search of visible tradespeople by
 * `displayName`. Used by the vouch dialog so users find people already
 * on Blue Seal before falling back to an email invite. Firestore's range
 * query is case-sensitive AND prefix-only, so we instead pull all
 * visible tradies (capped) and filter in memory — "sam" matches "Sam
 * Patel" and "Patel" matches "Sam Patel".
 *
 * The `isVisible == true` filter is mandatory: /tradespeople rules deny
 * read on hidden docs, and Firestore aborts the whole query if any row
 * is rule-blocked.
 *
 * Prefix matches rank above substring matches so "sam" → "Sam Patel"
 * lands above "Joe Sampson". Caller passes the typed query unmodified.
 */
export async function searchVisibleTradiesByName(
  q: string,
  max = 8,
): Promise<WithId<TradespersonDoc>[]> {
  const trimmed = q.trim();
  if (!trimmed) return [];
  const needle = trimmed.toLowerCase();
  const snap = await getDocs(
    query(
      tradiesCol(),
      where("isVisible", "==", true),
      orderBy("displayName"),
      fbLimit(TRADIE_SEARCH_FETCH_CAP),
    ),
  );
  const matches: Array<{ doc: WithId<TradespersonDoc>; rank: number }> = [];
  for (const d of snap.docs) {
    const data = d.data();
    const name = (data.displayName ?? "").toLowerCase();
    if (!name) continue;
    if (name.startsWith(needle)) matches.push({ doc: { id: d.id, ...data }, rank: 0 });
    else if (name.includes(needle)) matches.push({ doc: { id: d.id, ...data }, rank: 1 });
  }
  matches.sort((a, b) => a.rank - b.rank);
  return matches.slice(0, max).map((m) => m.doc);
}

// Live subscription to a tradesperson doc. Used by the global status banner
// so the banner clears (or changes) the instant an admin updates vetting.
// Emits `null` if the doc doesn't exist (e.g. user just added the role).
export function subscribeTradesperson(
  uid: string,
  cb: (tradie: WithId<TradespersonDoc> | null) => void,
): () => void {
  return onSnapshot(
    tradieRef(uid),
    (snap) => {
      cb(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    },
    (err) => console.warn(`[Firestore] tradespeople/${uid} listener:`, err.code, err.message),
  );
}

export async function createOrUpdateDraft(
  uid: string,
  draft: Partial<TradespersonDoc>,
): Promise<void> {
  const ref = tradieRef(uid);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    await updateDoc(doc(db, "tradespeople", uid), { ...draft });
    return;
  }
  await setDoc(ref, {
    displayName: "",
    photoURL: null,
    companyName: null,
    languages: [],
    bio: "",
    trades: [],
    yearsExperience: {},
    pricingModel: "both",
    hourlyRate: null,
    travelRate: null,
    providesFreeQuotes: true,
    locationApprox: new GeoPoint(0, 0),
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
    idVerified: false,
    insuranceVerified: false,
    insuranceExpiresAt: null,
    wsibVerified: false,
    wsibExpiresAt: null,
    vettingStatus: "draft",
    vettingNotes: "",
    isVisible: false,
    // Owner-controlled listing switch — public by default. Independent of
    // isVisible (the server eligibility gate); see TradespersonDoc.discoverable
    // and setDiscoverable below.
    discoverable: true,
    weeklyAvailability: emptyAvailability(),
    nextInvoiceNumber: 1,
    nextQuoteNumber: 1,
    invoicePrefix: "INV",
    quotePrefix: "Q",
    companyLogoUrl: null,
    paymentInstructions: "",
    submittedAt: null,
    approvedAt: null,
    ...draft,
  });
}

// Save the service-area point. The EXACT coordinate (+ optional address label)
// goes to the private contact subdoc; only a coarse approximation + a length-6
// geohash land on the public doc for proximity search. Written together in a
// batch so the two never drift. `label` is the human-readable address for the
// pin (stored only in the private subdoc).
export async function setLocation(
  uid: string,
  lat: number,
  lng: number,
  label?: string,
): Promise<void> {
  const geohashPublic = geohashForLocation([lat, lng]).slice(0, 6);
  const batch = writeBatch(db);
  batch.set(
    contactRef(uid),
    {
      location: new GeoPoint(lat, lng),
      ...(label !== undefined ? { primaryAddressText: label } : {}),
    },
    { merge: true },
  );
  batch.set(
    doc(db, "tradespeople", uid),
    { locationApprox: new GeoPoint(toApprox(lat), toApprox(lng)), geohashPublic },
    { merge: true },
  );
  await batch.commit();
}

// Read the private contact subdoc (owner/admin). Returns null when it hasn't
// been created yet (tradie hasn't set a location/address).
export async function getTradespersonContact(
  uid: string,
): Promise<TradespersonContact | null> {
  const snap = await getDoc(contactRef(uid));
  return snap.exists() ? (snap.data() as TradespersonContact) : null;
}

// Save the billing-side contact fields (address override, phone, GST) to the
// private subdoc. primaryAddressText is set via setLocation alongside the pin.
export async function setContactInfo(
  uid: string,
  info: Partial<Pick<TradespersonContact, "businessAddress" | "businessPhone" | "gstNumber">>,
): Promise<void> {
  await setDoc(contactRef(uid), info, { merge: true });
}

export async function submitForReview(uid: string): Promise<void> {
  await updateDoc(doc(db, "tradespeople", uid), {
    vettingStatus: "pending",
    submittedAt: serverTimestamp(),
  });
}

// Pulls a `pending` application back to `draft` so the tradesperson can edit
// it. Rules allow pending → draft (firestore.rules § tradespeople update).
// Use only for the explicit "Withdraw to edit" path — autosave must never
// silently demote a submission.
export async function withdrawFromReview(uid: string): Promise<void> {
  await updateDoc(doc(db, "tradespeople", uid), {
    vettingStatus: "draft",
  });
}

export async function setWeeklyAvailability(
  uid: string,
  availability: WeeklyAvailability,
): Promise<void> {
  await updateDoc(doc(db, "tradespeople", uid), { weeklyAvailability: availability });
}

// Owner-controlled "show me in search" switch. `false` takes the tradesperson
// out of the Find-a-tradesperson search/browse (searchTradespeople filters it
// out) and marks the public profile noindex — without touching vetting state
// or the server-managed isVisible gate. Flip it back to `true` to relist.
// firestore.rules leaves `discoverable` owner-writable (it's not in the
// server-managed field-lock list), so this is a plain client write.
export async function setDiscoverable(uid: string, discoverable: boolean): Promise<void> {
  await updateDoc(doc(db, "tradespeople", uid), { discoverable });
}

// Capped at 12 in the editor UI — the public profile renders them in a
// 4-column grid which starts to look crowded above that. Bump if the
// design changes.
export const PORTFOLIO_MAX = 12;

export async function setPortfolioPhotos(uid: string, photos: string[]): Promise<void> {
  await updateDoc(doc(db, "tradespeople", uid), { portfolioPhotos: photos });
}

export type AvailabilityFilter = "any" | "today" | "this_week";

interface SearchOpts {
  trade?: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  minRating?: number;
  availability?: AvailabilityFilter;
  limit?: number;
}

// Day-of-week keys on WeeklyAvailability are stored Mon..Sun. JS
// Date.getDay() returns 0=Sun..6=Sat, so we re-key for lookup.
const DOW_KEYS: Array<keyof WeeklyAvailability> = [
  "sun", "mon", "tue", "wed", "thu", "fri", "sat",
];

function hasAvailabilityToday(a: WeeklyAvailability | undefined): boolean {
  if (!a) return false;
  const key = DOW_KEYS[new Date().getDay()];
  return (a[key]?.length ?? 0) > 0;
}

function hasAvailabilityThisWeek(a: WeeklyAvailability | undefined): boolean {
  if (!a) return false;
  const today = new Date().getDay();
  // Check today + the next 6 days (rolling week, not Sun..Sat).
  for (let offset = 0; offset < 7; offset++) {
    const key = DOW_KEYS[(today + offset) % 7];
    if ((a[key]?.length ?? 0) > 0) return true;
  }
  return false;
}

/** Geohash bounding-box search; precise distance filter applied client-side. */
export async function searchTradespeople(
  opts: SearchOpts,
): Promise<Array<WithId<TradespersonDoc> & { distanceKm: number }>> {
  const center: [number, number] = [opts.centerLat, opts.centerLng];
  const radiusMeters = opts.radiusKm * 1000;
  const bounds = geohashQueryBounds(center, radiusMeters);

  const queries = bounds.map((b) =>
    query(
      tradiesCol(),
      where("isVisible", "==", true),
      orderBy("geohashPublic"),
      where("geohashPublic", ">=", b[0]),
      where("geohashPublic", "<=", b[1]),
    ),
  );

  const snaps = await Promise.all(queries.map((q) => getDocs(q)));
  const seen = new Set<string>();
  const out: Array<WithId<TradespersonDoc> & { distanceKm: number }> = [];

  for (const snap of snaps) {
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const data = d.data();
      // Owner has hidden themselves from search (discoverable === false).
      // Filtered client-side (not in the Firestore query) so a MISSING field
      // on pre-cutover docs counts as discoverable — `where("discoverable",
      // "==", true)` would instead drop every un-backfilled tradie. Not a
      // security boundary (the doc is still readable by direct link); it's the
      // listing preference, matching the read-gate split documented on
      // TradespersonDoc.discoverable.
      if (data.discoverable === false) continue;
      const distKm = distanceBetween(center, [
        data.locationApprox.latitude,
        data.locationApprox.longitude,
      ]);
      if (distKm > opts.radiusKm) continue;
      if (opts.minRating && data.ratingAvg < opts.minRating) continue;
      if (opts.trade && !data.trades.includes(opts.trade)) continue;
      if (opts.availability === "today" && !hasAvailabilityToday(data.weeklyAvailability)) continue;
      if (opts.availability === "this_week" && !hasAvailabilityThisWeek(data.weeklyAvailability)) continue;
      out.push({ id: d.id, ...data, distanceKm: distKm });
    }
  }

  out.sort((a, b) => a.distanceKm - b.distanceKm);
  return opts.limit ? out.slice(0, opts.limit) : out;
}

// Admin one-shot: migrate every tradesperson to the F1 public/private split —
// exact location + address out of the world-readable doc and into
// private/contact, coarse search fields onto the public doc. Required after
// the F1 deploy (search returns nothing for un-migrated tradies). Idempotent.
export interface BackfillTradieContactResult {
  scanned: number;
  migrated: number;
  skipped: number;
  pages: number;
}

export async function backfillTradieContact(): Promise<BackfillTradieContactResult> {
  const callable = httpsCallable<undefined, BackfillTradieContactResult>(
    functions,
    "backfillTradieContact",
  );
  const { data } = await callable();
  return data;
}

export async function listPendingApplications(): Promise<WithId<TradespersonDoc>[]> {
  const q = query(
    tradiesCol(),
    where("vettingStatus", "==", "pending"),
    orderBy("submittedAt", "asc"),
    fbLimit(100),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Apps where the admin approved the application but isVisible is still
 * false — meaning ID or at least one cert isn't approved yet, so the
 * profile isn't actually live. These would otherwise vanish from the
 * vetting queue and trap the tradesperson in purgatory.
 */
export async function listIncompleteApprovals(): Promise<WithId<TradespersonDoc>[]> {
  const q = query(
    tradiesCol(),
    where("vettingStatus", "==", "approved"),
    where("isVisible", "==", false),
    fbLimit(100),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// --- Vanity profile handle (Pro) --------------------------------------------

// Resolve a vanity handle to a tradesperson uid via the public profileSlugs
// registry (doc id == slug). Returns null when the handle is unclaimed.
export async function resolveSlugToUid(slug: string): Promise<string | null> {
  const snap = await getDoc(doc(db, "profileSlugs", slug.trim().toLowerCase()));
  return snap.exists() ? ((snap.data().uid as string | undefined) ?? null) : null;
}

// Pro: claim/change the signed-in tradesperson's vanity handle. The callable
// enforces uniqueness + the Pro gate; it throws BLUESEAL_PRO_REQUIRED (caught by
// the global paywall) for non-Pro users and a friendly message when taken.
export async function claimProfileSlug(slug: string): Promise<{ slug: string }> {
  const callable = httpsCallable<{ slug: string }, { slug: string }>(functions, "claimProfileSlug");
  const { data } = await callable({ slug });
  return data;
}

// A tradesperson who started onboarding (a tradie doc exists) but never
// submitted for vetting — still stuck at "draft". The signup time and contact
// email live on the users/{uid} doc (the tradie doc has neither), so each row
// is joined to it. Admin-only surface; admins can read both collections.
export interface IncompleteOnboardingRow {
  uid: string;
  displayName: string;
  email: string | null;
  trades: string[];
  /** Signup time, from users/{uid}.createdAt. Null if the user doc is gone. */
  signedUpAt: Timestamp | null;
  onboardingNudgedAt: Timestamp | null;
  onboardingNudgeCount: number;
}

const INCOMPLETE_ONBOARDING_CAP = 200;

/** Lightweight count for the admin dashboard tile (no user-doc joins). */
export async function countIncompleteOnboarding(): Promise<number> {
  const snap = await getCountFromServer(
    query(tradiesCol(), where("vettingStatus", "==", "draft")),
  );
  return snap.data().count;
}

export async function listIncompleteOnboarding(): Promise<IncompleteOnboardingRow[]> {
  const snap = await getDocs(
    query(tradiesCol(), where("vettingStatus", "==", "draft"), fbLimit(INCOMPLETE_ONBOARDING_CAP)),
  );
  const rows = await Promise.all(
    snap.docs.map(async (d) => {
      const t = d.data();
      const userSnap = await getDoc(doc(db, "users", d.id));
      const u = userSnap.exists()
        ? (userSnap.data() as { email?: string; displayName?: string; createdAt?: Timestamp })
        : null;
      return {
        uid: d.id,
        displayName: u?.displayName || t.displayName || "Unnamed",
        email: u?.email ?? null,
        trades: t.trades ?? [],
        signedUpAt: u?.createdAt ?? null,
        onboardingNudgedAt: t.onboardingNudgedAt ?? null,
        onboardingNudgeCount: t.onboardingNudgeCount ?? 0,
      };
    }),
  );
  // Oldest signups first — those have been stalled longest and are the most
  // overdue for a nudge.
  rows.sort((a, b) => (a.signedUpAt?.toMillis() ?? 0) - (b.signedUpAt?.toMillis() ?? 0));
  return rows;
}

/**
 * Email a stalled tradesperson a "finish your application" nudge. Server-side
 * callable (`nudgeOnboarding`) does the send + records the nudge on their doc.
 */
export async function nudgeOnboarding(uid: string): Promise<{ ok: boolean; sentTo: string }> {
  const callable = httpsCallable<{ uid: string }, { ok: boolean; sentTo: string }>(
    functions,
    "nudgeOnboarding",
  );
  const { data } = await callable({ uid });
  return data;
}
