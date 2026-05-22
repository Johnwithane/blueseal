import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/firebase/config";
import type { BookingDoc, JobDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const bookingsCol = () =>
  collection(db, "bookings").withConverter(typedConverter<BookingDoc>());

/**
 * Creates a "blocked" booking covering a date range — the tradie's
 * unavailability window. Always full-day for now: callers pass calendar
 * dates and we snap to local-midnight start and end-of-day exclusive.
 */
export async function createBlock(
  tradespersonId: string,
  startDate: Date,
  endDate: Date,
): Promise<string> {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  // Exclusive end-of-day so a single-day block covers [00:00, next-day-00:00).
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1);
  if (end <= start) {
    throw new Error("Block end must be after start.");
  }
  const ref = await addDoc(bookingsCol(), {
    tradespersonId,
    start: Timestamp.fromDate(start),
    end: Timestamp.fromDate(end),
    type: "blocked",
    jobId: null,
  });
  return ref.id;
}

/**
 * Creates many "blocked" bookings in one batch — used by the preset patterns
 * (every weekend through year-end, every Friday for N weeks, etc.). Each
 * input range is a single block doc; ranges with end <= start are skipped.
 *
 * Firestore writeBatch caps at 500 ops; presets here stay well below that.
 */
export async function createBlocksBatch(
  tradespersonId: string,
  ranges: Array<{ start: Date; end: Date }>,
): Promise<number> {
  if (ranges.length === 0) return 0;
  if (ranges.length > 500) {
    throw new Error("Too many blocks at once (limit 500).");
  }
  const batch = writeBatch(db);
  let count = 0;
  for (const r of ranges) {
    const start = new Date(r.start);
    start.setHours(0, 0, 0, 0);
    const end = new Date(r.end);
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + 1); // exclusive end-of-day
    if (end <= start) continue;
    const ref = doc(bookingsCol());
    batch.set(ref, {
      tradespersonId,
      start: Timestamp.fromDate(start),
      end: Timestamp.fromDate(end),
      type: "blocked",
      jobId: null,
    });
    count++;
  }
  await batch.commit();
  return count;
}

export async function deleteBooking(bookingId: string): Promise<void> {
  await deleteDoc(doc(db, "bookings", bookingId));
}

/**
 * Subscribes to all of a tradie's bookings (blocked + booked). Caller decides
 * how to filter / render. Returns an unsubscribe fn.
 */
export function subscribeBookings(
  tradespersonId: string,
  cb: (bookings: WithId<BookingDoc>[]) => void,
): () => void {
  const q = query(
    bookingsCol(),
    where("tradespersonId", "==", tradespersonId),
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

// ---------------------------------------------------------------------------
// Collision detection
// ---------------------------------------------------------------------------

export interface Collision {
  type: "block" | "job";
  id: string;
  label: string;
  start: Date;
  end: Date;
}

/**
 * Find every block-off or already-scheduled job that overlaps the given
 * window for this tradesperson. Used by the schedule UI to warn before
 * writing — better than letting the tradie double-book themselves and
 * find out when the client's waiting on the porch.
 *
 * Overlap rule: existing.start < proposed.end AND existing.end > proposed.start.
 * Firestore can't do compound range filters across two fields, so we query
 * by tradespersonId only and filter in-memory. Fine at the tradesperson
 * scale (a few hundred jobs lifetime) — switch to indexed range queries if
 * we ever hit a Crew lead with thousands of bookings.
 *
 * Pass `excludeJobId` when re-scheduling an existing job so it doesn't
 * collide with itself.
 */
export async function findCollisions(
  tradespersonId: string,
  start: Date,
  end: Date,
  options?: { excludeJobId?: string },
): Promise<Collision[]> {
  const startMs = start.getTime();
  const endMs = end.getTime();
  const collisions: Collision[] = [];

  // Blocks
  const blocksSnap = await getDocs(
    query(bookingsCol(), where("tradespersonId", "==", tradespersonId)),
  );
  for (const d of blocksSnap.docs) {
    const data = d.data();
    if (data.type !== "blocked") continue;
    const s = data.start.toDate().getTime();
    const e = data.end.toDate().getTime();
    if (s >= endMs) continue;
    if (e <= startMs) continue;
    collisions.push({
      type: "block",
      id: d.id,
      label: "Blocked off",
      start: data.start.toDate(),
      end: data.end.toDate(),
    });
  }

  // Jobs already scheduled or in progress. Excludes terminal states
  // (complete, reviewed, cancelled) — those don't conflict.
  const jobsCol = collection(db, "jobs").withConverter(typedConverter<JobDoc>());
  const jobsSnap = await getDocs(
    query(jobsCol, where("tradespersonId", "==", tradespersonId)),
  );
  const ACTIVE: ReadonlySet<string> = new Set(["scheduled", "in_progress"]);
  for (const d of jobsSnap.docs) {
    if (d.id === options?.excludeJobId) continue;
    const data = d.data();
    if (!ACTIVE.has(data.status)) continue;
    if (!data.scheduledStart || !data.scheduledEnd) continue;
    const s = data.scheduledStart.toDate().getTime();
    const e = data.scheduledEnd.toDate().getTime();
    if (s >= endMs) continue;
    if (e <= startMs) continue;
    collisions.push({
      type: "job",
      id: d.id,
      label: data.title || "Untitled job",
      start: data.scheduledStart.toDate(),
      end: data.scheduledEnd.toDate(),
    });
  }

  return collisions;
}
