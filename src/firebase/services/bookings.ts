import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/firebase/config";
import type { BookingDoc, WithId } from "@/firebase/interfaces";
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
