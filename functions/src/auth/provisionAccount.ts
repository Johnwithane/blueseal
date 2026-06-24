import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, db } from "../lib/admin";
import { requireAuth } from "../lib/auth";
import { resolveReferralRepId } from "../lib/referralResolve";

const Input = z.object({
  role: z.enum(["client", "tradesperson"]),
  displayName: z.string().trim().min(1).max(120),
  termsAcceptedVersion: z.string().min(1).max(40),
  photoURL: z.string().url().max(2048).nullable().optional(),
  // Optional referral captured at signup (a rep's vanity code from ?ref= or a
  // typed code). Resolved server-side to the owning rep; an unknown/inactive
  // code is silently ignored (never blocks signup). referralSignal records how
  // it arrived, for attribution analytics.
  referralCode: z.string().trim().max(40).optional(),
  referralSignal: z.enum(["link", "code", "name"]).optional(),
});

/**
 * Creates the signed-in caller's `users/{uid}` profile doc and mirrors their
 * roles into custom claims — entirely server-side, via the Admin SDK.
 *
 * WHY THIS EXISTS: the user doc used to be created by the CLIENT, as the first
 * Firestore write of a brand-new session. That write raced the Auth→Firestore
 * token handshake — if the SDK hadn't yet attached the new ID token, the rules
 * saw `request.auth` as null/stale, `isOwner()` failed, and Firestore rejected
 * with permission-denied. That's the "You don't have permission to do that."
 * users hit on signup (intermittently, worse on iOS Safari / in-app browsers /
 * stale sessions). The Admin SDK bypasses security rules, so there is no token
 * to attach and no race to lose: doing the write here removes the failure mode
 * at the root rather than retrying through it. The client just refreshes its
 * token afterward to pick up the claims this sets. The `users` create rule is
 * locked to `if false` so a client can't reintroduce the racy write.
 *
 * IDEMPOTENT: if the doc already exists (a retry, or a returning user whose doc
 * was created another way) it leaves the profile untouched and only reconciles
 * claims to the doc's authoritative roles. It never grants a NEW role here
 * (addRoleToSelf owns role changes) and never resets profile fields.
 *
 * ROLES: a tradesperson is implicitly also a client (so they can hire without a
 * separate step), matching ensureSelfRoles' implied-role invariant. `admin`/`qa`
 * are never self-assignable here.
 */
export const provisionAccount = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
  const { role, displayName, termsAcceptedVersion, photoURL } = parsed.data;

  const userRef = db.doc(`users/${uid}`);
  const snap = await userRef.get();

  let roles: string[];
  let activeRole: string;
  const isNew = !snap.exists;

  if (snap.exists) {
    // Already provisioned — do NOT clobber the profile or grant a new role.
    // Reconcile claims to the doc's authoritative roles below.
    const data = snap.data() as { roles?: unknown; role?: unknown; activeRole?: unknown };
    roles = Array.isArray(data.roles)
      ? (data.roles as unknown[]).filter((r): r is string => typeof r === "string")
      : typeof data.role === "string"
        ? [data.role]
        : [role];
    activeRole = typeof data.activeRole === "string" ? data.activeRole : (roles[0] ?? role);
  } else {
    roles = role === "tradesperson" ? ["tradesperson", "client"] : ["client"];
    activeRole = role;
    // Resolve the referral code to its rep (only an active, signed rep counts).
    // Frozen on the user doc here — the canonical attribution. The free month is
    // granted at go-live (maybeMarkVisible); the tradesperson-doc mirror for
    // rep-scoped reads is stamped server-side at submitForVetting.
    const referredByRepId = parsed.data.referralCode
      ? await resolveReferralRepId(parsed.data.referralCode)
      : null;
    const referralSignal = referredByRepId ? (parsed.data.referralSignal ?? "code") : null;
    await userRef.set({
      roles,
      activeRole,
      displayName,
      // Trust the verified token's email over any client-supplied value.
      email: req.auth?.token.email ?? "",
      photoURL: photoURL ?? null,
      phone: null,
      createdAt: FieldValue.serverTimestamp(),
      lastActiveAt: FieldValue.serverTimestamp(),
      emailVerified: false,
      clientRatingAvg: 0,
      clientRatingCount: 0,
      termsAcceptedAt: FieldValue.serverTimestamp(),
      termsAcceptedVersion,
      deletedAt: null,
      notificationPrefs: { emailEnabled: true, whatsappEnabled: true },
      referredByRepId,
      referralSignal,
    });
    logger.info("Provisioned account", { uid, roles, referredByRepId });
  }

  // Mirror roles → claims immediately so the client's next getIdToken(true)
  // carries them. The setRoleOnSignup trigger (fired by the create above) is
  // the reliable backstop, so a transient Identity-Platform replication lag
  // here — brand-new Auth records can briefly 404 on getUser/setCustomUserClaims
  // — is non-fatal: swallow it and let the trigger finish the mirror.
  try {
    if (isNew) {
      // Fresh Auth record carries no prior claims; set directly (skips a
      // getUser that's the most lag-prone call right after account creation).
      await adminAuth.setCustomUserClaims(uid, { roles, role: activeRole });
    } else {
      const authUser = await adminAuth.getUser(uid);
      const existing = (authUser.customClaims ?? {}) as Record<string, unknown>;
      await adminAuth.setCustomUserClaims(uid, { ...existing, roles, role: activeRole });
    }
  } catch (e) {
    logger.warn("provisionAccount: claim set deferred to setRoleOnSignup trigger", { uid, e });
  }

  return { roles, activeRole };
});
