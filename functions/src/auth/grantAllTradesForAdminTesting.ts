import { onCall } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { ensureAdminTestingProfile } from "../lib/adminTesting";
import { logAdminAction } from "../lib/audit";
import { TRADE_KEYS } from "../seed/seededProspectSchema";

/**
 * Admin-only, idempotent testing helper: ensures the caller has the full
 * testing profile (all roles + a visible, approved tradesperson doc), then
 * attaches *every* trade so they can exercise trade-specific flows end-to-end.
 *
 * Trades are also marked verified — the admin testing profile bypasses vetting,
 * so the verified-trade badges should reflect that fully-approved state.
 *
 * One-way by design (per product decision): turning it "off" is left to the
 * normal trades editor on the account page. This callable only ever adds.
 */
export const grantAllTradesForAdminTesting = onCall(CALLABLE_OPTS, async (req) => {
  const uid = requireAdmin(req);
  await ensureAdminTestingProfile(uid);

  const allTrades = [...TRADE_KEYS];
  await db.doc(`tradespeople/${uid}`).set(
    { trades: allTrades, verifiedTrades: allTrades },
    { merge: true },
  );

  await logAdminAction({
    actorUid: uid,
    action: "grantAllTradesForAdminTesting",
    targetType: "tradesperson",
    targetId: uid,
    metadata: { count: allTrades.length },
  });
  logger.info("Granted all trades for admin testing", { uid, count: allTrades.length });
  return { ok: true, count: allTrades.length };
});
