// Admin support-desk account actions. Each is admin-only, validated with Zod,
// and audited via logAdminAction. The common shape mirrors adminSetUserRoles:
// requireAdmin → parse → look up the Auth user (→ not-found) → **Auth write
// first, Firestore mirror second** (Auth is the source of truth; a Firestore
// doc that disagrees with Auth is the staleness bug we're avoiding) → audit.
//
// None of these touch the temp password / reset link beyond returning it once
// to the caller — secrets are never written to logs or Firestore.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import { randomInt } from "node:crypto";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { adminAuth, db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";
import { deliver } from "../lib/brandedMail";
import { enforceRateLimit } from "../lib/rateLimit";
import { appBaseUrl } from "../prospects/helpers";

const TargetInput = z.object({ targetUid: z.string().min(1).max(128) });

const firebaseAuthCode = (err: unknown): string | undefined =>
  typeof err === "object" && err !== null && "code" in err
    ? (err as { code?: string }).code
    : undefined;

/** Look up the target Auth user; map a missing user to a clean not-found. */
async function getAuthUser(uid: string) {
  try {
    return await adminAuth.getUser(uid);
  } catch {
    throw new HttpsError("not-found", "Target user does not exist.");
  }
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

/**
 * Mark a user's email as verified (Auth + the Firestore mirror). Support uses
 * this when a customer can't complete the verification click themselves.
 */
export const adminVerifyUserEmail = onCall(CALLABLE_OPTS, async (req) => {
  const actor = requireAdmin(req);
  const parsed = TargetInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
  const { targetUid } = parsed.data;
  await getAuthUser(targetUid);

  await adminAuth.updateUser(targetUid, { emailVerified: true });
  await db.doc(`users/${targetUid}`).set({ emailVerified: true }, { merge: true });

  await logAdminAction({
    actorUid: actor,
    action: "adminVerifyUserEmail",
    targetType: "user",
    targetId: targetUid,
  });
  logger.info("adminVerifyUserEmail", { actor, targetUid });
  return { ok: true as const };
});

/**
 * Send the branded password-reset link to a user on the admin's behalf. Unlike
 * the public requestPasswordReset (which stays silent for non-existent accounts
 * to prevent enumeration), the admin knows the account exists, so failures
 * surface. Capped per target/day so a stuck admin can't mailbomb a user.
 */
export const adminSendPasswordReset = onCall(CALLABLE_OPTS, async (req) => {
  const actor = requireAdmin(req);
  const parsed = TargetInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
  const { targetUid } = parsed.data;
  const user = await getAuthUser(targetUid);
  if (!user.email) throw new HttpsError("failed-precondition", "This account has no email address.");

  await enforceRateLimit(
    targetUid,
    "admin_pwreset",
    10,
    "You've sent several reset emails to this user today. Try again tomorrow.",
  );

  let link: string;
  try {
    link = await adminAuth.generatePasswordResetLink(user.email, { url: `${appBaseUrl()}/login` });
  } catch (err) {
    logger.error("adminSendPasswordReset: link gen failed", { targetUid, code: firebaseAuthCode(err) });
    throw new HttpsError("internal", "Couldn't generate a reset link. Please try again.");
  }

  await deliver({
    to: user.email,
    subject: "Reset your Blue Seal password",
    title: "Reset your password",
    bodyLines: [
      "A Blue Seal team member started a password reset for your account.",
      "Tap the button below to choose a new password.",
      "If you weren't expecting this, you can safely ignore this email — your password won't change.",
    ],
    ctaLabel: "Reset password",
    ctaUrl: link,
  });

  await logAdminAction({
    actorUid: actor,
    action: "adminSendPasswordReset",
    targetType: "user",
    targetId: targetUid,
  });
  logger.info("adminSendPasswordReset", { actor, targetUid });
  return { ok: true as const };
});

/**
 * Resend the branded verification email to a user. Admin-targeted variant of
 * sendVerificationEmail (which only ever targets the signed-in user).
 */
export const adminResendVerificationEmail = onCall(CALLABLE_OPTS, async (req) => {
  const actor = requireAdmin(req);
  const parsed = TargetInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
  const { targetUid } = parsed.data;
  const user = await getAuthUser(targetUid);
  if (!user.email) throw new HttpsError("failed-precondition", "This account has no email address.");
  if (user.emailVerified) throw new HttpsError("failed-precondition", "This email is already verified.");

  await enforceRateLimit(
    targetUid,
    "admin_verify_email",
    10,
    "You've sent several verification emails to this user today. Try again tomorrow.",
  );

  let link: string;
  try {
    link = await adminAuth.generateEmailVerificationLink(user.email, { url: `${appBaseUrl()}/login` });
  } catch (err) {
    logger.error("adminResendVerificationEmail: link gen failed", { targetUid, code: firebaseAuthCode(err) });
    throw new HttpsError("internal", "Couldn't generate a verification link. Please try again.");
  }

  await deliver({
    to: user.email,
    subject: "Confirm your Blue Seal email",
    title: "Confirm your email",
    bodyLines: [
      "Please confirm your email address to finish setting up your Blue Seal account.",
      "Tap the button below to verify this address.",
      "If you didn't expect this, you can safely ignore this email.",
    ],
    ctaLabel: "Confirm email",
    ctaUrl: link,
  });

  await logAdminAction({
    actorUid: actor,
    action: "adminResendVerificationEmail",
    targetType: "user",
    targetId: targetUid,
  });
  logger.info("adminResendVerificationEmail", { actor, targetUid });
  return { ok: true as const };
});

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

/**
 * Crypto-random 16-char password from an unambiguous charset (no 0/O/1/l/I) so
 * it reads cleanly over the phone. randomInt is uniform + CSPRNG-backed.
 */
function generateTempPassword(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 16; i++) out += chars[randomInt(chars.length)];
  return out;
}

/**
 * Set a one-time temporary password and return it to the admin ONCE (e.g. to
 * read out on a support call). Existing sessions are revoked so the only way
 * back in is the new credential. The password is never logged or persisted —
 * the audit entry records only that a temp password was set.
 */
export const adminSetTempPassword = onCall(CALLABLE_OPTS, async (req) => {
  const actor = requireAdmin(req);
  const parsed = TargetInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
  const { targetUid } = parsed.data;
  await getAuthUser(targetUid);

  const tempPassword = generateTempPassword();
  await adminAuth.updateUser(targetUid, { password: tempPassword });
  await adminAuth.revokeRefreshTokens(targetUid);

  await logAdminAction({
    actorUid: actor,
    action: "adminSetTempPassword",
    targetType: "user",
    targetId: targetUid,
  });
  logger.info("adminSetTempPassword", { actor, targetUid });
  return { ok: true as const, tempPassword };
});

// ---------------------------------------------------------------------------
// Account access
// ---------------------------------------------------------------------------

const DisabledInput = z.object({
  targetUid: z.string().min(1).max(128),
  disabled: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Suspend (disable) or restore (enable) an Auth account. disabled:true blocks
 * sign-in immediately; revoking refresh tokens ends any live session at its
 * next refresh (≤1h) — not an instant hard kick, by design. The Firestore
 * disabledAt/disabledReason mirror lets the browse list flag suspended accounts
 * without an Auth round-trip per row. An admin can't suspend their own account.
 */
export const adminSetUserDisabled = onCall(CALLABLE_OPTS, async (req) => {
  const actor = requireAdmin(req);
  const parsed = DisabledInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
  const { targetUid, disabled, reason } = parsed.data;

  if (actor === targetUid && disabled) {
    throw new HttpsError("failed-precondition", "You can't suspend your own account.");
  }
  await getAuthUser(targetUid);

  await adminAuth.updateUser(targetUid, { disabled });
  if (disabled) await adminAuth.revokeRefreshTokens(targetUid);

  await db.doc(`users/${targetUid}`).set(
    {
      disabledAt: disabled ? FieldValue.serverTimestamp() : null,
      disabledReason: disabled ? reason ?? null : null,
    },
    { merge: true },
  );

  await logAdminAction({
    actorUid: actor,
    action: disabled ? "adminDisableUser" : "adminEnableUser",
    targetType: "user",
    targetId: targetUid,
    reason: reason ?? null,
  });
  logger.info("adminSetUserDisabled", { actor, targetUid, disabled });
  return { ok: true as const, disabled };
});

// ---------------------------------------------------------------------------
// Contact details
// ---------------------------------------------------------------------------

const ContactInput = z.object({
  targetUid: z.string().min(1).max(128),
  displayName: z.string().trim().min(1).max(80).optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().toLowerCase().email().max(200).optional(),
});

/**
 * Fix a user's contact details on their behalf. Email is the uniqueness
 * authority, so it's written to Auth FIRST: an email-already-exists there aborts
 * before the Firestore doc is touched (no desync). A changed email is marked
 * unverified — the admin can then verify or resend. displayName is mirrored to
 * the public tradesperson profile if one exists.
 */
export const adminUpdateUserContact = onCall(CALLABLE_OPTS, async (req) => {
  const actor = requireAdmin(req);
  const parsed = ContactInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
  const { targetUid, displayName, phone, email } = parsed.data;
  if (displayName === undefined && phone === undefined && email === undefined) {
    throw new HttpsError("invalid-argument", "Nothing to update.");
  }
  const user = await getAuthUser(targetUid);
  const emailChanged = email !== undefined && email !== (user.email ?? "").toLowerCase();

  if (emailChanged) {
    try {
      await adminAuth.updateUser(targetUid, { email, emailVerified: false });
    } catch (err) {
      if (firebaseAuthCode(err) === "auth/email-already-exists") {
        throw new HttpsError("already-exists", "That email is already in use by another account.");
      }
      logger.error("adminUpdateUserContact: email update failed", { targetUid, code: firebaseAuthCode(err) });
      throw new HttpsError("internal", "Couldn't update the email. Please try again.");
    }
  }

  const patch: Record<string, unknown> = {};
  if (displayName !== undefined) patch.displayName = displayName;
  if (phone !== undefined) patch.phone = phone ?? null;
  if (emailChanged) {
    patch.email = email;
    patch.emailVerified = false;
  }
  if (Object.keys(patch).length) await db.doc(`users/${targetUid}`).set(patch, { merge: true });

  if (displayName !== undefined) {
    const tradieRef = db.doc(`tradespeople/${targetUid}`);
    const tradieSnap = await tradieRef.get();
    if (tradieSnap.exists) await tradieRef.set({ displayName }, { merge: true });
  }

  const fields: string[] = [];
  if (displayName !== undefined) fields.push("displayName");
  if (phone !== undefined) fields.push("phone");
  if (emailChanged) fields.push("email");

  await logAdminAction({
    actorUid: actor,
    action: "adminUpdateUserContact",
    targetType: "user",
    targetId: targetUid,
    metadata: { fields },
  });
  logger.info("adminUpdateUserContact", { actor, targetUid, fields });
  return { ok: true as const, emailChanged };
});

// ---------------------------------------------------------------------------
// Authoritative Auth state (read-only)
// ---------------------------------------------------------------------------

/**
 * Read the live Auth record for the support panel. The Firestore emailVerified
 * mirror can lag (nothing syncs it when a user verifies via the hosted link),
 * so the panel shows this authoritative state on expand.
 */
export const adminGetUserAuthState = onCall(CALLABLE_OPTS, async (req) => {
  requireAdmin(req);
  const parsed = TargetInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
  const user = await getAuthUser(parsed.data.targetUid);
  return {
    ok: true as const,
    email: user.email ?? null,
    emailVerified: user.emailVerified,
    disabled: user.disabled,
    lastSignInTime: user.metadata.lastSignInTime ?? null,
    creationTime: user.metadata.creationTime ?? null,
    providerIds: user.providerData.map((p) => p.providerId),
  };
});

// ---------------------------------------------------------------------------
// Soft delete / restore
// ---------------------------------------------------------------------------

const SoftDeleteInput = z.object({
  targetUid: z.string().min(1).max(128),
  reason: z.string().trim().max(2000).optional(),
});

/**
 * Admin variant of requestAccountDeletion: soft-delete (set deletedAt), hide
 * the public tradesperson profile, and sign the user out. Reuses the existing
 * scheduledHardDelete 30-day wipe — no new scheduled job. Idempotent; an admin
 * can't delete their own account from here.
 */
export const adminSoftDeleteUser = onCall(CALLABLE_OPTS, async (req) => {
  const actor = requireAdmin(req);
  const parsed = SoftDeleteInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
  const { targetUid, reason } = parsed.data;
  if (actor === targetUid) {
    throw new HttpsError("failed-precondition", "You can't delete your own account from here.");
  }

  const userRef = db.doc(`users/${targetUid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError("not-found", "User not found.");
  if (userSnap.data()?.deletedAt) return { ok: true as const, alreadyPending: true };

  await userRef.set({ deletedAt: FieldValue.serverTimestamp() }, { merge: true });

  const tradieRef = db.doc(`tradespeople/${targetUid}`);
  const tradieSnap = await tradieRef.get();
  if (tradieSnap.exists && tradieSnap.data()?.isVisible === true) {
    await tradieRef.set({ isVisible: false }, { merge: true });
  }

  // Best-effort sign-out; the deletedAt seating check blocks re-login regardless.
  await adminAuth.revokeRefreshTokens(targetUid).catch(() => undefined);

  await logAdminAction({
    actorUid: actor,
    action: "adminSoftDeleteUser",
    targetType: "user",
    targetId: targetUid,
    reason: reason ?? null,
  });
  logger.info("adminSoftDeleteUser", { actor, targetUid });
  return { ok: true as const, alreadyPending: false };
});

/**
 * Recover a soft-deleted account inside the grace window (the recovery path the
 * deletedAt field comment points support at). Clears deletedAt; isVisible is
 * left as-is since we don't know its pre-deletion value.
 */
export const adminRestoreUser = onCall(CALLABLE_OPTS, async (req) => {
  const actor = requireAdmin(req);
  const parsed = TargetInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
  const { targetUid } = parsed.data;

  const userRef = db.doc(`users/${targetUid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError("not-found", "User not found.");

  await userRef.set({ deletedAt: null }, { merge: true });

  await logAdminAction({
    actorUid: actor,
    action: "adminRestoreUser",
    targetType: "user",
    targetId: targetUid,
  });
  logger.info("adminRestoreUser", { actor, targetUid });
  return { ok: true as const };
});
