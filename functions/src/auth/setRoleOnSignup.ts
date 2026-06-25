import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import { adminAuth } from "../lib/admin";

const VALID_ROLES = ["client", "tradesperson"] as const;

/**
 * When a `users/{uid}` doc is created, mirror its roles to the user's Firebase
 * Auth custom claims so security rules and callable wrappers can gate without
 * a Firestore read.
 *
 * Multi-role: claims carry `roles: string[]`. The legacy singular `role` claim
 * is also written so any token issued in this transition window that gets read
 * by old code or pre-update rules still passes.
 */
export const setRoleOnSignup = onDocumentCreated("users/{uid}", async (event) => {
  const data = event.data?.data() as
    | { roles?: unknown; role?: unknown }
    | undefined;
  const uid = event.params.uid;

  // Accept new shape (`roles: string[]`) preferentially; fall back to legacy
  // `role: string` for any pre-cutover writes.
  const rawRoles = Array.isArray(data?.roles)
    ? (data!.roles as unknown[]).filter((r): r is string => typeof r === "string")
    : typeof data?.role === "string"
      ? [data.role]
      : [];
  const validRoles = rawRoles.filter((r): r is (typeof VALID_ROLES)[number] =>
    (VALID_ROLES as readonly string[]).includes(r),
  );
  if (validRoles.length === 0) {
    logger.warn("Refusing to mirror invalid roles from user doc", { uid, raw: data });
    return;
  }

  // Union with whatever known roles the claims already carry rather than
  // overwriting: this trigger runs async off the CREATE-time doc snapshot, so
  // ensureSelfRoles (called synchronously during signup) can have already
  // granted an implied role (tradesperson ⇒ client) before we execute —
  // overwriting from the stale snapshot would clobber it. Also preserves an
  // out-of-band admin grant and merges non-role claims (tenant, region, etc.).
  // qa + sales are included so an out-of-band admin grant already on the claims
  // survives the union here (signup never *sources* them — VALID_ROLES above
  // stays client/tradesperson only).
  const KNOWN_CLAIM_ROLES = ["client", "tradesperson", "admin", "qa", "sales"];
  const current = await adminAuth.getUser(uid);
  const existing = (current.customClaims ?? {}) as {
    roles?: unknown;
    role?: unknown;
  };
  const existingRoles = Array.isArray(existing.roles)
    ? (existing.roles as unknown[]).filter((r): r is string => typeof r === "string")
    : typeof existing.role === "string"
      ? [existing.role]
      : [];
  const roles: string[] = [...validRoles];
  for (const r of existingRoles) {
    if (KNOWN_CLAIM_ROLES.includes(r) && !roles.includes(r)) {
      roles.push(r);
    }
  }

  const merged = {
    ...existing,
    roles,
    // Legacy compat: keep `role` set to the active/primary role so any
    // un-updated rule path still sees it during the transition.
    role: roles[0],
  };

  await adminAuth.setCustomUserClaims(uid, merged);
  logger.info("Mirrored roles to claim", { uid, roles });
});
