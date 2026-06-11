import { db } from "@/firebase/config";
import type { TradespersonDoc, WithId } from "@/firebase/interfaces";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { getTradesperson } from "./tradespeople";

// users/{uid}/savedTradies/{tradieId} — the client's private shortlist.
// Doc id is the tradesperson uid, so toggling is a direct write (no query).

function savedRef(uid: string, tradieId: string) {
  return doc(db, "users", uid, "savedTradies", tradieId);
}

export function subscribeSavedTradieIds(
  uid: string,
  cb: (ids: Set<string>) => void,
): Unsubscribe {
  return onSnapshot(collection(db, "users", uid, "savedTradies"), (snap) => {
    cb(new Set(snap.docs.map((d) => d.id)));
  });
}

export async function saveTradie(uid: string, tradieId: string): Promise<void> {
  await setDoc(savedRef(uid, tradieId), { createdAt: serverTimestamp() });
}

export async function unsaveTradie(uid: string, tradieId: string): Promise<void> {
  await deleteDoc(savedRef(uid, tradieId));
}

export async function isTradieSaved(uid: string, tradieId: string): Promise<boolean> {
  return (await getDoc(savedRef(uid, tradieId))).exists();
}

/**
 * Hydrate saved ids into displayable profiles. Tradies who went invisible
 * (or were deleted) since being saved are silently dropped from the shelf —
 * the saved doc stays, so they reappear if they come back.
 */
export async function hydrateSavedTradies(ids: string[]): Promise<WithId<TradespersonDoc>[]> {
  const docs = await Promise.all(
    ids.map((id) => getTradesperson(id).catch(() => null)),
  );
  return docs.filter((t): t is WithId<TradespersonDoc> => t != null && t.isVisible === true);
}
