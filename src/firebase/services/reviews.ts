import {
  addDoc,
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "@/firebase/config";
import type { ClientReviewDoc, ReviewDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const reviewsCol = () => collection(db, "reviews").withConverter(typedConverter<ReviewDoc>());
const clientReviewsCol = () =>
  collection(db, "clientReviews").withConverter(typedConverter<ClientReviewDoc>());

export async function createReview(
  input: Omit<ReviewDoc, "createdAt" | "status">,
): Promise<string> {
  const ref = await addDoc(reviewsCol(), {
    ...input,
    createdAt: serverTimestamp() as never,
    status: "active",
  });
  return ref.id;
}

export async function listReviewsFor(tradieUid: string): Promise<WithId<ReviewDoc>[]> {
  const q = query(
    reviewsCol(),
    where("tradespersonId", "==", tradieUid),
    where("status", "==", "active"),
    orderBy("createdAt", "desc"),
    limit(50),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function createClientReview(
  input: Omit<ClientReviewDoc, "createdAt">,
): Promise<string> {
  const ref = await addDoc(clientReviewsCol(), {
    ...input,
    createdAt: serverTimestamp() as never,
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
