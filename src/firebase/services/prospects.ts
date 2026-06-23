// Client service for seeded prospect listings.
//   - searchProspects / getProspect: the read surface (Phase 2). Prospects are
//     surfaced in search alongside verified tradespeople but rendered with a
//     "Pending verification" badge and no trust UI.
//   - bulkImportProspects: admin import wrapper (Phase 1).
// Outreach + claim wrappers arrive in later phases.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { distanceBetween, geohashQueryBounds } from "geofire-common";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import { typedConverter } from "@/firebase/converters";
import type { ProspectContact, ProspectDoc, WithId } from "@/firebase/interfaces";
import { compressToWebp } from "@/utils/image";
import { makeStoragePath, uploadFile } from "@/firebase/services/storage";

const prospectsCol = () =>
  collection(db, "prospects").withConverter(typedConverter<ProspectDoc>());

export interface ProspectSearchOpts {
  trade?: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  limit?: number;
}

/**
 * Geohash bounding-box search of LISTED prospects; precise distance filter
 * applied client-side. A near-copy of searchTradespeople (rating/availability
 * filters dropped — seeded listings have neither). The `isListed == true`
 * filter is mandatory: /prospects rules deny read on unlisted (suppressed)
 * docs, and Firestore aborts the whole query if any row is rule-blocked.
 */
export async function searchProspects(
  opts: ProspectSearchOpts,
): Promise<Array<WithId<ProspectDoc> & { distanceKm: number }>> {
  const center: [number, number] = [opts.centerLat, opts.centerLng];
  const radiusMeters = opts.radiusKm * 1000;
  const bounds = geohashQueryBounds(center, radiusMeters);

  const queries = bounds.map((b) =>
    query(
      prospectsCol(),
      where("isListed", "==", true),
      orderBy("geohashPublic"),
      where("geohashPublic", ">=", b[0]),
      where("geohashPublic", "<=", b[1]),
    ),
  );

  const snaps = await Promise.all(queries.map((q) => getDocs(q)));
  const seen = new Set<string>();
  const out: Array<WithId<ProspectDoc> & { distanceKm: number }> = [];

  for (const snap of snaps) {
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const data = d.data();
      const distKm = distanceBetween(center, [
        data.locationApprox.latitude,
        data.locationApprox.longitude,
      ]);
      if (distKm > opts.radiusKm) continue;
      if (opts.trade && !data.trades.includes(opts.trade)) continue;
      out.push({ id: d.id, ...data, distanceKm: distKm });
    }
  }

  out.sort((a, b) => a.distanceKm - b.distanceKm);
  return opts.limit ? out.slice(0, opts.limit) : out;
}

// ---------------------------------------------------------------------------
// Admin outreach tooling. These run as an admin (firestore.rules gives admins
// read/write on prospects + the private contact subdoc, and read on the leads),
// so they read Firestore directly; only the actual send goes through a callable
// (Admin SDK needed for the magic-link CTA + the Resend pipeline).
// ---------------------------------------------------------------------------

/**
 * Admin: every prospect (listed AND unlisted), newest import first. Unlike
 * searchProspects this does NOT filter on isListed — the admin tool manages the
 * whole pool, most of which is private (unlisted) by design.
 */
export async function listAllProspects(): Promise<WithId<ProspectDoc>[]> {
  const snap = await getDocs(prospectsCol());
  const out = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  // Sort newest-imported first; tolerate docs missing importedAt (sort last).
  out.sort((a, b) => (b.importedAt?.toMillis?.() ?? 0) - (a.importedAt?.toMillis?.() ?? 0));
  return out;
}

/** Admin: the harvested email/phone for a prospect (private subdoc). */
export async function getProspectContact(prospectId: string): Promise<ProspectContact | null> {
  const snap = await getDoc(doc(db, "prospects", prospectId, "private", "contact"));
  return snap.exists() ? (snap.data() as ProspectContact) : null;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Admin: set/replace a prospect's harvested contact. Email is persisted to the
 * private subdoc AND its SHA-256 written to emailHash on the public doc, so
 * claim-by-email still matches (the same derivation the import + server use).
 * Does NOT change emailConspicuouslyPublished — that stays a separate, explicit
 * assertion. Use to add an email our crawler missed before reaching out.
 */
export async function setProspectContact(
  prospectId: string,
  contact: { email?: string; phone?: string | null },
): Promise<void> {
  const contactUpdates: { prospectEmail?: string; prospectPhone?: string | null } = {};
  const prospectUpdates: { emailHash?: string } = {};
  if (contact.email !== undefined) {
    const normalized = contact.email.trim().toLowerCase();
    contactUpdates.prospectEmail = normalized;
    prospectUpdates.emailHash = normalized ? await sha256Hex(normalized) : "";
  }
  if (contact.phone !== undefined) contactUpdates.prospectPhone = contact.phone;

  const ops: Promise<unknown>[] = [];
  if (Object.keys(contactUpdates).length) {
    ops.push(
      setDoc(doc(db, "prospects", prospectId, "private", "contact"), contactUpdates, { merge: true }),
    );
  }
  if (Object.keys(prospectUpdates).length) {
    ops.push(updateDoc(doc(db, "prospects", prospectId), prospectUpdates));
  }
  await Promise.all(ops);
}

// The profile fields an admin can enrich on a seeded prospect (the crawl only
// gets us part way). All optional — only the provided keys are written.
export type ProspectProfileEdit = Partial<
  Pick<
    ProspectDoc,
    | "displayName"
    | "companyName"
    | "bio"
    | "trades"
    | "locationLabel"
    | "website"
    | "pricingModel"
    | "hourlyRate"
    | "yearsExperience"
    | "serviceRadiusKm"
    | "languages"
    | "photoURL"
    | "companyLogoUrl"
    | "bannerUrl"
    | "portfolioPhotos"
  >
>;

/** Admin: enrich a seeded prospect's public profile fields in place. */
export async function updateProspectProfile(
  prospectId: string,
  fields: ProspectProfileEdit,
): Promise<void> {
  await updateDoc(doc(db, "prospects", prospectId), { ...fields });
}

/**
 * Admin: compress + upload an image for a seeded prospect and return its public
 * download URL. Writes to prospects/{id}/{bucket} (admin-write, world-read).
 * The URL carries over to the real profile when the prospect claims.
 */
export async function uploadProspectImage(
  prospectId: string,
  file: File,
  bucket: "profile" | "logo" | "banner" | "portfolio",
  maxDimension: number,
): Promise<string> {
  const compressed = await compressToWebp(file, { maxDimension, quality: 0.9 });
  const path = makeStoragePath({ scope: "prospects", id: prospectId, bucket, filename: compressed.name });
  return uploadFile(path, compressed);
}

/**
 * Admin: assert (or retract) that the prospect's email was conspicuously
 * published — the CASL implied-consent basis sendProspectOutreach requires.
 * Setting it true is a legal assertion the admin makes after confirming the
 * email is publicly posted with no "no unsolicited mail" notice.
 */
export async function setProspectConspicuous(prospectId: string, value: boolean): Promise<void> {
  await updateDoc(doc(db, "prospects", prospectId), { emailConspicuouslyPublished: value });
}

export interface SendProspectOutreachInput {
  prospectId: string;
  subject: string;
  bodyLines: string[];
  cc?: string[];
}

/**
 * Admin: send the (manually edited) outreach email to one prospect. The server
 * appends the claim CTA + CASL footer and refuses to send unless the listing is
 * sendable (conspicuous email, not suppressed/claimed) and outreach is
 * configured (mailing address + unsub secret + email-link sign-in). Surfaces
 * the server's failed-precondition message so the UI can explain what's missing.
 */
export async function sendProspectOutreach(
  input: SendProspectOutreachInput,
): Promise<{ status: "sent"; lastOutreachAt: number }> {
  const callable = httpsCallable<SendProspectOutreachInput, { status: "sent"; lastOutreachAt: number }>(
    functions,
    "sendProspectOutreach",
  );
  const { data } = await callable(input);
  return data;
}

export async function getProspect(id: string): Promise<WithId<ProspectDoc> | null> {
  // The prospects read rule requires `isListed == true`, so a missing OR
  // unlisted/suppressed prospect is denied (not just "not found") — getDoc then
  // throws permission-denied. Callers want "no such public prospect" = null, so
  // swallow the denial here (mirrors getQuoteByJobId's missing-doc handling).
  try {
    const snap = await getDoc(
      doc(db, "prospects", id).withConverter(typedConverter<ProspectDoc>()),
    );
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch {
    return null;
  }
}

export interface ProspectRequestInput {
  prospectId: string;
  title: string;
  description: string;
  urgency: "flexible" | "this_week" | "urgent";
  address: { line1: string; city: string; region: string; postalCode: string };
}

export type ProspectRequestResult =
  | { status: "claimed"; tradespersonId: string }
  | { status: "pending_signup"; leadId: string; emailed?: boolean; alreadyRequested?: boolean };

/**
 * Client requests a seeded (unverified) prospect. Creates a held lead and — on
 * a real client request — triggers the (CASL-gated) outreach email. If the
 * prospect has already signed up, returns { status:"claimed", tradespersonId }
 * so the caller can redirect to the real profile.
 */
export async function requestProspectOutreach(
  input: ProspectRequestInput,
): Promise<ProspectRequestResult> {
  const callable = httpsCallable<ProspectRequestInput, ProspectRequestResult>(
    functions,
    "requestProspectOutreach",
  );
  const { data } = await callable(input);
  return data;
}

/**
 * Self-serve takedown for a seeded ("Unverified") listing — no account, no email
 * token. For a business owner who finds themselves listed and wants out. Errs
 * toward removal (the listing was added without their consent); the server hides
 * it immediately and tombstones it so it's never re-imported. Idempotent.
 */
export async function selfServeRemoveProspect(
  prospectId: string,
  reason?: string,
): Promise<{ status: "removed" }> {
  const callable = httpsCallable<{ prospectId: string; reason?: string }, { status: "removed" }>(
    functions,
    "selfServeRemoveProspect",
  );
  const { data } = await callable({ prospectId, reason });
  return data;
}

export type ClaimProspectResult =
  | { status: "claimed"; jobsCreated: number; prospectsClaimed: number }
  | { status: "needs_verification" }
  | { status: "none" };

/**
 * Claims the seeded prospect(s) matching the signed-in user's VERIFIED email
 * (set by magic-link sign-in). Migrates the seeded profile into their
 * tradesperson draft and converts any waiting client requests into real jobs.
 */
export async function claimProspect(): Promise<ClaimProspectResult> {
  const callable = httpsCallable<undefined, ClaimProspectResult>(functions, "claimProspect");
  const { data } = await callable();
  return data;
}

export interface BulkImportProspectsResult {
  received: number;
  imported: number; // for dryRun: the count that WOULD import
  dupeSkipped: number;
  suppressedSkipped: number;
  invalid: number;
  errors: Array<{ rowIndex: number; message: string }>;
  dryRun: boolean;
}

/**
 * Admin-only. Imports reviewed seeded-prospect rows. The server
 * (functions/src/seed/bulkImportProspects.ts) re-validates every row with Zod —
 * it is the source of truth — so the reviewed file rows are passed through
 * untyped here rather than duplicating the Zod shape on the client.
 *
 * Pass `dryRun: true` to preview counts (imported / dupeSkipped /
 * suppressedSkipped / invalid) without writing anything.
 */
export async function bulkImportProspects(
  rows: unknown[],
  dryRun = false,
  listOnImport = false,
): Promise<BulkImportProspectsResult> {
  const callable = httpsCallable<
    { rows: unknown[]; dryRun: boolean; listOnImport: boolean },
    BulkImportProspectsResult
  >(functions, "bulkImportProspects");
  const { data } = await callable({ rows, dryRun, listOnImport });
  return data;
}
