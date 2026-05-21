import { httpsCallable } from "firebase/functions";
import { functions } from "@/firebase/config";

export const approveApplication = httpsCallable<{ tradieUid: string }, { ok: boolean }>(
  functions,
  "approveApplication",
);

export const requestApplicationInfo = httpsCallable<
  { tradieUid: string; notes: string },
  { ok: boolean }
>(functions, "requestApplicationInfo");

export const rejectApplication = httpsCallable<
  { tradieUid: string; reason: string },
  { ok: boolean }
>(functions, "rejectApplication");

export const setAdminRole = httpsCallable<{ targetUid: string }, { ok: boolean }>(
  functions,
  "setAdminRole",
);

export const submitForVetting = httpsCallable<Record<string, never>, { ok: boolean }>(
  functions,
  "submitForVetting",
);
