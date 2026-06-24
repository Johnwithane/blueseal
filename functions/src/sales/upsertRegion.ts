import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { FieldValue } from "firebase-admin/firestore";
import { z } from "zod";
import { CALLABLE_OPTS } from "../lib/callable";
import { adminAuth, db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";

// CA province codes + the FSA-prefix shape, mirrored from the app source
// (src/data/provinces.ts + src/validation/regionSchema.ts) — functions is a
// separate package and can't import from the app.
const PROVINCE_CODES = new Set([
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
]);
const FSA_PREFIX = /^[A-Z][0-9]?[A-Z]?$/;

const Input = z.object({
  id: z.string().trim().min(1).max(128).optional(),
  name: z.string().trim().min(2).max(80),
  province: z
    .string()
    .trim()
    .toUpperCase()
    .refine((c) => PROVINCE_CODES.has(c), "Invalid province"),
  fsaPrefixes: z
    .array(z.string().trim().toUpperCase().regex(FSA_PREFIX, "Invalid FSA prefix"))
    .min(1)
    .max(300)
    .refine((arr) => new Set(arr).size === arr.length, "Duplicate prefixes"),
  repId: z.string().trim().min(1).max(128).nullable(),
  status: z.enum(["active", "paused"]),
  thresholdActive: z.number().int().min(1).max(100000),
});

/**
 * Admin-only: create or update a sales region. Region writes flow through this
 * callable (not direct client writes) so we validate the assigned rep is a real
 * account, keep the denormalized health counts + marketing budget + audit
 * fields server-managed, and log every change. Reps get paid off these regions,
 * so the edit path is auditable.
 *
 * Granting the rep the `sales` role + dashboard access is a separate admin step
 * in the Sales reps console — assigning a repId here only records ownership.
 */
export const adminUpsertRegion = onCall(CALLABLE_OPTS, async (req) => {
  const actor = requireAdmin(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid region.");
  const { id, repId, thresholdActive, ...fields } = parsed.data;

  if (repId) {
    try {
      await adminAuth.getUser(repId);
    } catch {
      throw new HttpsError("not-found", "Assigned rep is not a real user.");
    }
  }

  const ref = id ? db.doc(`regions/${id}`) : db.collection("regions").doc();
  const snap = await ref.get();
  if (id && !snap.exists) throw new HttpsError("not-found", "Region not found.");
  const prev = snap.exists ? snap.data() : null;

  const payload = {
    ...fields,
    repId: repId ?? null,
    // Marketing budget state is preserved across edits; only thresholdActive is
    // editable from the form. unlockedAt / allocatedCents / notes are managed by
    // the region-health sweep + the marketing-budget callable (M5).
    marketing: {
      thresholdActive,
      unlockedAt: prev?.marketing?.unlockedAt ?? null,
      allocatedCents: prev?.marketing?.allocatedCents ?? 0,
      notes: prev?.marketing?.notes ?? "",
    },
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: actor,
  };

  if (!snap.exists) {
    await ref.set({
      ...payload,
      activeTradieCount: 0,
      totalTradieCount: 0,
      createdAt: FieldValue.serverTimestamp(),
    });
  } else {
    await ref.set(payload, { merge: true });
  }

  await logAdminAction({
    actorUid: actor,
    action: id ? "updateRegion" : "createRegion",
    targetType: "region",
    targetId: ref.id,
    metadata: { name: fields.name, repId: repId ?? null },
  });
  logger.info("adminUpsertRegion", { actor, id: ref.id, repId: repId ?? null });
  return { id: ref.id };
});
