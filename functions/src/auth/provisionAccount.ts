import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, db } from "../lib/admin";
import { requireAuth } from "../lib/auth";
import { resolveReferralRepId } from "../lib/referralResolve";
import { initialProjectManagerState, resolvePmId } from "../lib/projectManager";
import { sendPmWelcomeEmail } from "../projectManager/welcomeEmail";

const Input = z.object({
  role: z.enum(["client", "tradesperson", "projectManager"]),
  displayName: z.string().trim().min(1).max(120),
  termsAcceptedVersion: z.string().min(1).max(40),
  photoURL: z.string().url().max(2048).nullable().optional(),
  // Optional referral captured at signup (a rep's vanity code from ?ref= or a
  // typed code). Resolved server-side to the owning rep; an unknown/inactive
  // code is silently ignored (never blocks signup). referralSignal records how
  // it arrived, for attribution analytics.
  // .nullable() matters: the client always includes these keys and the
  // callable SDK sends absent values as null, which bare .optional() rejects —
  // that failure breaks every signup (same pattern as photoURL above).
  referralCode: z.string().trim().max(40).nullable().optional(),
  referralSignal: z.enum(["link", "code", "name"]).nullable().optional(),
  // Optional PM recruiting code from /join?pm=CODE. Only honored for a
  // tradesperson signup; resolved to an active project manager server-side.
  pmCode: z.string().trim().max(40).nullable().optional(),
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
    roles =
      role === "tradesperson"
        ? ["tradesperson", "client"]
        : role === "projectManager"
          ? ["projectManager", "client"]
          : ["client"];
    activeRole = role;
    // Resolve the referral code to its rep (only an active, signed rep counts).
    // Frozen on the user doc here — the canonical attribution. The free month is
    // granted at go-live (maybeMarkVisible); the tradesperson-doc mirror for
    // rep-scoped reads is stamped server-side at submitForVetting.
    const referredByRepId = parsed.data.referralCode
      ? await resolveReferralRepId(parsed.data.referralCode)
      : null;
    const referralSignal = referredByRepId ? (parsed.data.referralSignal ?? "code") : null;
    // PM recruiting attribution (only for tradesperson signups). Resolved to an
    // active PM; drives the free month at go-live + the saved-trades auto-add below.
    const referredByPmId =
      role === "tradesperson" && parsed.data.pmCode
        ? await resolvePmId(parsed.data.pmCode)
        : null;
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
      referredByPmId,
      // A PM is active the instant the role is enabled (self-serve, no vetting);
      // the liability agreement is signed later at payout setup.
      ...(role === "projectManager" ? { projectManager: initialProjectManagerState() } : {}),
    });
    logger.info("Provisioned account", { uid, roles, referredByRepId });
    // Direct signup as a project manager — welcome them (best-effort).
    if (role === "projectManager") await sendPmWelcomeEmail(uid);
    // PM-recruited tradesperson: add them to the recruiting PM's saved trades so
    // they appear as a preferred contractor once live (the free Pro month is
    // granted at go-live; see maybeMarkVisible).
    if (referredByPmId) {
      await db
        .doc(`users/${referredByPmId}/savedTradies/${uid}`)
        .set({ createdAt: FieldValue.serverTimestamp() }, { merge: true });
    }
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

  // `isNew` lets the client tell a fresh provision from an idempotent reconcile
  // WITHOUT a racy client-side users/{uid} read right after sign-in (which loses
  // the Auth→Firestore token handshake and surfaces a spurious permission-denied
  // on the Google/magic-link paths). The server already knows from snap.exists.
  return { roles, activeRole, isNew };
});
