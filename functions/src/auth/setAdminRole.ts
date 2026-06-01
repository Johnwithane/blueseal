import { onCall, HttpsError } from "firebase-functions/v2/https";
import { CALLABLE_OPTS } from "../lib/callable";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { adminAuth, db } from "../lib/admin";
import { requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";

const Input = z.object({ targetUid: z.string().min(1).max(128) });

export const setAdminRole = onCall(CALLABLE_OPTS, async (req) => {
  const actor = requireAdmin(req);
  const parsed = Input.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
  const { targetUid } = parsed.data;

  // Refuse to mint a claim for a UID that doesn't exist as an Auth user.
  let current;
  try {
    current = await adminAuth.getUser(targetUid);
  } catch {
    throw new HttpsError("not-found", "Target user does not exist.");
  }

  // Read existing claims so admin is layered on top of (not replacing) any
  // client / tradesperson role the user already holds.
  const existingClaims = (current.customClaims ?? {}) as {
    roles?: unknown;
    role?: unknown;
  };
  const existingRoles = Array.isArray(existingClaims.roles)
    ? (existingClaims.roles as unknown[]).filter((r): r is string => typeof r === "string")
    : typeof existingClaims.role === "string"
      ? [existingClaims.role]
      : [];
  const nextRoles = Array.from(new Set([...existingRoles, "admin"]));

  // Mirror to the user doc, preserving any pre-existing roles array.
  const docSnap = await db.doc(`users/${targetUid}`).get();
  const docData = (docSnap.exists ? docSnap.data() : {}) as {
    roles?: unknown;
    role?: unknown;
  };
  const docRoles = Array.isArray(docData?.roles)
    ? (docData!.roles as unknown[]).filter((r): r is string => typeof r === "string")
    : typeof docData?.role === "string"
      ? [docData.role]
      : [];
  const nextDocRoles = Array.from(new Set([...docRoles, "admin"]));

  const previousDocPatch = {
    roles: docRoles.length > 0 ? docRoles : null,
    role: typeof docData?.role === "string" ? docData.role : null,
  };

  // Firestore first, then claim. If the claim write fails after the doc write,
  // re-running this callable is idempotent. The reverse would leave a claim
  // without a doc, which is worse.
  await db.doc(`users/${targetUid}`).set(
    { roles: nextDocRoles, role: "admin" },
    { merge: true },
  );
  try {
    await adminAuth.setCustomUserClaims(targetUid, {
      ...existingClaims,
      roles: nextRoles,
      role: "admin",
    });
  } catch (err) {
    logger.error("setCustomUserClaims failed; rolling back doc write", { targetUid, err });
    await db.doc(`users/${targetUid}`).set(previousDocPatch, { merge: true });
    throw new HttpsError("internal", "Failed to set role; please retry.");
  }

  await logAdminAction({
    actorUid: actor,
    action: "setAdminRole",
    targetType: "user",
    targetId: targetUid,
  });
  return { ok: true };
});
