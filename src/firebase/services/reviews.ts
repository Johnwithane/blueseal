import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "@/firebase/config";
import type {
  ClientReviewDoc,
  ReviewDoc,
  ReviewPairDoc,
  WithId,
} from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const reviewsCol = () => collection(db, "reviews").withConverter(typedConverter<ReviewDoc>());
const clientReviewsCol = () =>
  collection(db, "clientReviews").withConverter(typedConverter<ClientReviewDoc>());
const reviewPairsCol = () =>
  collection(db, "reviewPairs").withConverter(typedConverter<ReviewPairDoc>());

export async function createReview(
  input: Omit<ReviewDoc, "createdAt" | "status" | "revealedAt">,
): Promise<string> {
  // revealedAt stays null until revealPair fires server-side. Status is
  // always "active" on create; the moderation flag is admin-only.
  const ref = await addDoc(reviewsCol(), {
    ...input,
    createdAt: serverTimestamp() as never,
    status: "active",
    revealedAt: null,
  });
  return ref.id;
}

export async function listReviewsFor(tradieUid: string): Promise<WithId<ReviewDoc>[]> {
  // Filter on `revealedAt != null` so the public tradesperson profile
  // never includes a review still inside its mutual-blind window. The
  // rule rejects the whole query if any returned doc fails the gate, so
  // this filter MUST live at the query level — client-side filtering
  // would surface permission_denied instead. orderBy("revealedAt") is
  // required by Firestore alongside the `!=` filter; it doubles as
  // "most recently revealed first," which is what a viewer wants.
  const q = query(
    reviewsCol(),
    where("tradespersonId", "==", tradieUid),
    where("status", "==", "active"),
    where("revealedAt", "!=", null),
    orderBy("revealedAt", "desc"),
    limit(50),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function createClientReview(
  input: Omit<ClientReviewDoc, "createdAt" | "revealedAt">,
): Promise<string> {
  const ref = await addDoc(clientReviewsCol(), {
    ...input,
    createdAt: serverTimestamp() as never,
    revealedAt: null,
  });
  return ref.id;
}

export async function listClientReviewsFor(
  clientUid: string,
): Promise<WithId<ClientReviewDoc>[]> {
  const q = query(
    clientReviewsCol(),
    where("clientId", "==", clientUid),
    orderBy("createdAt", "desc"),
    limit(20),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---------------------------------------------------------------------------
// Mutual-review pair (reviewPairs/{jobId})
// One pair per completed job — created by markJobPaid / clientMarkPaid.
// The InvoiceTab subscribes to this so the UI can render the right state
// (waiting on you, waiting on them, both revealed) without polling.
// ---------------------------------------------------------------------------
export async function getReviewPair(jobId: string): Promise<WithId<ReviewPairDoc> | null> {
  const snap = await getDoc(doc(reviewPairsCol(), jobId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/** Realtime listener — UI reflects reveal the moment it lands. */
export function subscribeReviewPair(
  jobId: string,
  cb: (pair: WithId<ReviewPairDoc> | null) => void,
): () => void {
  return onSnapshot(
    doc(reviewPairsCol(), jobId),
    (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    (err) =>
      console.warn(
        `[Firestore] reviewPairs(${jobId}) listener:`,
        err.code,
        err.message,
      ),
  );
}

/** Fetch a single review by id (used after reveal to show counterparty's review). */
export async function getReviewById(
  reviewId: string,
): Promise<WithId<ReviewDoc> | null> {
  const snap = await getDoc(doc(reviewsCol(), reviewId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function getClientReviewById(
  reviewId: string,
): Promise<WithId<ClientReviewDoc> | null> {
  const snap = await getDoc(doc(clientReviewsCol(), reviewId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}
