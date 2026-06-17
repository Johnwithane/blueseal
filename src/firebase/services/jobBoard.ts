import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { auth as fbAuth, db } from "@/firebase/config";

/**
 * Live count of new job posts in the tradesperson's area since they last
 * opened the board. The onJobPostCreated trigger increments it (Admin SDK);
 * opening the board resets it to 0. The doc is absent until the first matching
 * post, so a missing doc reads as 0.
 */
export function subscribeJobBoardCount(cb: (count: number) => void): () => void {
  const uid = fbAuth.currentUser?.uid;
  if (!uid) {
    cb(0);
    return () => {};
  }
  return onSnapshot(
    doc(db, "jobBoardCounters", uid),
    (snap) => cb(snap.exists() ? ((snap.data().count as number | undefined) ?? 0) : 0),
    (err) =>
      console.warn(`[Firestore] jobBoardCounters(${uid}) listener:`, err.code, err.message),
  );
}

/**
 * Clear the "new jobs in your area" badge — call when the tradesperson opens
 * the board. Clients may only ever set count to 0 (security rules enforce);
 * every increment is server-side via the Admin SDK. merge:true so we never
 * clobber the server-written lastJobAt.
 */
export async function resetJobBoardCount(): Promise<void> {
  const uid = fbAuth.currentUser?.uid;
  if (!uid) return;
  await setDoc(
    doc(db, "jobBoardCounters", uid),
    { count: 0, lastSeenAt: serverTimestamp(), updatedAt: serverTimestamp() },
    { merge: true },
  );
}
