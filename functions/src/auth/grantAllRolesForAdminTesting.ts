import { onCall } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { requireAdmin } from "../lib/auth";
import { ensureAdminTestingProfile } from "../lib/adminTesting";

/**
 * Admin-only, idempotent callable that grants the *calling admin* all three
 * roles (client + tradesperson + admin) and ensures they have a visible,
 * approved tradespeople doc so they can exercise the full app — post jobs,
 * browse the marketplace, submit applications, etc.
 *
 * Intended purely for testing / staff dogfooding. See `ensureAdminTestingProfile`
 * for the heavy lifting (shared with `grantAllTradesForAdminTesting`).
 */
export const grantAllRolesForAdminTesting = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAdmin(req);
  const { roles } = await ensureAdminTestingProfile(uid);
  return { ok: true, roles };
});
