import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";

/** Claim (or change) this project manager's vanity recruiting code. Returns the stored code. */
export async function claimPmCode(code: string): Promise<{ code: string }> {
  const fn = httpsCallable<{ code: string }, { code: string }>(functions, "claimPmCode");
  const res = await fn({ code });
  return res.data;
}

/**
 * Best-effort availability check for the code-claim UI. The pmReferralCodes
 * registry is world-readable; `false` means taken (or owned by someone else). The
 * claim callable is the authority — this just gives instant feedback while typing.
 * `currentUid` lets a PM "re-claim" the code they already own without it showing as taken.
 */
export async function isPmCodeAvailable(codeLower: string, currentUid?: string): Promise<boolean> {
  const snap = await getDoc(doc(db, "pmReferralCodes", codeLower));
  if (!snap.exists()) return true;
  return currentUid != null && snap.data()?.uid === currentUid;
}
