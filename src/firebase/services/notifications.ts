import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { auth as fbAuth, db } from "@/firebase/config";
import type { NotificationDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const notifsCol = () =>
  collection(db, "notifications").withConverter(typedConverter<NotificationDoc>());

/** Stream the signed-in user's most recent notifications, newest first. */
export function subscribeMyNotifications(
  cb: (items: WithId<NotificationDoc>[]) => void,
  options?: { max?: number },
): () => void {
  const uid = fbAuth.currentUser?.uid;
  if (!uid) {
    cb([]);
    return () => {};
  }
  const q = query(
    notifsCol(),
    where("userId", "==", uid),
    orderBy("createdAt", "desc"),
    limit(options?.max ?? 30),
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

/** Mark a single notification as read (idempotent). */
export async function markNotificationRead(notifId: string): Promise<void> {
  await updateDoc(doc(db, "notifications", notifId), {
    read: true,
    readAt: serverTimestamp(),
  });
}

/** Mark every supplied notification as read in one batch. Caller filters
 * out already-read ones to keep the batch small. */
export async function markAllRead(notifIds: string[]): Promise<void> {
  if (notifIds.length === 0) return;
  const batch = writeBatch(db);
  const ts = serverTimestamp();
  for (const id of notifIds) {
    batch.update(doc(db, "notifications", id), { read: true, readAt: ts });
  }
  await batch.commit();
}
