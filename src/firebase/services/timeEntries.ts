import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import type { TimeEntryDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const entriesCol = (jobId: string) =>
  collection(db, "jobs", jobId, "timeEntries").withConverter(typedConverter<TimeEntryDoc>());
const entryRef = (jobId: string, entryId: string) =>
  doc(db, "jobs", jobId, "timeEntries", entryId);

export function subscribeJobTimeEntries(
  jobId: string,
  cb: (entries: WithId<TimeEntryDoc>[]) => void,
): () => void {
  const q = query(entriesCol(jobId), orderBy("startedAt", "asc"));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function listJobTimeEntries(jobId: string): Promise<WithId<TimeEntryDoc>[]> {
  const snap = await getDocs(query(entriesCol(jobId), orderBy("startedAt", "asc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Find an open (un-clocked-out) entry for the caller. Used by the UI to
// decide whether the button reads "Clock in" or "Stop". The callable is
// the authoritative gate — this is just a UI convenience.
export async function getOpenEntryForTradie(
  jobId: string,
  tradieUid: string,
): Promise<WithId<TimeEntryDoc> | null> {
  const snap = await getDocs(
    query(
      entriesCol(jobId),
      where("tradespersonId", "==", tradieUid),
      where("endedAt", "==", null),
    ),
  );
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
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

export async function clockIn(jobId: string): Promise<ClockInResult> {
  const fn = httpsCallable<{ jobId: string }, ClockInResult>(functions, "clockIn");
  const res = await fn({ jobId });
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
