import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type FirestoreError,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import type { JobExtraDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

// "Change orders" in the UI; `extras` in the data model. A change order is an
// out-of-scope charge the tradesperson proposes after work starts and the
// client approves up front (the only way hourly money enters a fixed job).
// Writes are callable-only (admin SDK) so approval state can't be forged — the
// client just subscribes + calls the callables below.

const extrasCol = (jobId: string) =>
  collection(db, "jobs", jobId, "extras").withConverter(typedConverter<JobExtraDoc>());

export function subscribeJobExtras(
  jobId: string,
  cb: (extras: WithId<JobExtraDoc>[]) => void,
  onError?: (err: FirestoreError) => void,
): () => void {
  const q = query(extrasCol(jobId), orderBy("createdAt", "asc"));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.warn(`[Firestore] jobs/${jobId}/extras listener:`, err.code, err.message);
      onError?.(err);
    },
  );
}

export async function proposeExtra(input: {
  jobId: string;
  description: string;
  billingType: "flat" | "hourly";
  amountCents: number; // flat: the amount; hourly: the rate (cents/hr)
  estimatedHours?: number | null; // hourly only — display ballpark for the client
}): Promise<{ ok: true; extraId: string }> {
  const fn = httpsCallable<typeof input, { ok: true; extraId: string }>(functions, "proposeExtra");
  const res = await fn(input);
  return res.data;
}

export async function respondExtra(input: {
  jobId: string;
  extraId: string;
  accept: boolean;
  declinedReason?: string;
}): Promise<{ ok: true }> {
  const fn = httpsCallable<typeof input, { ok: true }>(functions, "respondExtra");
  const res = await fn(input);
  return res.data;
}

export async function cancelExtra(input: {
  jobId: string;
  extraId: string;
}): Promise<{ ok: true }> {
  const fn = httpsCallable<typeof input, { ok: true }>(functions, "cancelExtra");
  const res = await fn(input);
  return res.data;
}
