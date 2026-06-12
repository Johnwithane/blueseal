import { httpsCallable } from "firebase/functions";
import { doc, onSnapshot } from "firebase/firestore";
import { db, functions } from "@/firebase/config";
import { typedConverter } from "@/firebase/converters";
import type { SubscriptionPlan, SubscriptionState, UserDoc } from "@/firebase/interfaces";

/**
 * Start a Blue Seal Pro Checkout session and return the URL to redirect to.
 * (Subscription mode, 30-day trial when eligible — see the callable.)
 */
export async function createSubscriptionCheckout(
  plan: SubscriptionPlan,
): Promise<{ url: string | null }> {
  const fn = httpsCallable<{ plan: SubscriptionPlan }, { url: string | null }>(
    functions,
    "createSubscriptionCheckout",
  );
  const res = await fn({ plan });
  return res.data;
}

/** Open the Stripe Customer Portal (manage / cancel / switch plan / update card). */
export async function createBillingPortalSession(): Promise<{ url: string | null }> {
  const fn = httpsCallable<Record<string, never>, { url: string | null }>(
    functions,
    "createBillingPortalSession",
  );
  const res = await fn({});
  return res.data;
}

/** Live subscription state off the user's own doc. Returns the unsubscribe fn. */
export function subscribeSubscriptionState(
  uid: string,
  cb: (state: SubscriptionState | null) => void,
): () => void {
  const ref = doc(db, "users", uid).withConverter(typedConverter<UserDoc>());
  return onSnapshot(
    ref,
    (snap) => cb(snap.data()?.subscription ?? null),
    () => cb(null),
  );
}
