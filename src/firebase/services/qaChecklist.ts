// Shared QA test-progress board (qa-only). One Firestore doc per checklist item id
// (src/data/qaChecklist.ts), so the whole QA team sees the same pass/fail state.
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { db } from "@/firebase/config";
import type { Timestamp } from "firebase/firestore";

export interface QaCheckStatus {
  status: "pass" | "fail";
  byUid: string;
  byName: string | null;
  note: string | null;
  updatedAt: Timestamp | null;
}

/** Live map of itemId -> status for the whole board. */
export function subscribeQaChecklist(
  cb: (map: Record<string, QaCheckStatus>) => void,
): () => void {
  return onSnapshot(collection(db, "qaChecklist"), (snap) => {
    const map: Record<string, QaCheckStatus> = {};
    for (const d of snap.docs) {
      const data = d.data();
      map[d.id] = {
        status: data.status === "fail" ? "fail" : "pass",
        byUid: (data.byUid as string | undefined) ?? "",
        byName: (data.byName as string | undefined) ?? null,
        note: (data.note as string | undefined) ?? null,
        updatedAt: (data.updatedAt as Timestamp | undefined) ?? null,
      };
    }
    cb(map);
  });
}

/** Mark an item pass/fail, attributed to the caller. */
export async function setQaCheckStatus(
  itemId: string,
  status: "pass" | "fail",
  by: { uid: string; name: string | null },
  note: string | null = null,
): Promise<void> {
  await setDoc(doc(db, "qaChecklist", itemId), {
    status,
    byUid: by.uid,
    byName: by.name,
    note,
    updatedAt: serverTimestamp(),
  });
}

/** Clear an item back to untested. */
export async function clearQaCheck(itemId: string): Promise<void> {
  await deleteDoc(doc(db, "qaChecklist", itemId));
}
