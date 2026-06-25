// Admin sales-reps console services: the rep roster + earnings (server-aggregated
// callable, since the client can't list users / other reps' commissions), the
// activate/deactivate toggle, payout-batch reconciliation, and a direct read of
// payout batches needing attention (admins may read any commissionPayouts).

import { collection, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import { typedConverter } from "@/firebase/converters";
import type { CommissionPayoutDoc, WithId } from "@/firebase/interfaces";

export interface RepSummary {
  uid: string;
  displayName: string;
  email: string;
  referralCode: string;
  active: boolean;
  liabilitySigned: boolean;
  payoutsStatus: string;
  regionNames: string[];
  unpaidCents: number;
  paidCents: number;
}

export async function listSalesReps(): Promise<RepSummary[]> {
  const fn = httpsCallable<undefined, { reps: RepSummary[] }>(functions, "adminListSalesReps");
  const { data } = await fn();
  return data.reps;
}

export async function setRepActive(repId: string, active: boolean): Promise<void> {
  const fn = httpsCallable<{ repId: string; active: boolean }, { ok: true }>(
    functions,
    "adminSetRepActive",
  );
  await fn({ repId, active });
}

export async function retryPayoutBatch(batchId: string): Promise<{ transferId: string }> {
  const fn = httpsCallable<{ batchId: string }, { ok: true; transferId: string }>(
    functions,
    "adminRetryPayoutBatch",
  );
  const { data } = await fn({ batchId });
  return { transferId: data.transferId };
}

// Payout batches an admin should look at: still processing (pending) or rejected
// (failed). The per-doc rule passes for admins, so the `in` query is allowed and
// rides the single-field auto-index on status.
export async function listPayoutBatchesNeedingAttention(): Promise<
  WithId<CommissionPayoutDoc>[]
> {
  const col = collection(db, "commissionPayouts").withConverter(
    typedConverter<CommissionPayoutDoc>(),
  );
  const snap = await getDocs(query(col, where("status", "in", ["pending", "failed"])));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
