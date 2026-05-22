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
  updateDoc,
  where,
  GeoPoint,
} from "firebase/firestore";
import { auth as fbAuth, db } from "@/firebase/config";
import type { JobAddress, JobDoc, JobStatus, WithId, Urgency } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const jobsCol = () => collection(db, "jobs").withConverter(typedConverter<JobDoc>());
const jobRef = (id: string) => doc(db, "jobs", id).withConverter(typedConverter<JobDoc>());

export interface NewJobInput {
  clientId: string;
  tradespersonId: string;
  trade: string;
  title: string;
  description: string;
  intakeFormData: Record<string, unknown>;
  intakePhotos: string[];
  address: Omit<JobAddress, "geo"> & { lat?: number; lng?: number };
  preferredDateWindow: { start: Date | null; end: Date | null };
  urgency: Urgency;
}

export async function createJob(input: NewJobInput, chatId: string): Promise<string> {
  const geo =
    input.address.lat != null && input.address.lng != null
      ? new GeoPoint(input.address.lat, input.address.lng)
      : null;
  const docRef = await addDoc(jobsCol(), {
    clientId: input.clientId,
    tradespersonId: input.tradespersonId,
    status: "requested",
    trade: input.trade,
    title: input.title,
    description: input.description,
    intakeFormData: input.intakeFormData,
    intakePhotos: input.intakePhotos,
    address: {
      line1: input.address.line1,
      city: input.address.city,
      region: input.address.region,
      postalCode: input.address.postalCode,
      geo,
    },
    preferredDateWindow: {
      start: (input.preferredDateWindow.start as unknown as never) ?? null,
      end: (input.preferredDateWindow.end as unknown as never) ?? null,
    },
    urgency: input.urgency,
    scheduledStart: null,
    scheduledEnd: null,
    createdAt: serverTimestamp() as never,
    completedAt: null,
    cancelledAt: null,
    cancelledReason: null,
    cancelledBy: null,
    chatId,
    privateNotes: "",
    sourcePostId: null,
  });
  return docRef.id;
}

export async function getJob(id: string): Promise<WithId<JobDoc> | null> {
  const snap = await getDoc(jobRef(id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function updateJobStatus(id: string, status: JobStatus): Promise<void> {
  if (status === "complete") {
    await updateDoc(doc(db, "jobs", id), { status, completedAt: serverTimestamp() });
  } else {
    await updateDoc(doc(db, "jobs", id), { status });
  }
}

// Statuses where either party can still cancel. Once work has started
// ("in_progress") or money is owed ("awaiting_payment"/"complete"/
// "reviewed"), cancellation has to go through a dispute or admin instead.
export const CANCELLABLE_STATUSES: readonly JobStatus[] = [
  "accepted",
  "requested",
  "quoted",
  "scheduled",
] as const;

/**
 * Cancel a job and record who did it + why. The onJobCancelled Cloud
 * Function trigger notifies the opposite party. `cancelledBy` is read from
 * the current Firebase user; the firestore rules already restrict updates
 * to parties of the job, so a stranger can't set this.
 */
export async function cancelJob(id: string, reason: string): Promise<void> {
  const uid = fbAuth.currentUser?.uid;
  if (!uid) throw new Error("Sign in required to cancel.");
  await updateDoc(doc(db, "jobs", id), {
    status: "cancelled",
    cancelledAt: serverTimestamp(),
    cancelledReason: reason.trim().slice(0, 1000),
    cancelledBy: uid,
  });
}

export async function scheduleJob(id: string, start: Date, end: Date): Promise<void> {
  await updateDoc(doc(db, "jobs", id), {
    scheduledStart: start,
    scheduledEnd: end,
    status: "scheduled",
  });
}

export async function updatePrivateNotes(id: string, notes: string): Promise<void> {
  await updateDoc(doc(db, "jobs", id), { privateNotes: notes });
}

export async function updateJobIntakePhotos(id: string, photos: string[]): Promise<void> {
  await updateDoc(doc(db, "jobs", id), { intakePhotos: photos });
}

// Marketplace-originated jobs enter the system in status="accepted" with an
// empty intakeFormData. Once the client fills the trade-specific intake, we
// write it and advance to "requested" so the standard flow takes over.
export async function saveJobIntakeAndAdvance(
  id: string,
  intakeFormData: Record<string, unknown>,
): Promise<void> {
  await updateDoc(doc(db, "jobs", id), {
    intakeFormData,
    status: "requested",
  });
}

// Subscribe to all jobs for a tradesperson (kanban + calendar feed).
export function subscribeTradieJobs(
  tradieUid: string,
  cb: (jobs: WithId<JobDoc>[]) => void,
): () => void {
  const q = query(
    jobsCol(),
    where("tradespersonId", "==", tradieUid),
    orderBy("createdAt", "desc"),
    limit(200),
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export function subscribeClientJobs(
  clientUid: string,
  cb: (jobs: WithId<JobDoc>[]) => void,
): () => void {
  const q = query(
    jobsCol(),
    where("clientId", "==", clientUid),
    orderBy("createdAt", "desc"),
    limit(200),
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function listJobsForTradie(tradieUid: string): Promise<WithId<JobDoc>[]> {
  const q = query(
    jobsCol(),
    where("tradespersonId", "==", tradieUid),
    orderBy("createdAt", "desc"),
    limit(200),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
