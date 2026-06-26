import { onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { CALLABLE_OPTS } from "../lib/callable";
import { adminAuth, db } from "../lib/admin";
import { logAdminAction } from "../lib/audit";
import { initialProjectManagerState } from "../lib/projectManager";
import { assertQaProvisioningAllowed } from "./guard";

// Self-scoped QA: turn the caller into a project manager so a tester can exercise
// the /manage cockpit (properties, projects, dispatch, profile, earnings) in one
// click. The PM role is ACTIVE immediately (no vetting), matching the real
// role-enable flow; the tester still signs the PM agreement in-app before testing
// payouts. Caller-scoped only, never grants admin.
const QA_ROLES = ["client", "projectManager", "qa"] as const;

export const qaProvisionSelfProjectManager = onCall(CALLABLE_OPTS, async (req) => {
  const uid = assertQaProvisioningAllowed(req);

  const authUser = await adminAuth.getUser(uid);
  const existingClaims = (authUser.customClaims ?? {}) as Record<string, unknown>;
  const existingRoles = Array.isArray(existingClaims.roles)
    ? (existingClaims.roles as unknown[]).filter((r): r is string => typeof r === "string")
    : [];
  const roles = Array.from(new Set([...existingRoles, ...QA_ROLES]));
  await adminAuth.setCustomUserClaims(uid, {
    ...existingClaims,
    roles,
    role: typeof existingClaims.role === "string" ? existingClaims.role : "client",
  });

  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  const userData = (userSnap.exists ? userSnap.data() ?? {} : {}) as { projectManager?: unknown };

  const patch: Record<string, unknown> = { roles, activeRole: "projectManager" };
  // Seed the PM state only if it isn't there yet — never clobber a tester's own
  // referral code / signed agreement / payouts on re-provision.
  if (!userData.projectManager) patch.projectManager = initialProjectManagerState();
  await userRef.set(patch, { merge: true });

  await logAdminAction({
    actorUid: uid,
    action: "qaProvisionSelfProjectManager",
    targetType: "user",
    targetId: uid,
  });
  logger.info("qaProvisionSelfProjectManager", { uid });
  return { ok: true as const, roles };
});
