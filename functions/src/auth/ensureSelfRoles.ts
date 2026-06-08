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

/**
 * Reconciles the caller's own roles to satisfy implied-role invariants
 * (currently: tradesperson ⇒ client). Idempotent — returns `{ changed: false }`
 * when nothing needs adding, so it's cheap to call defensively on session init.
 *
 * Deliberately does NOT touch `activeRole`: a tradesperson who gets the client
 * role silently added stays in their working view rather than being yanked into
 * the client view (which is what addRoleToSelf does for a user-initiated add).
 *
 * Auth-only (no role gate): the only role it can grant is `client`, which is
 * already self-grantable via addRoleToSelf, so this opens no new privilege. It
 * never adds `admin` or `tradesperson`.
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

  if (nextRoles.length === currentRoles.length) {
    return { changed: false, roles: currentRoles };
  }

  // Doc first (merge so activeRole + everything else is preserved), then claims.
  await userRef.set({ roles: nextRoles }, { merge: true });

  // Claims: derive from the doc's target shape but preserve an out-of-band
  // admin grant + any other existing claims (tenant, etc.). Keep the legacy
  // singular `role` claim pointing at whatever it already was.
  const authUser = await adminAuth.getUser(uid);
  const existing = (authUser.customClaims ?? {}) as Record<string, unknown>;
  const existingClaimRoles = rolesFromUnknown(existing.roles, existing.role);
  const claimRoles = [...nextRoles];
  if (existingClaimRoles.includes("admin") && !claimRoles.includes("admin")) {
    claimRoles.push("admin");
  }
  await adminAuth.setCustomUserClaims(uid, {
    ...existing,
    roles: claimRoles,
    role: typeof existing.role === "string" ? existing.role : claimRoles[0],
  });

  logger.info("ensureSelfRoles added implied roles", { ...ctx, from: currentRoles, to: nextRoles });
  return { changed: true, roles: nextRoles };
});
