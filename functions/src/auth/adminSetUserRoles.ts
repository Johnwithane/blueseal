import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { CALLABLE_OPTS } from "../lib/callable";
import { adminAuth, db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";
import { newTradieDocDefaults } from "../lib/tradieProfile";

const Input = z.object({
  targetUid: z.string().min(1).max(128),
  roles: z
    .array(z.enum(["client", "tradesperson", "admin", "qa"]))
    .min(1)
    .refine((r) => new Set(r).size === r.length, "Roles must be unique"),
});

// Legacy single `role` claim/field: kept in sync for tokens issued before the
// multi-role cutover. Highest-privilege role wins so old rule checks behave.
function primaryRole(roles: string[]): string {
  if (roles.includes("admin")) return "admin";
  if (roles.includes("tradesperson")) return "tradesperson";
  return "client";
}

/**
 * Admin-only: set the full roles array on any user. Unlike `setAdminRole`
 * (admin-add only), this replaces the role set wholesale, so it can add OR
 * remove client / tradesperson / admin. Mirrors to both the user doc and Auth
 * custom claims.
 *
 * Side effects:
 * - Granting `tradesperson` to a user with no profile provisions a draft
 *   `tradespeople/{uid}` doc (still has to pass vetting to go live).
 * - Removing `tradesperson` hides their public profile (data is kept, so a
 *   re-grant restores it).
 *
 * Note: the target's existing ID token keeps its old claims until it refreshes
 * (next sign-in or ~1h), so role changes for *other* users aren't instant.
 */
export const adminSetUserRoles = onCall(CALLABLE_OPTS, async (req) => {
  const actor = requireAdmin(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
  const { targetUid } = parsed.data;
  const nextRoles: string[] = Array.from(new Set(parsed.data.roles));

  // Don't let an admin lock themselves out of the console.
  if (actor === targetUid && !nextRoles.includes("admin")) {
    throw new HttpsError("failed-precondition", "You can't remove your own admin role.");
  }

  // Refuse to mint claims for a UID that isn't a real Auth user.
  let current;
  try {
    current = await adminAuth.getUser(targetUid);
  } catch {
    throw new HttpsError("not-found", "Target user does not exist.");
  }

  const userRef = db.doc(`users/${targetUid}`);
  const userSnap = await userRef.get();
  const userData = (userSnap.exists ? userSnap.data() ?? {} : {}) as {
    roles?: unknown;
    role?: unknown;
    activeRole?: unknown;
    displayName?: unknown;
    photoURL?: unknown;
  };

  const tradieRef = db.doc(`tradespeople/${targetUid}`);
  if (nextRoles.includes("tradesperson")) {
    // Provision a draft profile if they don't have one yet (same shape the
    // onboarding wizard / addRoleToSelf use). Existing docs are left untouched.
    const tradieSnap = await tradieRef.get();
    if (!tradieSnap.exists) {
      await tradieRef.set(
        newTradieDocDefaults({
          displayName: typeof userData.displayName === "string" ? userData.displayName : "",
          photoURL: typeof userData.photoURL === "string" ? userData.photoURL : null,
          approved: false,
        }),
      );
    }
  } else {
    // Removing the role: drop them from public search but keep their data so a
    // future re-grant restores the profile. Best-effort.
    const tradieSnap = await tradieRef.get();
    if (tradieSnap.exists && tradieSnap.data()?.isVisible === true) {
      await tradieRef.set({ isVisible: false }, { merge: true });
    }
  }

  // Keep the current view-mode if it's still valid; otherwise fall back. qa is a
  // capability, never a view-mode, so it can never become the activeRole — fall
  // back to the first *view* role (a qa grant is always layered on client/
  // tradesperson, so one exists in practice).
  const viewRoles = nextRoles.filter((r) => r !== "qa");
  const currentActive =
    typeof userData.activeRole === "string" ? userData.activeRole : null;
  const activeRole =
    currentActive && currentActive !== "qa" && nextRoles.includes(currentActive)
      ? currentActive
      : viewRoles[0] ?? nextRoles[0];
  const legacyRole = primaryRole(nextRoles);

  // Snapshot for rollback if the claim write fails after the doc write.
  const prevDocRoles = Array.isArray(userData.roles)
    ? (userData.roles as unknown[]).filter((r): r is string => typeof r === "string")
    : null;
  const previousDocPatch = {
    roles: prevDocRoles,
    role: typeof userData.role === "string" ? userData.role : null,
    activeRole: currentActive,
  };

  // Firestore first, then claims (same ordering/rationale as setAdminRole): a
  // claim without a matching doc is the worse failure mode.
  await userRef.set({ roles: nextRoles, activeRole, role: legacyRole }, { merge: true });
  try {
    const existingClaims = (current.customClaims ?? {}) as Record<string, unknown>;
    await adminAuth.setCustomUserClaims(targetUid, {
      ...existingClaims,
      roles: nextRoles,
      role: legacyRole,
    });
  } catch (err) {
    logger.error("setCustomUserClaims failed; rolling back doc write", { targetUid, err });
    await userRef.set(previousDocPatch, { merge: true });
    throw new HttpsError("internal", "Failed to set roles; please retry.");
  }

  await logAdminAction({
    actorUid: actor,
    action: "adminSetUserRoles",
    targetType: "user",
    targetId: targetUid,
    metadata: { roles: nextRoles },
  });
  return { ok: true, roles: nextRoles, activeRole };
});
