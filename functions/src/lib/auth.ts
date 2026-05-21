import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";

export function requireAuth(req: CallableRequest<unknown>): string {
  if (!req.auth?.uid) throw new HttpsError("unauthenticated", "Sign-in required.");
  return req.auth.uid;
}

export function requireRole(req: CallableRequest<unknown>, role: string): string {
  const uid = requireAuth(req);
  if (req.auth?.token.role !== role) {
    throw new HttpsError("permission-denied", `Role ${role} required.`);
  }
  return uid;
}

export function requireAdmin(req: CallableRequest<unknown>): string {
  return requireRole(req, "admin");
}
