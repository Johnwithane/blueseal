import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";

export function requireAuth(req: CallableRequest<unknown>): string {
  if (!req.auth?.uid) throw new HttpsError("unauthenticated", "Sign-in required.");
  return req.auth.uid;
}

/**
 * Returns true if the caller's token carries the given role. Accepts both the
 * new `roles: string[]` claim and the legacy singular `role` claim so tokens
 * issued before the multi-role cutover keep working until refresh.
 */
function tokenHasRole(req: CallableRequest<unknown>, role: string): boolean {
  const token = req.auth?.token as { role?: unknown; roles?: unknown } | undefined;
  if (!token) return false;
  if (Array.isArray(token.roles) && token.roles.includes(role)) return true;
  return token.role === role;
}

export function requireRole(req: CallableRequest<unknown>, role: string): string {
  const uid = requireAuth(req);
  if (!tokenHasRole(req, role)) {
    throw new HttpsError("permission-denied", `Role ${role} required.`);
  }
  return uid;
}

/** Allows the caller through if they hold ANY of the given roles. */
export function requireAnyRole(req: CallableRequest<unknown>, roles: string[]): string {
  const uid = requireAuth(req);
  if (!roles.some((r) => tokenHasRole(req, r))) {
    throw new HttpsError("permission-denied", `One of roles [${roles.join(", ")}] required.`);
  }
  return uid;
}

export function requireRoleOrAdmin(req: CallableRequest<unknown>, role: string): string {
  const uid = requireAuth(req);
  if (!tokenHasRole(req, role) && !tokenHasRole(req, "admin")) {
    throw new HttpsError("permission-denied", `Role ${role} required.`);
  }
  return uid;
}

export function requireAdmin(req: CallableRequest<unknown>): string {
  return requireRole(req, "admin");
}
