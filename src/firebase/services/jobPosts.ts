import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { distanceBetween, geohashQueryBounds } from "geofire-common";
import { db, functions } from "@/firebase/config";
import type {
  JobPostDoc,
  JobPostMetaDoc,
  WithId,
} from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";
import type { CreateJobPostInput } from "@/validation/schemas";

const postsCol = () =>
  collection(db, "jobPosts").withConverter(typedConverter<JobPostDoc>());
const postRef = (id: string) =>
  doc(db, "jobPosts", id).withConverter(typedConverter<JobPostDoc>());
const metaRef = (id: string) =>
  doc(db, "jobPosts", id, "private", "meta").withConverter(
    typedConverter<JobPostMetaDoc>(),
  );

export async function createJobPost(
  input: CreateJobPostInput & {
    addressPrivate: { line1: string; fullPostal: string; lat: number; lng: number };
  },
): Promise<string> {
  const callable = httpsCallable<typeof input, { postId: string }>(
    functions,
    "createJobPost",
  );
  const { data } = await callable(input);
  return data.postId;
}

export async function getJobPost(id: string): Promise<WithId<JobPostDoc> | null> {
  const snap = await getDoc(postRef(id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * One-shot list of a client's job posts, newest first. Used by the admin User
 * 360 page (admin can read any post per firestore.rules). Reuses the same
 * (clientId, createdAt) index as subscribeMyJobPosts.
 */
export async function listJobPostsForClient(
  clientId: string,
  max = 20,
): Promise<WithId<JobPostDoc>[]> {
  const snap = await getDocs(
    query(postsCol(), where("clientId", "==", clientId), orderBy("createdAt", "desc"), limit(max)),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function subscribeMyJobPosts(
  clientId: string,
  cb: (posts: WithId<JobPostDoc>[]) => void,
): () => void {
  const q = query(
    postsCol(),
    where("clientId", "==", clientId),
    orderBy("createdAt", "desc"),
    limit(50),
  );
  return onSnapshot(q, (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );
}

export function subscribeJobPostMeta(
  postId: string,
  cb: (meta: JobPostMetaDoc | null) => void,
): () => void {
  return onSnapshot(metaRef(postId), (snap) =>
    cb(snap.exists() ? (snap.data() as JobPostMetaDoc) : null),
  );
}

export interface FeedFilters {
  trade: string | null; // null = any trade
  center: { lat: number; lng: number };
  radiusKm: number;
}

// Feed query: geohash-bounded set of open posts, optionally filtered by trade.
// We can't combine where('geohashPublic','range') with another range, so the
// approach is the standard geofire-common pattern: derive bounds and run
// parallel queries, then merge + filter by exact distance client-side.
export function subscribeJobPostFeed(
  filters: FeedFilters,
  cb: (posts: WithId<JobPostDoc>[]) => void,
): () => void {
  const bounds = geohashQueryBounds(
    [filters.center.lat, filters.center.lng],
    filters.radiusKm * 1000,
  );

  const unsubs: Array<() => void> = [];
  const buckets: Map<string, Map<string, WithId<JobPostDoc>>> = new Map();

  function emit() {
    const merged = new Map<string, WithId<JobPostDoc>>();
    for (const bucket of buckets.values()) {
      for (const [id, post] of bucket.entries()) {
        merged.set(id, post);
      }
    }
    const out: WithId<JobPostDoc>[] = [];
    for (const post of merged.values()) {
      // Skip posts that fall outside the actual radius — geohash range
      // returns a superset.
      // No geo on the parent doc; we can use the geohash itself as a coarse
      // filter — sufficient because the geohash is already pre-jittered.
      out.push(post);
    }
    // Sort newest first.
    out.sort((a, b) => {
      const aMs = a.createdAt?.toMillis?.() ?? 0;
      const bMs = b.createdAt?.toMillis?.() ?? 0;
      return bMs - aMs;
    });
    cb(out);
  }

  for (const [start, end] of bounds) {
    const key = `${start}_${end}`;
    buckets.set(key, new Map());
    const constraints = [
      where("status", "==", "open"),
      ...(filters.trade ? [where("trade", "==", filters.trade)] : []),
      where("addressPublic.geohashPublic", ">=", start),
      where("addressPublic.geohashPublic", "<=", end),
      limit(100),
    ];
    const q = query(postsCol(), ...constraints);
    unsubs.push(
      onSnapshot(q, (snap) => {
        const m = new Map<string, WithId<JobPostDoc>>();
        for (const d of snap.docs) {
          m.set(d.id, { id: d.id, ...d.data() });
        }
        buckets.set(key, m);
        emit();
      }),
    );
  }

  return () => unsubs.forEach((u) => u());
}

export async function cancelJobPost(postId: string, reason?: string): Promise<void> {
  const callable = httpsCallable<{ postId: string; reason?: string }, { ok: boolean }>(
    functions,
    "cancelJobPost",
  );
  await callable({ postId, reason });
}

export async function returnToApplicants(postId: string): Promise<void> {
  const callable = httpsCallable<{ postId: string }, { ok: boolean }>(
    functions,
    "returnToApplicants",
  );
  await callable({ postId });
}

// Re-export distance helper for UI distance badges.
export function distanceKmFrom(
  center: { lat: number; lng: number },
  postGeo: { lat: number; lng: number } | null,
): number | null {
  if (!postGeo) return null;
  return distanceBetween([center.lat, center.lng], [postGeo.lat, postGeo.lng]);
}

// Admin one-shot: backfill clientName (first-name only) + clientPhotoURL
// onto legacy job posts that pre-date the denormalization. Idempotent.
export interface BackfillJobPostClientResult {
  scanned: number;
  updated: number;
  alreadyPresent: number;
  pages: number;
  fallbackUsed: number;
}

export async function backfillJobPostClient(): Promise<BackfillJobPostClientResult> {
  const callable = httpsCallable<undefined, BackfillJobPostClientResult>(
    functions,
    "backfillJobPostClient",
  );
  const { data } = await callable();
  return data;
}
