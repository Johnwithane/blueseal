// Stripe webhook receiver. Three concerns, in strict order on every event:
//
//   1. Verify the signature against `STRIPE_WEBHOOK_SECRET`. Anything that
//      fails here is rejected with 400 BEFORE we touch Firestore — the
//      signature IS the authentication.
//   2. Atomically claim the event id via `webhookEvents/{evt_…}`. Stripe
//      retries indefinitely on non-2xx responses (and occasionally
//      re-delivers on 2xx), so duplicate processing is the default unless
//      we explicitly deduplicate. `db.doc(...).create()` fails with
//      ALREADY_EXISTS on the second attempt — we treat that as a no-op
//      success and return 200 so Stripe stops retrying.
//   3. Dispatch by event type. Handlers live in handlers/ and operate on
//      local type slices (see handlers/shared.ts); the dispatcher just
//      routes + applies the global sentinel. Unknown event types log at
//      info and 200 so Stripe stops retrying.

import { HttpsError, onRequest } from "firebase-functions/v2/https";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

import { db } from "../lib/admin";
import {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  getStripe,
} from "./stripeClient";
import { handleAccountUpdated } from "./handlers/accountUpdated";
import {
  handlePaymentIntentFailed,
  handlePaymentIntentProcessing,
  handlePaymentIntentSucceeded,
} from "./handlers/paymentIntent";
import { handleChargeRefunded } from "./handlers/chargeRefunded";
import type {
  StripeAccount,
  StripeCharge,
  StripeEvent,
  StripePaymentIntent,
} from "./handlers/shared";

export const stripeWebhook = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET] },
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    if (typeof sig !== "string") {
      logger.warn("stripeWebhook: missing signature header");
      res.status(400).send("Missing stripe-signature header");
      return;
    }

    let event: StripeEvent;
    try {
      // `req.rawBody` is the unparsed request body buffer that Firebase
      // Functions v2 exposes alongside the parsed `req.body`. Stripe's
      // signature is computed over the raw bytes — parsing it loses
      // whitespace and rejection becomes inevitable.
      event = getStripe().webhooks.constructEvent(
        req.rawBody,
        sig,
        STRIPE_WEBHOOK_SECRET.value(),
      ) as unknown as StripeEvent;
    } catch (err) {
      logger.warn("stripeWebhook: signature verification failed", {
        message: err instanceof Error ? err.message : String(err),
      });
      res.status(400).send("Invalid signature");
      return;
    }

    const sentinelRef = db.doc(`webhookEvents/${event.id}`);
    try {
      await sentinelRef.create({
        type: event.type,
        receivedAt: Timestamp.now(),
        processedAt: null,
        status: "processing",
        errorMessage: null,
      });
    } catch (err) {
      // ALREADY_EXISTS — Stripe re-delivered an event we've seen. Return
      // 200 so Stripe stops retrying; the prior delivery already ran the
      // side effects (or is mid-flight; collision is rare enough that
      // best-effort is fine — full at-most-once would need a lock).
      logger.info("stripeWebhook: duplicate event, skipping", {
        eventId: event.id,
        type: event.type,
        err: err instanceof Error ? err.message : String(err),
      });
      res.status(200).send({ received: true, duplicate: true });
      return;
    }

    try {
      switch (event.type) {
        case "account.updated":
          await handleAccountUpdated(event.data.object as StripeAccount);
          break;
        case "payment_intent.processing":
          await handlePaymentIntentProcessing(
            event.data.object as StripePaymentIntent,
            event.id,
          );
          break;
        case "payment_intent.succeeded":
          await handlePaymentIntentSucceeded(
            event.data.object as StripePaymentIntent,
            event.id,
          );
          break;
        case "payment_intent.payment_failed":
          await handlePaymentIntentFailed(
            event.data.object as StripePaymentIntent,
            event.id,
          );
          break;
        case "charge.refunded":
          await handleChargeRefunded(
            event.data.object as StripeCharge,
            event.id,
          );
          break;
        // Phase B (next chunk) adds: charge.dispute.created / .closed and
        // payout.created / .paid / .failed (the latter writes /payouts/{po_…}).
        default:
          logger.info("stripeWebhook: unhandled event type (200 to stop retry)", {
            eventId: event.id,
            type: event.type,
          });
      }

      await sentinelRef.update({
        status: "processed",
        processedAt: Timestamp.now(),
      });
      res.status(200).send({ received: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("stripeWebhook: dispatcher error", {
        eventId: event.id,
        type: event.type,
        message,
      });
      await sentinelRef
        .update({
          status: "failed",
          errorMessage: message,
        })
        .catch(() => undefined);
      // Convert HttpsError-style errors into the right HTTP code so
      // Stripe's retry decision is sensible. Anything else → 500.
      const status = err instanceof HttpsError ? 500 : 500;
      res.status(status).send({ received: false, error: message });
    }
  },
);
