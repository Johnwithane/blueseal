// Branded auth emails — verification, password reset, and email change — sent
// through OUR Resend pipeline instead of Firebase Auth's built-in mailer.
//
// Why: Firebase's default emails go out from noreply@<project>.firebaseapp.com,
// a domain with no SPF/DKIM/DMARC alignment to blueseal.app, so inbox providers
// junk them and they're unbranded. Every other transactional email already
// lands in the inbox via enqueueMail() → "Trigger Email" extension → Resend
// (from Blue Seal <noreply@blueseal.app>, a verified domain). These callables
// generate the Firebase action link with the Admin SDK (generation does NOT
// send — only the client SDK auto-sends) and deliver it through that same
// branded pipeline. The client therefore STOPS calling sendEmailVerification /
// sendPasswordResetEmail, so there's no double email.
//
// The action links use Firebase's HOSTED action handler (no handleCodeInApp):
// clicking verifies / resets on Firebase's page, then continues to `url`. No
// in-app verify/reset route needed, and password-reset UX is unchanged.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { adminAuth } from "../lib/admin";
import { requireAuth } from "../lib/auth";
import { enforceRateLimit } from "../lib/rateLimit";
import { deliver } from "../lib/brandedMail";
import { appBaseUrl, emailHashOf } from "../prospects/helpers";

const firebaseAuthCode = (err: unknown): string | undefined =>
  typeof err === "object" && err !== null && "code" in err
    ? (err as { code?: string }).code
    : undefined;

/**
 * Map an action-link generation failure to a friendly HttpsError. Google's
 * Identity Toolkit throttles link generation per email when it's hit
 * repeatedly (e.g. someone resending many times) — it surfaces as
 * auth/too-many-requests, or auth/internal-error wrapping
 * "TOO_MANY_ATTEMPTS_TRY_LATER". Without this, that bubbles up as a raw 500 /
 * INTERNAL. Anything else becomes a generic internal error (never the raw
 * provider message).
 */
function linkGenHttpsError(fn: string, err: unknown): HttpsError {
  const code = firebaseAuthCode(err);
  const msg = err instanceof Error ? err.message : String(err);
  if (code === "auth/too-many-requests" || /TOO_MANY_ATTEMPTS/i.test(msg)) {
    return new HttpsError(
      "resource-exhausted",
      "Too many email requests just now. Please wait a couple of minutes, then try again.",
    );
  }
  logger.error(`${fn}: link generation failed`, { code, msg });
  return new HttpsError("internal", "Couldn't send the email. Please try again.");
}

/**
 * Send a branded email-verification link to the signed-in user. Requires auth
 * (the just-created user); no role gate (a brand-new user has no claims yet).
 * Short-circuits when the email is already verified — which also means the
 * orphaned-account self-heal no longer fires a pointless verify email at an
 * already-verified (e.g. Google) account.
 */
export const sendVerificationEmail = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const token = req.auth?.token as { email?: string; email_verified?: boolean } | undefined;
  const email = token?.email;
  if (!email) {
    // Federated-only accounts can lack a token email; nothing to verify here.
    throw new HttpsError("failed-precondition", "No email on this account.");
  }
  if (token?.email_verified === true) return { ok: true as const };

  await enforceRateLimit(
    uid,
    "verify_email",
    5,
    "Too many verification emails. Please try again tomorrow.",
  );

  // After verifying, a signed-in user (the common same-device case) lands on
  // their dashboard. (A cross-device click where they're not signed in bounces
  // to Home via the auth guard — still no 404.)
  let link: string;
  try {
    link = await adminAuth.generateEmailVerificationLink(email, {
      url: `${appBaseUrl()}/dashboard`,
    });
  } catch (err) {
    throw linkGenHttpsError("sendVerificationEmail", err);
  }

  await deliver({
    to: email,
    subject: "Confirm your Blue Seal email",
    title: "Confirm your email",
    bodyLines: [
      "Welcome to Blue Seal — verified Canadian tradespeople.",
      "Tap the button below to confirm your email address and finish setting up your account.",
      "If you didn't create a Blue Seal account, you can safely ignore this email.",
    ],
    ctaLabel: "Confirm email",
    ctaUrl: link,
  });

  logger.info("sendVerificationEmail: queued", { uid });
  return { ok: true as const };
});

const ResetInput = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
});

/**
 * Send a branded password-reset link. UNauthenticated by design (the forgot-
 * password page is for logged-out users) — App Check (CALLABLE_OPTS) plus a
 * per-email daily cap are the abuse guards. Always returns { ok: true }: a
 * non-existent address never reveals itself (matches ForgotPasswordView, which
 * always shows the success state).
 */
export const requestPasswordReset = onCall(CALLABLE_OPTS, async (req) => {
  const parsed = ResetInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Enter a valid email.");
  const { email } = parsed.data;

  // Rate-limit on a HASH of the email so raw addresses never land in
  // rateLimits/ and a victim can't be mailbombed. Increment BEFORE generating
  // so the cap binds regardless of whether the account exists.
  await enforceRateLimit(
    emailHashOf(email),
    "pwreset",
    5,
    "Too many reset requests. Please try again tomorrow.",
  );

  try {
    const link = await adminAuth.generatePasswordResetLink(email, {
      url: `${appBaseUrl()}/sign-in`,
    });
    await deliver({
      to: email,
      subject: "Reset your Blue Seal password",
      title: "Reset your password",
      bodyLines: [
        "We got a request to reset the password for your Blue Seal account.",
        "Tap the button below to choose a new password.",
        "If you didn't request this, you can safely ignore this email — your password won't change.",
      ],
      ctaLabel: "Reset password",
      ctaUrl: link,
    });
  } catch (err) {
    // user-not-found / invalid-email (or any error) must NOT leak — succeed
    // silently so account existence can't be probed.
    logger.info("requestPasswordReset: not sent", { code: firebaseAuthCode(err) });
  }

  return { ok: true as const };
});

const SignInLinkInput = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
});

/**
 * Send a branded passwordless SIGN-IN link. UNauthenticated by design — it's for
 * logged-out users on the sign-in page, and especially for invited tradespeople
 * who were onboarded via a magic link and never set a password. Unlike
 * reset/verify (Firebase's hosted handler), a sign-in link MUST complete in-app,
 * so it carries handleCodeInApp + lands on /finish-signin, which calls
 * signInWithEmailLink. App Check (CALLABLE_OPTS) + a per-email daily cap guard
 * abuse; always returns ok so account existence never leaks.
 */
export const requestSignInLink = onCall(CALLABLE_OPTS, async (req) => {
  const parsed = SignInLinkInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Enter a valid email.");
  const { email } = parsed.data;

  await enforceRateLimit(
    emailHashOf(email),
    "signin_link",
    8,
    "Too many sign-in link requests. Please try again later.",
  );

  try {
    const link = await adminAuth.generateSignInWithEmailLink(email, {
      url: `${appBaseUrl()}/finish-signin?email=${encodeURIComponent(email)}`,
      handleCodeInApp: true,
    });
    await deliver({
      to: email,
      subject: "Your Blue Seal sign-in link",
      title: "Sign in to Blue Seal",
      bodyLines: [
        "Tap the button below to sign in. No password needed.",
        "This link signs you in once and expires shortly. If you didn't request it, you can safely ignore this email.",
      ],
      ctaLabel: "Sign in",
      ctaUrl: link,
    });
  } catch (err) {
    // Throttle or any error must not leak — succeed silently.
    logger.info("requestSignInLink: not sent", { code: firebaseAuthCode(err) });
  }

  return { ok: true as const };
});

const ChangeInput = z.object({
  newEmail: z.string().trim().toLowerCase().email().max(200),
});

/**
 * Send a branded verify-and-change-email link to the user's NEW address. The
 * account email only changes once they click. Requires auth (it's the user's
 * own account). Surfaces "already in use" — standard for a self-service email
 * change (the caller is authenticated; this isn't stranger enumeration).
 *
 * NB: Firebase also sends a security/revert notice to the OLD address via its
 * built-in mailer. That's an intentional safety email and out of scope to
 * rebrand here.
 */
export const requestEmailChange = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const currentEmail = (req.auth?.token as { email?: string } | undefined)?.email;
  if (!currentEmail) {
    throw new HttpsError("failed-precondition", "No email on this account.");
  }

  const parsed = ChangeInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Enter a valid email.");
  const { newEmail } = parsed.data;
  if (newEmail === currentEmail.toLowerCase()) {
    throw new HttpsError("invalid-argument", "That's already your email address.");
  }

  await enforceRateLimit(
    uid,
    "email_change",
    5,
    "Too many email-change requests. Please try again tomorrow.",
  );

  let link: string;
  try {
    link = await adminAuth.generateVerifyAndChangeEmailLink(currentEmail, newEmail, {
      url: `${appBaseUrl()}/account`,
    });
  } catch (err) {
    if (firebaseAuthCode(err) === "auth/email-already-exists") {
      throw new HttpsError("already-exists", "That email is already in use.");
    }
    throw linkGenHttpsError("requestEmailChange", err);
  }

  await deliver({
    to: newEmail,
    subject: "Confirm your new Blue Seal email",
    title: "Confirm your new email",
    bodyLines: [
      `Confirm ${newEmail} as the new email for your Blue Seal account.`,
      "Tap the button below to verify this address and switch your account over to it.",
      "If you didn't request this change, you can ignore this email and your address stays the same.",
    ],
    ctaLabel: "Confirm new email",
    ctaUrl: link,
  });

  logger.info("requestEmailChange: queued", { uid });
  return { ok: true as const };
});
