// Client wrappers around the Stripe Connect callables + a live subscription
// to the tradesperson's mirrored payouts state. Components shouldn't call
// httpsCallable directly (per CLAUDE.md service pattern) — they go through
// this file so callable names + response shapes stay in one place.

import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import type { PayoutsState, TradespersonDoc } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";

const tradieRef = (uid: string) =>
  doc(db, "tradespeople", uid).withConverter(typedConverter<TradespersonDoc>());

export async function createConnectAccount(): Promise<{ stripeAccountId: string }> {
  const callable = httpsCallable<undefined, { stripeAccountId: string }>(
    functions,
    "createConnectAccount",
  );
  const { data } = await callable();
  return data;
}

export async function createConnectOnboardingLink(): Promise<{
  url: string;
  expiresAt: number | null;
}> {
  const callable = httpsCallable<
    undefined,
    { url: string; expiresAt: number | null }
  >(functions, "createConnectOnboardingLink");
  const { data } = await callable();
  return data;
}

export async function createConnectLoginLink(): Promise<{ url: string }> {
  const callable = httpsCallable<undefined, { url: string }>(
    functions,
    "createConnectLoginLink",
  );
  const { data } = await callable();
  return data;
}

export interface BackfillPayoutsResult {
  scanned: number;
  updated: number;
  alreadyPresent: number;
  pages: number;
}

// Admin-only: seeds `payouts: not_started` onto every approved
// tradesperson doc that doesn't have the field. One-shot migration for
// the Stripe Connect cutover. Idempotent — safe to re-run.
export async function backfillPayoutsField(): Promise<BackfillPayoutsResult> {
  const callable = httpsCallable<undefined, BackfillPayoutsResult>(
    functions,
    "backfillPayoutsField",
  );
  const { data } = await callable();
  return data;
}

// Subscribe to the payouts slice of the tradesperson doc. Wraps the full-doc
// subscription so callers that only care about payouts don't re-render on
// unrelated field changes — `onSnapshot` still fires, but the callback
// dedupes via JSON identity at the caller's discretion.
export function subscribePayoutsState(
  uid: string,
  cb: (state: PayoutsState | null) => void,
): () => void {
  return onSnapshot(tradieRef(uid), (snap) => {
    if (!snap.exists()) {
      cb(null);
      return;
    }
    cb(snap.data().payouts ?? null);
  });
}
