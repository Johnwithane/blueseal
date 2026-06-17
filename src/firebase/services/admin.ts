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

/**
 * Admin-only: grant (or revoke, with `until: null`) a founding-member free
 * Blue Seal Pro comp. `until` is an ISO 8601 datetime string.
 */
export const adminGrantFoundingPro = httpsCallable<
  { uid: string; until: string | null },
  { ok: boolean; isPro: boolean; proCompUntil: string | null }
>(functions, "adminGrantFoundingPro");

export const submitForVetting = httpsCallable<Record<string, never>, { ok: boolean }>(
  functions,
  "submitForVetting",
);

// --- Admin support-desk account actions (see functions/src/admin/userSupport.ts) ---

/** Authoritative live Auth state for a user (the Firestore emailVerified mirror can lag). */
export interface AdminAuthState {
  ok: boolean;
  email: string | null;
  emailVerified: boolean;
  disabled: boolean;
  lastSignInTime: string | null;
  creationTime: string | null;
  providerIds: string[];
}

export const adminVerifyUserEmail = httpsCallable<{ targetUid: string }, { ok: boolean }>(
  functions,
  "adminVerifyUserEmail",
);

export const adminSendPasswordReset = httpsCallable<{ targetUid: string }, { ok: boolean }>(
  functions,
  "adminSendPasswordReset",
);

export const adminResendVerificationEmail = httpsCallable<{ targetUid: string }, { ok: boolean }>(
  functions,
  "adminResendVerificationEmail",
);

/** Returns the one-time temp password — show it once, never persist it. */
export const adminSetTempPassword = httpsCallable<
  { targetUid: string },
  { ok: boolean; tempPassword: string }
>(functions, "adminSetTempPassword");

export const adminSetUserDisabled = httpsCallable<
  { targetUid: string; disabled: boolean; reason?: string },
  { ok: boolean; disabled: boolean }
>(functions, "adminSetUserDisabled");

export const adminUpdateUserContact = httpsCallable<
  { targetUid: string; displayName?: string; phone?: string | null; email?: string },
  { ok: boolean; emailChanged: boolean }
>(functions, "adminUpdateUserContact");

export const adminGetUserAuthState = httpsCallable<{ targetUid: string }, AdminAuthState>(
  functions,
  "adminGetUserAuthState",
);

export const adminSoftDeleteUser = httpsCallable<
  { targetUid: string; reason?: string },
  { ok: boolean; alreadyPending: boolean }
>(functions, "adminSoftDeleteUser");

export const adminRestoreUser = httpsCallable<{ targetUid: string }, { ok: boolean }>(
  functions,
  "adminRestoreUser",
);

/**
 * Admin moderation: soft-hide or recover a public review or a job-board post.
 * Recoverable (nothing deleted). Hiding a review also recomputes the tradie's
 * rating server-side.
 */
export const adminModerateContent = httpsCallable<
  { kind: "review" | "jobPost"; id: string; hidden: boolean },
  { ok: boolean }
>(functions, "adminModerateContent");
