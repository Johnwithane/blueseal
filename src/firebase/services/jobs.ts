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
  setDoc,
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
  JobPrivateNotes,
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
    sourcePostId: null,
  });
  return docRef.id;
}

// Tradesperson-created job for an off-platform client ("bring your own
// client"). Callable-only: the server mints the invite token (hash-only at
// rest), enforces the vetted-tradesperson gate + the future subscription
// seam, and writes the job with clientId: null. `inviteLink` is the copyable
// /invite/{token} URL — returned exactly once; copying it again later goes
// through resendJobInvite (which rotates the token).
export interface InviteJobInput {
  title: string;
  description: string;
  trade: string;
  clientName: string;
  clientEmail: string;
  address: Omit<JobAddress, "geo">;
  urgency: Urgency;
  preferredStart: string | null; // YYYY-MM-DD or null
}

export async function createInviteJob(
  input: InviteJobInput,
): Promise<{ jobId: string; inviteLink: string; emailed: boolean }> {
  const fn = httpsCallable<InviteJobInput, { jobId: string; inviteLink: string; emailed: boolean }>(
    functions,
    "createInviteJob",
  );
  const res = await fn(input);
  return res.data;
}

// Rotates the invite token (old copy links die) and optionally re-emails the
// magic link or fixes a typo'd address. channel "link" just returns a fresh
// copyable URL without sending anything.
export async function resendJobInvite(input: {
  jobId: string;
  channel: "email" | "link";
  newEmail?: string;
  newClientName?: string;
}): Promise<{ inviteLink: string; emailed: boolean }> {
  const fn = httpsCallable<typeof input, { inviteLink: string; emailed: boolean }>(
    functions,
    "resendJobInvite",
  );
  const res = await fn(input);
  return res.data;
}

export async function revokeJobInvite(jobId: string): Promise<{ ok: true }> {
  const fn = httpsCallable<{ jobId: string }, { ok: true }>(functions, "revokeJobInvite");
  const res = await fn({ jobId });
  return res.data;
}

// Unauthenticated by design: the copied invite link can only trigger sending
// a magic sign-in link to the email the tradesperson stored on the invite.
export async function sendJobInviteSignInLink(
  token: string,
  email: string,
): Promise<{ ok: true }> {
  const fn = httpsCallable<{ token: string; email: string }, { ok: true }>(
    functions,
    "sendJobInviteSignInLink",
  );
  const res = await fn({ token, email });
  return res.data;
}

export interface InvitePreview {
  jobId: string;
  title: string;
  trade: string;
  tradieName: string;
  clientName: string;
  acceptedOffline: boolean;
}

export type ClaimJobInviteResult =
  | { status: "needs_verification" }
  | { status: "none"; invites: [] }
  | { status: "preview"; invites: InvitePreview[] }
  | { status: "claimed"; claimed: number; jobIds: string[] };

// Two-phase: confirm:false previews the invites matching the signed-in
// user's verified email; confirm:true attaches them as the jobs' client.
export async function claimJobInvite(confirm: boolean): Promise<ClaimJobInviteResult> {
  const fn = httpsCallable<{ confirm: boolean }, ClaimJobInviteResult>(
    functions,
    "claimJobInvite",
  );
  const res = await fn({ confirm });
  return res.data;
}

export async function getJob(id: string): Promise<WithId<JobDoc> | null> {
  const snap = await getDoc(jobRef(id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Live single-doc subscription. JobDetailView uses this (not getJob) so a
// status change driven by the *other* party — e.g. the client accepting a
// quote while the tradesperson has the job open — reflects immediately
// instead of requiring a manual refresh. `onError` surfaces the
// permission-denied case (stale/cross-account deep link) to the caller's
// error state, mirroring the one-shot getJob catch it replaces.
export function subscribeJob(
  id: string,
  cb: (job: WithId<JobDoc> | null) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    jobRef(id),
    (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    onError,
  );
}

export async function updateJobStatus(id: string, status: JobStatus): Promise<void> {
  if (status === "complete") {
    await updateDoc(doc(db, "jobs", id), { status, completedAt: serverTimestamp() });
  } else {
    await updateDoc(doc(db, "jobs", id), { status });
  }
}

// Pre-commitment statuses where the CLIENT can cancel INSTANTLY (cancelJob,
// allowed directly by firestore.rules). Nothing is committed yet — no accepted
// quote, no work — so no tradesperson sign-off is needed.
export const INSTANT_CANCEL_STATUSES: readonly JobStatus[] = [
  "accepted",
  "requested",
  "quoted",
] as const;

// Committed statuses where a cancel must be REQUESTED and the tradesperson has
// to accept it (requestJobChange → respondJobChange). The client has accepted a
// quote / work is under way, so they can't unilaterally pull the rug. Mirrors
// CANCEL_REQUEST_STATUSES in functions/src/jobs/requestJobChange.ts.
export const REQUEST_CANCEL_STATUSES: readonly JobStatus[] = [
  "awaiting_upfront_payment",
  "in_progress",
] as const;

// Statuses a client can request a postpone (hold) from — only an actively
// running job. A quote that hasn't been accepted isn't "started", so there's
// nothing to pause.
export const POSTPONABLE_STATUSES: readonly JobStatus[] = ["in_progress"] as const;

/**
 * Instantly cancel a PRE-COMMITMENT job and record who did it + why. The
 * onJobCancelled trigger notifies the opposite party. Only valid from
 * INSTANT_CANCEL_STATUSES — firestore.rules rejects a direct client cancel of a
 * committed job, so for those the UI routes through requestJobChange instead
 * (the rules are the real guard; callers gate the button on the status set).
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

// ---------------------------------------------------------------------------
// Cancel / postpone request loop for COMMITTED jobs. The client raises a
// request (requestJobChange); the tradesperson accepts or declines
// (respondJobChange); the requester can pull it back (withdrawJobChange); and
// either party lifts a hold (resumeJob). All state transitions + notifications
// live server-side in functions/src/jobs/{requestJobChange,respondJobChange,
// withdrawJobChange,resumeJob}.ts so the "tradesperson must accept" rule can't
// be bypassed from the client.
// ---------------------------------------------------------------------------

export async function requestJobChange(
  jobId: string,
  type: "cancel" | "postpone",
  reason: string,
  proposedResumeAt?: Date | null,
): Promise<{ ok: true }> {
  const fn = httpsCallable<
    { jobId: string; type: "cancel" | "postpone"; reason: string; proposedResumeAt: number | null },
    { ok: true }
  >(functions, "requestJobChange");
  const res = await fn({
    jobId,
    type,
    reason: reason.trim().slice(0, 1000),
    proposedResumeAt: proposedResumeAt ? proposedResumeAt.getTime() : null,
  });
  return res.data;
}

export async function respondJobChange(jobId: string, accept: boolean): Promise<{ ok: true }> {
  const fn = httpsCallable<{ jobId: string; accept: boolean }, { ok: true }>(
    functions,
    "respondJobChange",
  );
  const res = await fn({ jobId, accept });
  return res.data;
}

export async function withdrawJobChange(jobId: string): Promise<{ ok: true }> {
  const fn = httpsCallable<{ jobId: string }, { ok: true }>(functions, "withdrawJobChange");
  const res = await fn({ jobId });
  return res.data;
}

export async function resumeJob(jobId: string): Promise<{ ok: true }> {
  const fn = httpsCallable<{ jobId: string }, { ok: true }>(functions, "resumeJob");
  const res = await fn({ jobId });
  return res.data;
}

export async function scheduleJob(id: string, start: Date, end: Date): Promise<void> {
  // Scheduling is metadata on an active job, not a status transition.
  // The job is already in_progress by the time this is called.
  await updateDoc(doc(db, "jobs", id), {
    scheduledStart: start,
    scheduledEnd: end,
  });
}

// Private notes live in a subdoc (jobs/{id}/private/notes) so the client —
// who can read the parent job doc — can't read the tradie's notes. Read/write
// is restricted to the assigned tradie + admin in firestore.rules.
const jobPrivateNotesRef = (jobId: string) => doc(db, "jobs", jobId, "private", "notes");

export async function getJobPrivateNotes(jobId: string): Promise<string> {
  const snap = await getDoc(jobPrivateNotesRef(jobId));
  return snap.exists() ? ((snap.data() as Partial<JobPrivateNotes>).notes ?? "") : "";
}

export async function updatePrivateNotes(id: string, notes: string): Promise<void> {
  // merge so the server-managed lastAutoUpdateAt watermark isn't clobbered by
  // a manual save, and so the first-ever save creates the subdoc.
  await setDoc(jobPrivateNotesRef(id), { notes }, { merge: true });
}

// Admin one-shot: migrate legacy `privateNotes` off the client-readable job
// doc into the tradie-only private/notes subdoc (and strip the old field).
// Required after the F2 deploy — see backfillJobPrivateNotes Cloud Function.
export interface BackfillJobPrivateNotesResult {
  scanned: number;
  copied: number;
  strippedOnly: number;
  skipped: number;
  pages: number;
}

export async function backfillJobPrivateNotes(): Promise<BackfillJobPrivateNotesResult> {
  const callable = httpsCallable<undefined, BackfillJobPrivateNotesResult>(
    functions,
    "backfillJobPrivateNotes",
  );
  const { data } = await callable();
  return data;
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

// Subscribe to all jobs for a tradesperson (kanban + calendar + list feed).
// Recurring-billing backing jobs (originType "recurring_plan") are filtered out
// — they're hidden billing vehicles surfaced only under their client, never on
// the job board/kanban/calendar. Filtered client-side (post-limit), which is
// fine at the handful of recurring plans a tradesperson runs.
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
  return onSnapshot(q, (snap) =>
    cb(
      snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as WithId<JobDoc>)
        .filter((j) => j.originType !== "recurring_plan"),
    ),
  );
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

/** Tradesperson confirms they received the upfront fee — advances job to in_progress. */
export async function markUpfrontFeePaid(jobId: string): Promise<{ ok: true }> {
  const fn = httpsCallable<{ jobId: string }, { ok: true }>(functions, "markUpfrontFeePaid");
  const res = await fn({ jobId });
  return res.data;
}

/** Client-side "I've paid the upfront fee" nudge — pings the tradesperson to confirm receipt. */
export async function clientMarkUpfrontFeePaid(jobId: string): Promise<{ ok: true }> {
  const fn = httpsCallable<{ jobId: string }, { ok: true }>(
    functions,
    "clientMarkUpfrontFeePaid",
  );
  const res = await fn({ jobId });
  return res.data;
}

/** Create (or refresh) the Stripe PaymentIntent to pay a job's upfront fee by card. */
export async function createUpfrontFeePaymentIntent(
  jobId: string,
): Promise<{ clientSecret: string | null; serviceFee: { totalFeeCents: number; chargeTotalCents: number; baseAmountCents: number; waived: boolean } }> {
  const fn = httpsCallable<
    { jobId: string },
    { clientSecret: string | null; serviceFee: { totalFeeCents: number; chargeTotalCents: number; baseAmountCents: number; waived: boolean } }
  >(functions, "createUpfrontFeePaymentIntent");
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
