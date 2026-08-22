// Read-side wrappers around the /disputes collection. Doc writes are
// server-only (via the Stripe webhook dispatcher); the one action an admin can
// take is pushing evidence to Stripe, which goes through a callable rather than
// a Firestore write.

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
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import type { DisputeDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const disputesCol = () =>
  collection(db, "disputes").withConverter(typedConverter<DisputeDoc>());
const disputeRef = (id: string) =>
  doc(db, "disputes", id).withConverter(typedConverter<DisputeDoc>());

// Admin queue: open disputes (everything except `won` / `lost` /
// `warning_closed`) sorted by evidence deadline ascending so the most
// urgent surface first. Inquiry-type disputes have a null
// `evidenceDueBy` and would be silently excluded by an `orderBy` on
// that field — Firestore's orderBy drops docs that lack the field.
// We orderBy `createdAt` instead and sort by deadline urgency in JS
// so inquiries stay in the queue (sorted last, since "no deadline"
// reads as "not urgent yet" rather than "missed deadline"). The
// closed disputes list below the queue is a separate query so it
// pages independently.
export async function listOpenDisputes(): Promise<WithId<DisputeDoc>[]> {
  const q = query(
    disputesCol(),
    where("outcome", "==", null),
    orderBy("createdAt", "desc"),
    limit(100),
  );
  const snap = await getDocs(q);
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  items.sort((a, b) => {
    const am = a.evidenceDueBy?.toMillis() ?? Number.POSITIVE_INFINITY;
    const bm = b.evidenceDueBy?.toMillis() ?? Number.POSITIVE_INFINITY;
    return am - bm;
  });
  return items;
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

/**
 * Rebuild the Stripe evidence draft from the job's current records, and
 * optionally submit it.
 *
 * `submit: true` is FINAL — Stripe accepts one submission per dispute and locks
 * the evidence afterwards, so the caller must confirm before passing it.
 */
export async function submitDisputeEvidence(
  disputeId: string,
  submit: boolean,
): Promise<{ ok: boolean; submitted: boolean }> {
  const fn = httpsCallable<
    { disputeId: string; submit: boolean },
    { ok: boolean; submitted: boolean }
  >(functions, "adminSubmitDisputeEvidence");
  const res = await fn({ disputeId, submit });
  return res.data;
}
