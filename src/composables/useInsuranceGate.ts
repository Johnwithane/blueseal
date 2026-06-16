import { getInsurance } from "@/firebase/services/insuranceVerifications";
import { useAuthStore } from "@/stores/auth";
import { useInsurancePromptStore } from "@/stores/insurancePrompt";

/**
 * Soft insurance gate for the bid/quote flows. Returns true when the caller
 * should go ahead with the submit — either the tradesperson has proof of
 * insurance on file, or they saw the reminder and chose to continue anyway.
 *
 * "Has proof" = an insurance submission that isn't rejected and hasn't expired
 * (pending OR approved both count — they've uploaded a certificate). That
 * mirrors the product rule exactly: we only nudge pros with no current proof.
 * The reminder is a nudge, not a hard requirement, so every uncertain path
 * (not signed in, read error) fails OPEN and lets the submit through — the
 * server-side rules remain the real authorization boundary.
 */
export function useInsuranceGate() {
  const auth = useAuthStore();
  const prompt = useInsurancePromptStore();

  async function hasProofOnFile(): Promise<boolean> {
    const uid = auth.fbUser?.uid;
    if (!uid) return true;
    try {
      const doc = await getInsurance(uid);
      if (!doc || doc.status === "rejected") return false;
      const expires = doc.expiresAt?.toDate?.();
      if (expires && expires.getTime() <= Date.now()) return false;
      return true;
    } catch {
      return true;
    }
  }

  async function ensureInsuredOrConfirm(): Promise<boolean> {
    if (await hasProofOnFile()) return true;
    return prompt.prompt();
  }

  return { ensureInsuredOrConfirm };
}
