// Client wrappers for the sales-rep Stripe Connect callables + live reads of the
// rep's own commission ledger. Mirrors payoutsService.ts (the tradesperson side)
// but for reps: the payout state lives on users/{uid}.salesRep.payouts, and the
// rep reads their own commissions / commissionPayouts (rules allow
// where repId == uid). Queries deliberately omit orderBy so they ride the
// single-field auto-index (no composite index to deploy) — callers sort in memory.

import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import type {
  CommissionDoc,
  CommissionPayoutDoc,
  PayoutsState,
  UserDoc,
  WithId,
} from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

export async function createRepConnectAccount(): Promise<{ stripeAccountId: string }> {
  const callable = httpsCallable<undefined, { stripeAccountId: string }>(
    functions,
    "createRepConnectAccount",
  );
  const { data } = await callable();
  return data;
}

export async function createRepConnectOnboardingLink(): Promise<{
  url: string;
  expiresAt: number | null;
}> {
  const callable = httpsCallable<undefined, { url: string; expiresAt: number | null }>(
    functions,
    "createRepConnectOnboardingLink",
  );
  const { data } = await callable();
  return data;
}

export async function createRepConnectLoginLink(): Promise<{ url: string }> {
  const callable = httpsCallable<undefined, { url: string }>(
    functions,
    "createRepConnectLoginLink",
  );
  const { data } = await callable();
  return data;
}

const userRef = (uid: string) =>
  doc(db, "users", uid).withConverter(typedConverter<UserDoc>());

// Live payout-onboarding state from the rep's own user doc. The account.updated
// webhook keeps salesRep.payouts current, so this reflects "enabled" without a
// manual reload after the rep finishes Stripe onboarding.
export function subscribeRepPayoutsState(
  uid: string,
  cb: (state: PayoutsState | null) => void,
): () => void {
  return onSnapshot(userRef(uid), (snap) => {
    cb(snap.exists() ? (snap.data().salesRep?.payouts ?? null) : null);
  });
}

const commissionsCol = () =>
  collection(db, "commissions").withConverter(typedConverter<CommissionDoc>());
const payoutsCol = () =>
  collection(db, "commissionPayouts").withConverter(typedConverter<CommissionPayoutDoc>());

export function subscribeRepCommissions(
  repId: string,
  cb: (commissions: WithId<CommissionDoc>[]) => void,
): () => void {
  const q = query(commissionsCol(), where("repId", "==", repId));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export function subscribeRepCommissionPayouts(
  repId: string,
  cb: (payouts: WithId<CommissionPayoutDoc>[]) => void,
): () => void {
  const q = query(payoutsCol(), where("repId", "==", repId));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
