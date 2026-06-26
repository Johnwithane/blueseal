// Project-manager PUBLIC profile (P5): the PM-owned projectManagers/{uid} doc behind
// /pm/<slug>. The PM edits brand/bio/visibility from the cockpit; the vanity slug is
// claimed via the claimPmProfileSlug callable (server-managed). Mirrors the
// tradesperson profile + slug services, simplified (no vetting / reviews / portfolio).
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
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
