import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  type FirestoreError,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import type { TimeEntryDoc, TimeEntryKind, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const entriesCol = (jobId: string) =>
  collection(db, "jobs", jobId, "timeEntries").withConverter(typedConverter<TimeEntryDoc>());
const entryRef = (jobId: string, entryId: string) =>
  doc(db, "jobs", jobId, "timeEntries", entryId);

export function subscribeJobTimeEntries(
  jobId: string,
  tradespersonId: string,
  cb: (entries: WithId<TimeEntryDoc>[]) => void,
  onError?: (err: FirestoreError) => void,
): () => void {
  // Filter on tradespersonId so the listener stays robust to stale entries
  // from an earlier tradie assignment (the rule allows read only when
  // tradespersonId == uid() || clientId == uid(), and ONE unreadable doc
  // tanks the whole snapshot). For a normal one-tradie-per-job, this is
  // a no-op filter; for a job whose tradie was swapped, it scopes results
  // to the currently-assigned tradie's sessions.
  const q = query(
    entriesCol(jobId),
    where("tradespersonId", "==", tradespersonId),
    orderBy("startedAt", "asc"),
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.warn(`[Firestore] jobs/${jobId}/timeEntries listener:`, err.code, err.message);
      onError?.(err);
    },
  );
}

export async function updateTimeEntryNotes(
  jobId: string,
  entryId: string,
  notes: string,
): Promise<void> {
  await updateDoc(entryRef(jobId, entryId), { notes: notes.slice(0, 2000) });
}

export async function deleteTimeEntry(jobId: string, entryId: string): Promise<void> {
  await deleteDoc(entryRef(jobId, entryId));
}

export interface ClockInResult {
  entryId: string;
}
export interface ClockOutResult {
  entryId: string;
  elapsedMinutes: number;
  billedAmount: number; // cents
}

// `kind` defaults to "labour". For "extra", pass the approved extra's id.
// Clocking in auto-stops any session still running on another job.
export async function clockIn(
  jobId: string,
  opts?: { kind?: TimeEntryKind; extraId?: string | null },
): Promise<ClockInResult> {
  const fn = httpsCallable<
    { jobId: string; kind?: TimeEntryKind; extraId?: string | null },
    ClockInResult
  >(functions, "clockIn");
  const res = await fn({ jobId, kind: opts?.kind ?? "labour", extraId: opts?.extraId ?? null });
  return res.data;
}

export async function clockOut(jobId: string, entryId: string): Promise<ClockOutResult> {
  const fn = httpsCallable<{ jobId: string; entryId: string }, ClockOutResult>(
    functions,
    "clockOut",
  );
  const res = await fn({ jobId, entryId });
  return res.data;
}

export interface AddManualTimeEntryResult {
  entryId: string;
}

// Log a CLOSED time entry by hand for work that wasn't clocked live.
// `startedAtMs` / `endedAtMs` are epoch-ms built from the form's local date +
// time. The rate + the same fixed-job / approved-extra rules as clockIn are
// resolved server-side; this never touches the running clock.
export async function addManualTimeEntry(
  jobId: string,
  input: {
    kind: TimeEntryKind;
    extraId?: string | null;
    startedAtMs: number;
    endedAtMs: number;
    notes?: string;
  },
): Promise<AddManualTimeEntryResult> {
  const fn = httpsCallable<
    {
      jobId: string;
      kind: TimeEntryKind;
      extraId: string | null;
      startedAtMs: number;
      endedAtMs: number;
      notes: string;
    },
    AddManualTimeEntryResult
  >(functions, "addManualTimeEntry");
  const res = await fn({
    jobId,
    kind: input.kind,
    extraId: input.extraId ?? null,
    startedAtMs: input.startedAtMs,
    endedAtMs: input.endedAtMs,
    notes: input.notes ?? "",
  });
  return res.data;
}

/** Local (no server round-trip) computation of billable minutes + cents.
 *  Useful for the live ticker on the UI and for the invoice-roll-up. */
export function entryBillable(entry: TimeEntryDoc, nowMs = Date.now()): {
  elapsedMs: number;
  billedAmount: number; // cents
} {
  const startMs = entry.startedAt?.toMillis?.() ?? 0;
  const endMs = entry.endedAt?.toMillis?.() ?? nowMs;
  const elapsedMs = Math.max(0, endMs - startMs);
  const hours = elapsedMs / 3_600_000;
  const billedAmount = Math.round(hours * entry.hourlyRateSnapshot);
  return { elapsedMs, billedAmount };
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
