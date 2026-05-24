// Read-side wrappers around the /disputes collection. Writes are
// server-only (via the Stripe webhook dispatcher) — there's nothing the
// client can do here besides observe + render.

import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/firebase/config";
import type { DisputeDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const disputesCol = () =>
  collection(db, "disputes").withConverter(typedConverter<DisputeDoc>());
const disputeRef = (id: string) =>
  doc(db, "disputes", id).withConverter(typedConverter<DisputeDoc>());

// Admin queue: open disputes (everything except `won` / `lost` /
// `warning_closed`) sorted by evidence deadline ascending so the most
// urgent surface first. The closed disputes list below the queue is a
// separate query so it pages independently.
export async function listOpenDisputes(): Promise<WithId<DisputeDoc>[]> {
  const q = query(
    disputesCol(),
    where("outcome", "==", null),
    orderBy("evidenceDueBy", "asc"),
    limit(100),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function listClosedDisputes(): Promise<WithId<DisputeDoc>[]> {
  const q = query(
    disputesCol(),
    where("outcome", "!=", null),
    orderBy("outcome"),
    orderBy("updatedAt", "desc"),
    limit(50),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function subscribeDispute(
  id: string,
  cb: (d: WithId<DisputeDoc> | null) => void,
): () => void {
  return onSnapshot(disputeRef(id), (snap) =>
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null),
  );
}
