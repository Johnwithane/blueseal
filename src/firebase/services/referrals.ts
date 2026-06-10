import { collection, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";
import type { ReferralDoc, WithId } from "@/firebase/interfaces";
import { typedConverter } from "@/firebase/converters";
import type { SendJobReferralInput } from "@/validation/schemas";

const referralsCol = () =>
  collection(db, "referrals").withConverter(typedConverter<ReferralDoc>());

// ---------------------------------------------------------------------------
// Callable wrapper — every write happens server-side. Rules deny client
// writes to /referrals outright.
// ---------------------------------------------------------------------------

export async function sendJobReferral(
  input: SendJobReferralInput,
): Promise<{ referralId: string }> {
  const callable = httpsCallable<SendJobReferralInput, { referralId: string }>(
    functions,
    "sendJobReferral",
  );
  const { data } = await callable(input);
  return data;
}

// ---------------------------------------------------------------------------
// Per-post reads. Result sets are tiny (a handful of referrals per post at
// most), so no orderBy — callers sort client-side if they care.
// ---------------------------------------------------------------------------

/** Referrals addressed to me for this post — drives the "Referred to you by" banner. */
export async function listReferralsToMeForPost(
  uid: string,
  postId: string,
): Promise<WithId<ReferralDoc>[]> {
  const snap = await getDocs(
    query(referralsCol(), where("toUserId", "==", uid), where("postId", "==", postId)),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Referrals I've already sent for this post — greys out picked recipients in the dialog. */
export async function listMyReferralsForPost(
  uid: string,
  postId: string,
): Promise<WithId<ReferralDoc>[]> {
  const snap = await getDocs(
    query(referralsCol(), where("fromUserId", "==", uid), where("postId", "==", postId)),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
