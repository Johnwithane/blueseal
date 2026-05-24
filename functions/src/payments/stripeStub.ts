import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireAuth, requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";

/**
 * Subscription stub — kept until the subscription-removal commit lands
 * (per `design.md` § 5.9 monetization pivot). The real Stripe Connect
 * payment flow lives in stripeClient.ts + stripeWebhook.ts; this file
 * only retains `createCheckoutSession` (still stubbed) and
 * `adminToggleSubscription` (dev helper still in use). Both get deleted
 * when the AI subscription is removed.
 */

export const createCheckoutSession = onCall({ enforceAppCheck: false }, async (req) => {
  requireAuth(req);
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new HttpsError(
      "failed-precondition",
      "Stripe is not yet configured. Subscription flow is on hold.",
    );
  }
  throw new HttpsError("unimplemented", "Stripe integration pending.");
});

const ToggleInput = z.object({
  targetUid: z.string().min(1).max(128),
  value: z.boolean(),
});

/**
 * Dev helper: admin can manually flip a tradie's subscription state until
 * Stripe is wired in. Lets you exercise the AI gate end-to-end.
 */
export const adminToggleSubscription = onCall({ enforceAppCheck: false }, async (req) => {
  const actor = requireAdmin(req);
  const parsed = ToggleInput.safeParse(req.data);
  if (!parsed.success) throw new HttpsError("invalid-argument", "Invalid input");
  const { targetUid, value } = parsed.data;

  const targetSnap = await db.doc(`users/${targetUid}`).get();
  if (!targetSnap.exists) throw new HttpsError("not-found", "Target user not found.");
  const target = targetSnap.data() as
    | { roles?: unknown; role?: unknown }
    | undefined;
  const targetRoles = Array.isArray(target?.roles)
    ? (target!.roles as unknown[]).filter((r): r is string => typeof r === "string")
    : typeof target?.role === "string"
      ? [target.role]
      : [];
  if (!targetRoles.includes("tradesperson")) {
    throw new HttpsError(
      "failed-precondition",
      "Subscription only applies to tradespeople.",
    );
  }

  await db.doc(`users/${targetUid}`).set(
    { hasActiveSubscription: value },
    { merge: true },
  );
  await logAdminAction({
    actorUid: actor,
    action: "adminToggleSubscription",
    targetType: "user",
    targetId: targetUid,
    metadata: { value },
  });
  return { ok: true };
});
