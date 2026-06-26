// Client wrappers for the project-manager agreement + Stripe Connect callables, and
// live reads of the PM's own commission ledger. Mirrors repPayoutsService.ts: the
// payout state lives on users/{uid}.projectManager.payouts, and the PM reads their
// own commissions / commissionPayouts (rules allow ownerType == "pm" && ownerId ==
// uid). The two equality filters ride single-field auto-indexes (no composite
// index to deploy); callers sort in memory.

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

export async function signPmAgreement(
  signatureDataUrl: string,
): Promise<{ ok: true; version: string }> {
  const callable = httpsCallable<{ signatureDataUrl: string }, { ok: true; version: string }>(
    functions,
    "signPmAgreement",
  );
  const { data } = await callable({ signatureDataUrl });
  return data;
}

export async function createPmConnectAccount(): Promise<{ stripeAccountId: string }> {
  const callable = httpsCallable<undefined, { stripeAccountId: string }>(
    functions,
    "createPmConnectAccount",
  );
  const { data } = await callable();
  return data;
}

export async function createPmConnectOnboardingLink(): Promise<{
  url: string;
  expiresAt: number | null;
}> {
  const callable = httpsCallable<undefined, { url: string; expiresAt: number | null }>(
    functions,
    "createPmConnectOnboardingLink",
  );
  const { data } = await callable();
  return data;
}

export async function createPmConnectLoginLink(): Promise<{ url: string }> {
  const callable = httpsCallable<undefined, { url: string }>(
    functions,
    "createPmConnectLoginLink",
  );
  const { data } = await callable();
  return data;
}

const userRef = (uid: string) =>
  doc(db, "users", uid).withConverter(typedConverter<UserDoc>());

// Live payout-onboarding state from the PM's own user doc; account.updated keeps
// projectManager.payouts current.
export function subscribePmPayoutsState(
  uid: string,
  cb: (state: PayoutsState | null) => void,
): () => void {
  return onSnapshot(userRef(uid), (snap) => {
    cb(snap.exists() ? (snap.data().projectManager?.payouts ?? null) : null);
  });
}

const commissionsCol = () =>
  collection(db, "commissions").withConverter(typedConverter<CommissionDoc>());
const payoutsCol = () =>
  collection(db, "commissionPayouts").withConverter(typedConverter<CommissionPayoutDoc>());

export function subscribePmCommissions(
  pmId: string,
  cb: (commissions: WithId<CommissionDoc>[]) => void,
): () => void {
  const q = query(
    commissionsCol(),
    where("ownerType", "==", "pm"),
    where("ownerId", "==", pmId),
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export function subscribePmCommissionPayouts(
  pmId: string,
  cb: (payouts: WithId<CommissionPayoutDoc>[]) => void,
): () => void {
  const q = query(
    payoutsCol(),
    where("ownerType", "==", "pm"),
    where("ownerId", "==", pmId),
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
