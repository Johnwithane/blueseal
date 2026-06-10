import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import type { ApplicationDoc, ApplicationMessageDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";
import type {
  SubmitApplicationInput,
  SendApplicationMessageInput,
  ReviseApplicationInput,
} from "@/validation/schemas";

const appsCol = (postId: string) =>
  collection(db, "jobPosts", postId, "applications").withConverter(
    typedConverter<ApplicationDoc>(),
  );
const appRef = (postId: string, tradieId: string) =>
  doc(db, "jobPosts", postId, "applications", tradieId).withConverter(
    typedConverter<ApplicationDoc>(),
  );
const appThreadCol = (postId: string, tradieId: string) =>
  collection(db, "jobPosts", postId, "applications", tradieId, "messages").withConverter(
    typedConverter<ApplicationMessageDoc>(),
  );

export async function submitApplication(input: SubmitApplicationInput): Promise<void> {
  const callable = httpsCallable<SubmitApplicationInput, { ok: boolean }>(
    functions,
    "submitApplication",
  );
  await callable(input);
}

export async function withdrawApplication(postId: string): Promise<void> {
  const callable = httpsCallable<{ postId: string }, { ok: boolean }>(
    functions,
    "withdrawApplication",
  );
  await callable({ postId });
}

export async function acceptApplication(
  postId: string,
  applicationId: string,
): Promise<{ jobId: string; chatId: string }> {
  const callable = httpsCallable<
    { postId: string; applicationId: string },
    { jobId: string; chatId: string }
  >(functions, "acceptApplication");
  const { data } = await callable({ postId, applicationId });
  return data;
}

/**
 * Bid-marketplace accept: the client accepts one applicant's full itemized
 * quote. Atomically creates the job (active, or awaiting upfront payment),
 * materializes quotes/{jobId} as accepted, and rejects the other applicants.
 * Returns the new job id to navigate to.
 */
export async function acceptApplicationQuote(
  postId: string,
  applicationId: string,
  signatureDataUrl: string,
): Promise<{ jobId: string; chatId: string }> {
  const callable = httpsCallable<
    { postId: string; applicationId: string; signatureDataUrl: string },
    { jobId: string; chatId: string }
  >(functions, "acceptApplicationQuote");
  const { data } = await callable({ postId, applicationId, signatureDataUrl });
  return data;
}

export function subscribeApplicationsForPost(
  postId: string,
  cb: (apps: WithId<ApplicationDoc>[]) => void,
): () => void {
  const q = query(appsCol(postId), orderBy("createdAt", "asc"), limit(200));
  return onSnapshot(q, (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );
}

export async function getMyApplicationForPost(
  postId: string,
  tradieId: string,
): Promise<WithId<ApplicationDoc> | null> {
  const snap = await getDoc(appRef(postId, tradieId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function subscribeMyApplicationForPost(
  postId: string,
  tradieId: string,
  cb: (app: WithId<ApplicationDoc> | null) => void,
): () => void {
  return onSnapshot(appRef(postId, tradieId), (snap) =>
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
  );
}

export function subscribeMyApplications(
  tradieId: string,
  cb: (apps: WithId<ApplicationDoc>[]) => void,
): () => void {
  const q = query(
    collectionGroup(db, "applications").withConverter(typedConverter<ApplicationDoc>()),
    where("tradespersonId", "==", tradieId),
    orderBy("createdAt", "desc"),
    limit(100),
  );
  return onSnapshot(q, (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );
}

// ---------------------------------------------------------------------------
// Pre-acceptance applicant Q&A thread (jobPosts/{postId}/applications/{tradieId}
// /messages). Application-scoped negotiation — not the job chat. Reads are
// realtime + rules-gated to the two parties; all writes go through callables.
// ---------------------------------------------------------------------------

export function subscribeApplicationThread(
  postId: string,
  applicationId: string,
  cb: (messages: WithId<ApplicationMessageDoc>[]) => void,
): () => void {
  const q = query(appThreadCol(postId, applicationId), orderBy("createdAt", "asc"), limit(200));
  return onSnapshot(q, (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );
}

export async function sendApplicationMessage(input: SendApplicationMessageInput): Promise<void> {
  const callable = httpsCallable<SendApplicationMessageInput, { ok: boolean }>(
    functions,
    "sendApplicationMessage",
  );
  await callable(input);
}

export async function markApplicationThreadRead(
  postId: string,
  applicationId: string,
): Promise<void> {
  const callable = httpsCallable<{ postId: string; applicationId: string }, { ok: boolean }>(
    functions,
    "markApplicationThreadRead",
  );
  await callable({ postId, applicationId });
}

export async function reviseApplication(input: ReviseApplicationInput): Promise<void> {
  const callable = httpsCallable<ReviseApplicationInput, { ok: boolean }>(
    functions,
    "reviseApplication",
  );
  await callable(input);
}

export async function declineApplication(
  postId: string,
  applicationId: string,
  reason: string,
): Promise<void> {
  const callable = httpsCallable<
    { postId: string; applicationId: string; reason: string },
    { ok: boolean }
  >(functions, "declineApplication");
  await callable({ postId, applicationId, reason });
}
