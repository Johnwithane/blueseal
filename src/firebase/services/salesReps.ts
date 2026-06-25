import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "@/firebase/config";

/** E-sign the current sales-rep liability agreement (a drawn signature data URL). */
export async function signSalesAgreement(
  signatureDataUrl: string,
): Promise<{ ok: true; version: string }> {
  const fn = httpsCallable<{ signatureDataUrl: string }, { ok: true; version: string }>(
    functions,
    "signSalesAgreement",
  );
  const res = await fn({ signatureDataUrl });
  return res.data;
}

/** Claim (or change) this rep's vanity referral code. Returns the stored code. */
export async function claimReferralCode(code: string): Promise<{ code: string }> {
  const fn = httpsCallable<{ code: string }, { code: string }>(functions, "claimReferralCode");
  const res = await fn({ code });
  return res.data;
}

/**
 * Best-effort availability check for the code-claim UI. The registry is
 * world-readable; `false` means taken (or owned by someone else). The claim
 * callable is the authority — this just gives instant feedback while typing.
 * `currentUid` lets the rep "re-claim" the code they already own without it
 * showing as taken.
 */
export async function isReferralCodeAvailable(
  codeLower: string,
  currentUid?: string,
): Promise<boolean> {
  const snap = await getDoc(doc(db, "referralCodes", codeLower));
  if (!snap.exists()) return true;
  return currentUid != null && snap.data()?.uid === currentUid;
}

export interface RepContact {
  hasRep: boolean;
  name?: string;
  email?: string | null;
  ownerKind?: "referral" | "region";
}

/** Tradesperson-facing: who is my Blue Seal rep (support contact), if any. */
export async function getMyRepContact(): Promise<RepContact> {
  const fn = httpsCallable<undefined, RepContact>(functions, "getMyRepContact");
  const { data } = await fn();
  return data;
}
