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
import { httpsCallable } from "firebase/functions";
import { auth as fbAuth, db, functions } from "@/firebase/config";
import type {
  InvoiceDiscount,
  JobAddress,
  JobDoc,
  JobStatus,
  LineItem,
  WithId,
  Urgency,
} from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const jobsCol = () => collection(db, "jobs").withConverter(typedConverter<JobDoc>());
const jobRef = (id: string) => doc(db, "jobs", id).withConverter(typedConverter<JobDoc>());

export interface NewJobInput {
  clientId: string;
  tradespersonId: string;
  // Denormalized counterparty display fields written at create time so each
  // party can render the other on dashboard cards without a cross-account
  // user-doc read. Null is acceptable (photo not set yet).
  clientName: string;
  clientPhotoURL: string | null;
  tradespersonName: string;
  tradespersonPhotoURL: string | null;
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
    clientName: input.clientName,
    clientPhotoURL: input.clientPhotoURL,
    tradespersonName: input.tradespersonName,
    tradespersonPhotoURL: input.tradespersonPhotoURL,
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
    clientApprovalRequestedAt: null,
    clientApprovedAt: null,
    cancelledAt: null,
    cancelledReason: null,
    cancelledBy: null,
    chatId,
    privateNotes: "",
    sourcePostId: null,
    privateNotesLastAutoUpdateAt: null,
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

// Statuses where either party can still cancel. Once money is owed
// ("awaiting_client_approval"/"awaiting_payment"/"complete"/"reviewed"),
// cancellation has to go through a dispute or admin instead. in_progress
// stays cancellable because that now covers the window between client
// quote-accept and the tradesperson actually doing the work — clients
// need a way out if plans change before the visit.
export const CANCELLABLE_STATUSES: readonly JobStatus[] = [
  "accepted",
  "requested",
  "quoted",
  "in_progress",
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
  // Scheduling is metadata on an active job, not a status transition.
  // The job is already in_progress by the time this is called.
  await updateDoc(doc(db, "jobs", id), {
    scheduledStart: start,
    scheduledEnd: end,
  });
}

export async function updatePrivateNotes(id: string, notes: string): Promise<void> {
  await updateDoc(doc(db, "jobs", id), { privateNotes: notes });
}

// Per-party archive: each party hides the job from their own dashboard
// default list. The rules layer enforces that the field name matches the
// caller's role — passing the wrong field is a permission-denied at the
// server. We pass `role` here so call sites are explicit about which side
// they're acting on (and so multi-role accounts in client view can't
// accidentally write the tradesperson field).
export async function archiveJob(
  id: string,
  role: "client" | "tradesperson",
): Promise<void> {
  const field = role === "client" ? "clientArchivedAt" : "tradespersonArchivedAt";
  await updateDoc(doc(db, "jobs", id), { [field]: serverTimestamp() });
}

export async function unarchiveJob(
  id: string,
  role: "client" | "tradesperson",
): Promise<void> {
  const field = role === "client" ? "clientArchivedAt" : "tradespersonArchivedAt";
  await updateDoc(doc(db, "jobs", id), { [field]: null });
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

// ---------------------------------------------------------------------------
// Finish-job / approval flow callables.
// Each thin wrapper preserves the typed `data` payload so callers don't have
// to know httpsCallable's generic. Server-side validation + state transitions
// live in functions/src/jobs/{submit,clientApprove,clientRequestChanges,markJobPaid}.ts.
// ---------------------------------------------------------------------------

export interface SubmitJobForApprovalInput {
  jobId: string;
  /** One-off line items added in the wrap-up sheet (trip charge, sourcing fee, etc.). */
  extraLineItems?: LineItem[];
  /** Optional whole-invoice discount applied before tax. */
  discount?: InvoiceDiscount | null;
  /** Short message rendered into the system chat line shown to the client. */
  noteToClient?: string;
}

export async function submitJobForApproval(
  input: SubmitJobForApprovalInput,
): Promise<{ ok: true; total: number; lineItemsCount: number }> {
  const fn = httpsCallable<SubmitJobForApprovalInput, { ok: true; total: number; lineItemsCount: number }>(
    functions,
    "submitJobForApproval",
  );
  const res = await fn(input);
  return res.data;
}

export async function clientApproveJob(jobId: string): Promise<{ ok: true }> {
  const fn = httpsCallable<{ jobId: string }, { ok: true }>(functions, "clientApproveJob");
  const res = await fn({ jobId });
  return res.data;
}

export async function clientRequestChanges(
  jobId: string,
  reason: string,
): Promise<{ ok: true }> {
  const fn = httpsCallable<{ jobId: string; reason: string }, { ok: true }>(
    functions,
    "clientRequestChanges",
  );
  const res = await fn({ jobId, reason });
  return res.data;
}

export async function markJobPaid(jobId: string): Promise<{ ok: true }> {
  const fn = httpsCallable<{ jobId: string }, { ok: true }>(functions, "markJobPaid");
  const res = await fn({ jobId });
  return res.data;
}

/** Client-initiated mark-as-paid (manual/offline payment path, no Stripe). */
export async function clientMarkPaid(jobId: string): Promise<{ ok: true }> {
  const fn = httpsCallable<{ jobId: string }, { ok: true }>(functions, "clientMarkPaid");
  const res = await fn({ jobId });
  return res.data;
}

export interface InvoicePartyInfo {
  tradesperson: {
    name: string;
    companyName: string | null;
    companyLogoUrl: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    gstNumber: string | null;
  };
  client: {
    name: string;
    email: string | null;
    phone: string | null;
    address: string | null;
  };
}

/**
 * Server-side admin reads for both parties' contact info — used to populate
 * quote/invoice PDFs without needing each party to read the other's private
 * user doc. Auth: either party of the job, or an admin.
 */
export async function getInvoicePartyInfo(jobId: string): Promise<InvoicePartyInfo> {
  const fn = httpsCallable<{ jobId: string }, InvoicePartyInfo>(
    functions,
    "getInvoicePartyInfo",
  );
  const res = await fn({ jobId });
  return res.data;
}

/**
 * Resolve the real jobId for a chat. Used to repair legacy notification
 * deep-links that point at `/jobs/pending` — those came from a fixed bug
 * where the chat was created with `jobId: "pending"` and rules now
 * prevent patching it. The job itself stores the real chatId at create
 * time, so we can recover the jobId from there.
 *
 * Rules require the query to be constrained by the caller's own party
 * id, so we probe both seats (client first, then tradesperson) and
 * return whichever matches.
 */
export async function findJobIdByChatId(
  chatId: string,
  uid: string,
): Promise<string | null> {
  const asClient = await getDocs(
    query(jobsCol(), where("clientId", "==", uid), where("chatId", "==", chatId), limit(1)),
  );
  if (!asClient.empty) return asClient.docs[0].id;
  const asTradie = await getDocs(
    query(
      jobsCol(),
      where("tradespersonId", "==", uid),
      where("chatId", "==", chatId),
      limit(1),
    ),
  );
  return asTradie.empty ? null : asTradie.docs[0].id;
}

export async function listJobsForTradie(
  tradieUid: string,
  max = 200,
): Promise<WithId<JobDoc>[]> {
  const q = query(
    jobsCol(),
    where("tradespersonId", "==", tradieUid),
    orderBy("createdAt", "desc"),
    limit(max),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listJobsForClient(
  clientUid: string,
  max = 200,
): Promise<WithId<JobDoc>[]> {
  const q = query(
    jobsCol(),
    where("clientId", "==", clientUid),
    orderBy("createdAt", "desc"),
    limit(max),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
