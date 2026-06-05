import { logger } from "firebase-functions/v2";
import { adminAuth, db } from "./admin";
import { newTradieDocDefaults } from "./tradieProfile";

const ALL_ROLES = ["client", "tradesperson", "admin"];

/**
 * Idempotently puts the given admin into "full testing" state: all three roles
 * (client + tradesperson + admin) on both the Auth claims and the user doc,
 * plus a visible, approved `tradespeople/{uid}` profile so they can exercise
 * the entire app (post jobs, browse the marketplace, submit applications).
 *
 * The vetting gate that applies to real client→tradesperson role-adds is
 * intentionally bypassed here — admins are already trusted.
 *
 * Shared by `grantAllRolesForAdminTesting` and `grantAllTradesForAdminTesting`
 * so the latter is self-sufficient (a single click gives the caller a fully
 * usable tradesperson profile to attach every trade to).
 */
export async function ensureAdminTestingProfile(uid: string): Promise<{ roles: string[] }> {
  // Roles → claims + user doc. Always include all three for a clean state.
  const authUser = await adminAuth.getUser(uid);
  const existingClaims = (authUser.customClaims ?? {}) as Record<string, unknown>;
  await adminAuth.setCustomUserClaims(uid, {
    ...existingClaims,
    roles: ALL_ROLES,
    role: "admin",
  });

  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  const userData = (userSnap.exists ? userSnap.data() ?? {} : {}) as {
    activeRole?: unknown;
    displayName?: unknown;
    photoURL?: unknown;
  };
  const activeRole =
    typeof userData.activeRole === "string" ? userData.activeRole : "admin";
  await userRef.set({ roles: ALL_ROLES, activeRole, role: "admin" }, { merge: true });

  const displayName =
    typeof userData.displayName === "string" ? userData.displayName : "";
  const photoURL = typeof userData.photoURL === "string" ? userData.photoURL : null;

  // Visible, approved tradesperson doc so the admin can be discovered in search
  // and can browse job posts (isVisibleTradie check passes).
  const tradieRef = db.doc(`tradespeople/${uid}`);
  const tradieSnap = await tradieRef.get();
  if (!tradieSnap.exists) {
    await tradieRef.set(newTradieDocDefaults({ displayName, photoURL, approved: true }));
  } else {
    await tradieRef.set(
      { isVisible: true, vettingStatus: "approved", idVerified: true, displayName, photoURL },
      { merge: true },
    );
  }

  logger.info("Ensured admin testing profile", { uid });
  return { roles: ALL_ROLES };
}
