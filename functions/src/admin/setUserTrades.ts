import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";
import { TRADE_KEYS } from "../seed/seededProspectSchema";

const Input = z.object({
  targetUid: z.string().min(1).max(128),
  trades: z
    .array(z.enum(TRADE_KEYS))
    .max(TRADE_KEYS.length)
    .refine((t) => new Set(t).size === t.length, "Trades must be unique"),
});

/**
 * Admin-only: set a tradesperson's trades. The trades are also written to
 * `verifiedTrades` (per product decision) so an admin-set trade shows as
 * verified immediately — handy for exercising trade-specific flows before
 * launch. Target must already be a tradesperson (have a profile doc).
 */
export const adminSetUserTrades = onCall(CALLABLE_OPTS, async (req) => {
  const actor = requireAdmin(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
  const { targetUid } = parsed.data;
  const next = Array.from(new Set(parsed.data.trades));

  const tradieRef = db.doc(`tradespeople/${targetUid}`);
  const tradieSnap = await tradieRef.get();
  if (!tradieSnap.exists) {
    throw new HttpsError("not-found", "User is not a tradesperson.");
  }

  await tradieRef.set({ trades: next, verifiedTrades: next }, { merge: true });

  await logAdminAction({
    actorUid: actor,
    action: "adminSetUserTrades",
    targetType: "tradesperson",
    targetId: targetUid,
    metadata: { count: next.length },
  });
  logger.info("Admin set user trades", { actor, targetUid, count: next.length });
  return { ok: true, trades: next };
});
