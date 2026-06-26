// Project-manager PUBLIC profile (P5): the PM-owned projectManagers/{uid} doc behind
// /pm/<slug>. The PM edits brand/bio/visibility from the cockpit; the vanity slug is
// claimed via the claimPmProfileSlug callable (server-managed). Mirrors the
// tradesperson profile + slug services, simplified (no vetting / reviews / portfolio).
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Timestamp,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import { typedConverter } from "@/firebase/converters";
import type { ProjectManagerProfileDoc, WithId } from "@/firebase/interfaces";

const profileRef = (uid: string) =>
  doc(db, "projectManagers", uid).withConverter(typedConverter<ProjectManagerProfileDoc>());

export async function getPmProfile(uid: string): Promise<WithId<ProjectManagerProfileDoc> | null> {
  const snap = await getDoc(profileRef(uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function subscribePmProfile(
  uid: string,
  cb: (profile: WithId<ProjectManagerProfileDoc> | null) => void,
): () => void {
  return onSnapshot(profileRef(uid), (snap) =>
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
  );
}

// Owner upsert of the editable fields. Creates the doc with defaults (unpublished)
// on first edit; `slug` is never written here (server-managed by claimPmProfileSlug).
export async function createOrUpdatePmProfile(
  uid: string,
  patch: Partial<
    Pick<
      ProjectManagerProfileDoc,
      | "displayName"
      | "photoURL"
      | "companyName"
      | "bio"
      | "brandColor"
      | "companyLogoUrl"
      | "coverUrl"
      | "isVisible"
    >
  >,
): Promise<void> {
  const ref = profileRef(uid);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    await updateDoc(doc(db, "projectManagers", uid), {
      ...patch,
      updatedAt: serverTimestamp() as never,
    });
    return;
  }
  await setDoc(ref, {
    displayName: patch.displayName ?? null,
    photoURL: patch.photoURL ?? null,
    companyName: patch.companyName ?? null,
    bio: patch.bio ?? "",
    brandColor: patch.brandColor ?? null,
    companyLogoUrl: patch.companyLogoUrl ?? null,
    coverUrl: patch.coverUrl ?? null,
    isVisible: patch.isVisible ?? false,
    createdAt: serverTimestamp() as never,
    updatedAt: serverTimestamp() as never,
  });
}

/** Resolve a /pm/<slug> handle to the PM uid (world-readable registry). */
export async function resolvePmSlugToUid(slug: string): Promise<string | null> {
  const snap = await getDoc(doc(db, "pmProfileSlugs", slug.trim().toLowerCase()));
  return snap.exists() ? ((snap.data().uid as string | undefined) ?? null) : null;
}

export async function claimPmProfileSlug(slug: string): Promise<{ slug: string }> {
  const callable = httpsCallable<{ slug: string }, { slug: string }>(
    functions,
    "claimPmProfileSlug",
  );
  const { data } = await callable({ slug });
  return data;
}

// ── Featured contractors (P5b) ───────────────────────────────────────────────

/** PM features/unfeatures a saved, visible contractor on their public profile. */
export async function setFeaturedContractor(
  tradieId: string,
  featured: boolean,
): Promise<{ ok: true }> {
  const fn = httpsCallable<{ tradieId: string; featured: boolean }, { ok: true }>(
    functions,
    "setFeaturedContractor",
  );
  const { data } = await fn({ tradieId, featured });
  return data;
}

/** Contractor opts out of (or back into) being featured on a given PM's profile. */
export async function setPmFeatureOptOut(
  pmId: string,
  optedOut: boolean,
): Promise<{ ok: true }> {
  const fn = httpsCallable<{ pmId: string; optedOut: boolean }, { ok: true }>(
    functions,
    "setPmFeatureOptOut",
  );
  const { data } = await fn({ pmId, optedOut });
  return data;
}

export interface FeaturedByPm {
  id: string; // pmId
  pmName: string | null;
  featuredAt: Timestamp | null;
}

/** The PMs featuring this tradesperson (reverse index), for the contractor's view. */
export function subscribeFeaturedByPms(
  tradieUid: string,
  cb: (rows: FeaturedByPm[]) => void,
): () => void {
  return onSnapshot(collection(db, "users", tradieUid, "featuredByPms"), (snap) =>
    cb(
      snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          pmName: (data.pmName as string | undefined) ?? null,
          featuredAt: (data.featuredAt as Timestamp | undefined) ?? null,
        };
      }),
    ),
  );
}
