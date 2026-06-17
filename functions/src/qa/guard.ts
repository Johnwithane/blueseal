import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { requireRoleOrAdmin } from "../lib/auth";

/**
 * Gate for the QA toolkit's *fabrication* callables — the ones that mint trust
 * state the normal product flow puts behind real vetting / Stripe (provision an
 * approved+visible tradesperson, grant self Pro). Two independent locks:
 *
 *  1. The caller must already hold the `qa` claim (or be an admin). qa is only
 *     ever granted by an admin via adminSetUserRoles, so an ordinary user can
 *     never reach these — there is no self-grant path for qa.
 *  2. `QA_TOOLKIT_ENABLED` must be exactly "true" in the functions env. It
 *     defaults ON for the pre-launch test deployment; flip it to false (or
 *     unset it) the moment real users exist, so the SAME code shipped to a
 *     real-user project can never fabricate an approved pro. See HUMANTASKS.md.
 *
 * Returns the caller's uid (every QA callable operates ONLY on its own account —
 * none of them accept a target uid).
 */
export function assertQaProvisioningAllowed(req: CallableRequest<unknown>): string {
  const uid = requireRoleOrAdmin(req, "qa");
  if (process.env.QA_TOOLKIT_ENABLED !== "true") {
    throw new HttpsError(
      "failed-precondition",
      "The QA toolkit is disabled in this environment.",
    );
  }
  return uid;
}
