import { onCall, HttpsError, onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { z } from "zod";
import { db } from "../lib/admin";
import { requireAuth, requireAdmin } from "../lib/auth";
import { logAdminAction } from "../lib/audit";

/**
 * Stripe is stubbed for MVP per the user's choice. The wiring is in place so
 * dropping in real keys (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET via
 * `firebase functions:secrets:set`) and switching to `defineSecret(...)` with
 * the secret listed in the function options flips it on. Using process.env
 * for now so deploy doesn't require the secrets to exist yet.
 *
 * TODO(launch): disable `adminToggleSubscription` once real Stripe webhook is
 * the source of truth, or restrict to non-production projects only.
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

export const stripeWebhook = onRequest(async (_req, res) => {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    // Stripe treats 2xx as "received, don't retry". Returning a 503 keeps
    // events queued on Stripe's side until the secret is configured.
    logger.warn("stripeWebhook hit but no secret configured; returning 503.");
    res.status(503).send("Webhook not configured");
    return;
  }
  // When real Stripe is wired: verify the signature header BEFORE any
  // Firestore side effects, then dispatch by event type.
  logger.warn("stripeWebhook stub invoked; implement signature verification.");
  res.status(200).send({ received: true });
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
  const target = targetSnap.data() as { role?: string } | undefined;
  if (target?.role !== "tradesperson") {
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
