// Branded auth emails — verification, password reset, email change. These go
// through Cloud Function callables (which generate the Firebase action link and
// send it via our Resend pipeline) instead of the Firebase client SDK's
// sendEmailVerification / sendPasswordResetEmail, which send unbranded mail from
// firebaseapp.com that lands in spam. See functions/src/auth/authEmails.ts.

import { httpsCallable } from "firebase/functions";
import { functions } from "@/firebase/config";

/** Re-send the signed-in user's verification email. No-op server-side if already verified. */
export async function sendVerificationEmail(): Promise<void> {
  const fn = httpsCallable<void, { ok: true }>(functions, "sendVerificationEmail");
  await fn();
}

/**
 * Request a password-reset email. Always resolves (the callable returns ok even
 * for an unknown address) so callers never leak account existence.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const fn = httpsCallable<{ email: string }, { ok: true }>(functions, "requestPasswordReset");
  await fn({ email });
}

/** Send a confirm-and-change link to the user's new email. Throws on "already in use". */
export async function requestEmailChange(newEmail: string): Promise<void> {
  const fn = httpsCallable<{ newEmail: string }, { ok: true }>(functions, "requestEmailChange");
  await fn({ newEmail });
}

/**
 * Request a passwordless sign-in link. Always resolves (the callable returns ok
 * even for an unknown address) so callers never leak account existence. The link
 * lands on /finish-signin to complete sign-in in-app.
 */
export async function requestSignInLink(email: string): Promise<void> {
  const fn = httpsCallable<{ email: string }, { ok: true }>(functions, "requestSignInLink");
  await fn({ email });
}
