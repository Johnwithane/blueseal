import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";

const Input = z.object({ id: z.string().trim().min(1).max(128) });

/** Admin-only: delete a sales region. Tradespeople keep their stamped regionId
 * (it just no longer resolves) until they're re-assigned; commission accrual
 * (M3) skips regions with no current rep, so a deleted region simply stops
 * earning. */
export const adminDeleteRegion = onCall(CALLABLE_OPTS, async (req) => {
  const actor = requireAdmin(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
  const { id } = parsed.data;

  await db.doc(`regions/${id}`).delete();

  await logAdminAction({
    actorUid: actor,
    action: "deleteRegion",
    targetType: "region",
    targetId: id,
  });
  logger.info("adminDeleteRegion", { actor, id });
  return { ok: true as const };
});
