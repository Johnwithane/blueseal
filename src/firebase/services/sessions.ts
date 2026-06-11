import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  type FirestoreError,
} from "firebase/firestore";
import { db } from "@/firebase/config";
import type { SessionDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const sessionsCol = (jobId: string) =>
  collection(db, "jobs", jobId, "sessions").withConverter(typedConverter<SessionDoc>());
const sessionRef = (jobId: string, sessionId: string) =>
  doc(db, "jobs", jobId, "sessions", sessionId);

/**
 * Live list of a job's booked work sessions, earliest first. Unlike the
 * timeEntries listener this needs no tradespersonId filter — sessions are
 * read-authorized via the parent job (rules), and a job has one set of
 * sessions both parties share — so an unfiltered `orderBy("start")` is safe
 * for client and tradie alike and needs no composite index.
 */
export function subscribeJobSessions(
  jobId: string,
  cb: (sessions: WithId<SessionDoc>[]) => void,
  onError?: (err: FirestoreError) => void,
): () => void {
  const q = query(sessionsCol(jobId), orderBy("start", "asc"));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.warn(`[Firestore] jobs/${jobId}/sessions listener:`, err.code, err.message);
      onError?.(err);
    },
  );
}

/**
 * Books a new work session on the job, then re-syncs the job's
 * scheduledStart/End mirror. Returns the new session id.
 */
export async function createSession(
  jobId: string,
  input: {
    tradespersonId: string;
    clientId: string | null;
    start: Date;
    end: Date;
    note?: string;
  },
): Promise<string> {
  if (input.end <= input.start) {
    throw new Error("Session end must be after start.");
  }
  const ref = await addDoc(sessionsCol(jobId), {
    tradespersonId: input.tradespersonId,
    clientId: input.clientId,
    start: Timestamp.fromDate(input.start),
    end: Timestamp.fromDate(input.end),
    note: (input.note ?? "").slice(0, 500),
    createdAt: Timestamp.now(),
  });
  await recomputeJobSchedule(jobId);
  return ref.id;
}

export async function updateSession(
  jobId: string,
  sessionId: string,
  patch: { start: Date; end: Date; note?: string },
): Promise<void> {
  if (patch.end <= patch.start) {
    throw new Error("Session end must be after start.");
  }
  await updateDoc(sessionRef(jobId, sessionId), {
    start: Timestamp.fromDate(patch.start),
    end: Timestamp.fromDate(patch.end),
    note: (patch.note ?? "").slice(0, 500),
  });
  await recomputeJobSchedule(jobId);
}

export async function deleteSession(jobId: string, sessionId: string): Promise<void> {
  await deleteDoc(sessionRef(jobId, sessionId));
  await recomputeJobSchedule(jobId);
}

/**
 * Picks the session that should represent the job on the dashboard calendar /
 * "You're booked in" banner: the next visit that hasn't fully ended yet, else
 * (everything in the past) the most recent one, else null when there are none.
 * Pure given `nowMs` so it's unit-testable without the emulator.
 */
export function pickRepresentativeWindow(
  sessions: Array<Pick<SessionDoc, "start" | "end">>,
  nowMs: number,
): { start: Timestamp; end: Timestamp } | null {
  if (sessions.length === 0) return null;
  const upcoming = sessions
    .filter((s) => s.end.toMillis() >= nowMs)
    .sort((a, b) => a.start.toMillis() - b.start.toMillis());
  const chosen =
    upcoming[0] ??
    [...sessions].sort((a, b) => b.start.toMillis() - a.start.toMillis())[0];
  return { start: chosen.start, end: chosen.end };
}

/**
 * Re-derives jobs/{jobId}.scheduledStart/End from the full session set so the
 * dashboard calendar, the booked-in banner, and cross-job collision detection
 * (all of which read the single window) stay correct as sessions change. Only
 * the tradesperson writes sessions, so there's no concurrent-writer race here.
 */
async function recomputeJobSchedule(jobId: string): Promise<void> {
  const snap = await getDocs(query(sessionsCol(jobId), orderBy("start", "asc")));
  const sessions = snap.docs.map((d) => d.data());
  const window = pickRepresentativeWindow(sessions, Date.now());
  await updateDoc(doc(db, "jobs", jobId), {
    scheduledStart: window?.start ?? null,
    scheduledEnd: window?.end ?? null,
  });
}
