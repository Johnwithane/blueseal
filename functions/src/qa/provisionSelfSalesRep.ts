import { onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { CALLABLE_OPTS } from "../lib/callable";
import { adminAuth, db } from "../lib/admin";
import { logAdminAction } from "../lib/audit";
import { assertQaProvisioningAllowed } from "./guard";

// Self-scoped QA: grant the caller the sales-rep role so a tester can exercise the
// /sales area. The rep is INERT until they sign the rep agreement in-app (the
// first-login gate) — we deliberately don't pre-sign it, so the agreement-gate
// flow stays testable. Caller-scoped only, never grants admin.
const QA_ROLES = ["client", "sales", "qa"] as const;

export const qaProvisionSelfSalesRep = onCall(CALLABLE_OPTS, async (req) => {
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

  await db.doc(`users/${uid}`).set({ roles, activeRole: "sales" }, { merge: true });

  await logAdminAction({
    actorUid: uid,
    action: "qaProvisionSelfSalesRep",
    targetType: "user",
    targetId: uid,
  });
  logger.info("qaProvisionSelfSalesRep", { uid });
  return { ok: true as const, roles };
});
