import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { logger } from "firebase-functions/v2";
import { adminAuth, db } from "../lib/admin";
import { requireAuth } from "../lib/auth";

/**
 * Implied-role invariant: holding `tradesperson` implies `client`. Every vetted
 * pro can also hire / post jobs, so they never have to manually add the client
 * role. Pure + idempotent; appends `client` (keeping the existing order so the
 * tradesperson stays `roles[0]`). Other roles pass through untouched — a plain
 * client is NOT auto-granted tradesperson (that stays gated behind vetting via
 * addRoleToSelf).
 */
function withImpliedRoles(roles: string[]): string[] {
  if (roles.includes("tradesperson") && !roles.includes("client")) {
    return [...roles, "client"];
  }
  return roles;
}

function rolesFromUnknown(value: unknown, legacy: unknown): string[] {
  if (Array.isArray(value)) return value.filter((r): r is string => typeof r === "string");
  if (typeof legacy === "string") return [legacy];
  return [];
}

// Roles a user doc can legitimately carry from self-service flows. Claims are
// only ever mirrored from this set — `admin` is preserved from existing claims
// but never sourced from the doc (defense in depth alongside the /users rules,
// mirrors setRoleOnSignup's VALID_ROLES discipline).
const PUBLIC_ROLES = ["client", "tradesperson"] as const;

/**
 * Reconciles the caller's own roles in two directions:
 *
 * 1. Implied-role invariants on the doc (currently: tradesperson ⇒ client).
 * 2. Doc → claims: if the auth token's custom claims are missing roles the
 *    doc holds, mirror them synchronously.
 *
 * (2) is what makes signup deterministic: setRoleOnSignup mirrors claims via
 * an async Firestore trigger, which RACES the client's post-signup token
 * refresh — when the refresh wins, the session caches a role-less token for
 * ~1h and every role-gated callable rejects ("Role client required") until
 * the next refresh. signUp/signInWithGoogle await this callable before
 * refreshing, so the refreshed token is guaranteed to carry the role.
 *
 * Idempotent — returns `{ changed: false }` when doc and claims are already
 * consistent, so it's cheap to call defensively on session init.
 *
 * Deliberately does NOT touch `activeRole`: a tradesperson who gets the client
 * role silently added stays in their working view rather than being yanked into
 * the client view (which is what addRoleToSelf does for a user-initiated add).
 *
 * Auth-only (no role gate): it only grants `client` (already self-grantable
 * via addRoleToSelf) and only mirrors PUBLIC_ROLES the rules-gated doc already
 * holds, so this opens no new privilege. It never adds `admin`.
 */
export const ensureSelfRoles = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAuth(req);
  const ctx = { fn: "ensureSelfRoles", uid };

  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError("not-found", "User record missing.");
  const userData = userSnap.data() as { roles?: unknown; role?: unknown } | undefined;

  const currentRoles = rolesFromUnknown(userData?.roles, userData?.role);
  const nextRoles = withImpliedRoles(currentRoles);
  const docChanged = nextRoles.length !== currentRoles.length;

  if (docChanged) {
    // Merge so activeRole + everything else is preserved.
    await userRef.set({ roles: nextRoles }, { merge: true });
  }

  // Claims: derive from the doc's target shape but preserve an out-of-band
  // admin grant + any other existing claims (tenant, etc.). Keep the legacy
  // singular `role` claim pointing at whatever it already was.
  const targetRoles = nextRoles.filter((r) =>
    (PUBLIC_ROLES as readonly string[]).includes(r),
  );
  const authUser = await adminAuth.getUser(uid);
  const existing = (authUser.customClaims ?? {}) as Record<string, unknown>;
  const existingClaimRoles = rolesFromUnknown(existing.roles, existing.role);
  const claimRoles = [...targetRoles];
  if (existingClaimRoles.includes("admin") && !claimRoles.includes("admin")) {
    claimRoles.push("admin");
  }
  const claimsChanged =
    claimRoles.length !== existingClaimRoles.length ||
    claimRoles.some((r) => !existingClaimRoles.includes(r));
  if (claimsChanged) {
    await adminAuth.setCustomUserClaims(uid, {
      ...existing,
      roles: claimRoles,
      role: typeof existing.role === "string" ? existing.role : claimRoles[0],
    });
  }

  if (docChanged || claimsChanged) {
    logger.info("ensureSelfRoles reconciled", {
      ...ctx,
      docChanged,
      claimsChanged,
      from: { docRoles: currentRoles, claimRoles: existingClaimRoles },
      to: nextRoles,
    });
  }
  return { changed: docChanged || claimsChanged, roles: nextRoles };
});
