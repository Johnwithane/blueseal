// Public callable: a business owner who finds their own seeded ("Unverified")
// listing on Blue Seal can take it down themselves — NO account, NO email token.
//
// Deliberately errs toward removal: a seeded prospect was listed WITHOUT the
// business's consent, so honouring a takedown request is the safe direction even
// without proof-of-identity. The worst case (a wrongful removal) just hides an
// unconsented listing — fully reversible by an admin. Writes the SAME permanent
// suppression tombstone as the email-unsubscribe path (suppressProspect), so a
// removed listing is never re-imported by bulkImportProspects.
//
// Anti-abuse: rate-limited per caller IP so it can't be scripted to enumerate /
// strip the whole directory in one pass. App Check applies once enforced
// (CALLABLE_OPTS), the same as every other callable.

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { z } from "zod";

import { CALLABLE_OPTS } from "../lib/callable";
import { db } from "../lib/admin";
import { enforceRateLimit } from "../lib/rateLimit";

const Input = z.object({
  prospectId: z.string().trim().min(1).max(64),
  // Optional free-text note ("this is my business, please remove"). Stored for
  // the good-faith audit trail; never shown publicly. .nullable(): the client
  // sends this key unconditionally and the callable SDK delivers an unset value
  // as null, which bare .optional() rejects (would 400 the takedown).
  reason: z.string().trim().max(500).nullable().optional(),
});

// Per-IP daily cap. A real owner needs one removal; this stops a script from
// stripping every listing at once. Generous on purpose — it's an anti-
// enumeration guard, not a tight gate, since removal is the safe direction.
const SELF_REMOVE_DAILY_CAP = 25;

export const selfServeRemoveProspect = onCall(CALLABLE_OPTS, async (req) => {
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) {
    throw new HttpsError("invalid-argument", parsed.error.message);
  }
  const { prospectId, reason } = parsed.data;

  // Rate-limit by caller IP — this is intentionally unauthenticated (the whole
  // point is that the listed business has no Blue Seal account). Falls back to a
  // shared bucket if the IP is somehow absent, so the cap still bites.
  const ip = req.rawRequest?.ip || "unknown";
  try {
    await enforceRateLimit(`ip_${ip}`, "prospect_self_remove", SELF_REMOVE_DAILY_CAP);
  } catch {
    throw new HttpsError(
      "resource-exhausted",
      "Too many removal requests from your network today. Please try again later, or email support and we'll take it down.",
    );
  }

  const ref = db.doc(`prospects/${prospectId}`);
  const snap = await ref.get();
  // Idempotent + non-oracle: a missing / already-removed listing returns the
  // same success shape, so this can't be used to probe which ids exist.
  if (!snap.exists) {
    return { status: "removed" as const };
  }
  const data = snap.data() as Record<string, unknown>;
  const emailHash = typeof data.emailHash === "string" ? data.emailHash : null;

  const batch = db.batch();
  // Permanent tombstone keyed by emailHash → never re-imported (mirrors
  // suppressProspect's unsubscribe tombstone).
  if (emailHash) {
    batch.set(db.doc(`prospectSuppression/${emailHash}`), {
      reason: "self_serve_removal",
      identifier: emailHash,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: null,
    });
  }
  batch.update(ref, {
    status: "suppressed",
    isListed: false,
    suppressedAt: FieldValue.serverTimestamp(),
    suppressedReason: "self_serve_removal",
    selfRemovalReason: reason ?? null,
  });
  await batch.commit();

  logger.info("selfServeRemoveProspect: removed", { prospectId, ip });
  return { status: "removed" as const };
});
