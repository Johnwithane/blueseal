import { httpsCallable } from "firebase/functions";
import { functions } from "@/firebase/config";
import type { Role } from "@/firebase/interfaces";

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

/**
 * Admin-only: set a user's full roles array (add/remove client, tradesperson,
 * admin). The target's claims update on their next token refresh, not instantly.
 */
export const adminSetUserRoles = httpsCallable<
  { targetUid: string; roles: Role[] },
  { ok: boolean; roles: Role[]; activeRole: Role }
>(functions, "adminSetUserRoles");

/** Admin-only: set a tradesperson's trades (also marked verified). */
export const adminSetUserTrades = httpsCallable<
  { targetUid: string; trades: string[] },
  { ok: boolean; trades: string[] }
>(functions, "adminSetUserTrades");

export const submitForVetting = httpsCallable<Record<string, never>, { ok: boolean }>(
  functions,
  "submitForVetting",
);
