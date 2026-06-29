import { httpsCallable } from "firebase/functions";
import { functions } from "@/firebase/config";

/** Claim (or change) this project manager's vanity recruiting code. Returns the stored code. */
export async function claimPmCode(code: string): Promise<{ code: string }> {
  const fn = httpsCallable<{ code: string }, { code: string }>(functions, "claimPmCode");
  const res = await fn({ code });
  return res.data;
}
