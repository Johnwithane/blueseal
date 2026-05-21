import { onCall, HttpsError, onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { db } from "../lib/admin";
import { requireAuth } from "../lib/auth";

/**
 * Stripe is stubbed for MVP per the user's choice. The wiring is in place so
 * dropping in real keys (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET via
 * `firebase functions:secrets:set`) and switching to `defineSecret(...)` with
 * the secret listed in the function options flips it on. Using process.env
 * for now so deploy doesn't require the secrets to exist yet.
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
    logger.info("stripeWebhook hit but no secret configured; ignoring.");
    res.status(204).send();
    return;
  }
  logger.warn("stripeWebhook stub invoked; implement signature verification.");
  res.status(200).send({ received: true });
});

/**
 * Dev helper: admin can manually flip a tradie's subscription state until
 * Stripe is wired in. Lets you exercise the AI gate end-to-end.
 */
export const adminToggleSubscription = onCall({ enforceAppCheck: false }, async (req) => {
  const uid = requireAuth(req);
  if (req.auth?.token.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin only.");
  }
  const data = req.data as { targetUid?: string; value?: boolean } | undefined;
  if (!data?.targetUid || typeof data.value !== "boolean") {
    throw new HttpsError("invalid-argument", "targetUid + value required.");
  }
  await db.doc(`users/${data.targetUid}`).set(
    { hasActiveSubscription: data.value },
    { merge: true },
  );
  logger.info("Subscription toggled", { actor: uid, target: data.targetUid, value: data.value });
  return { ok: true };
});
