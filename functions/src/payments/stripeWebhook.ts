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
  handlePaymentIntentCanceled,
  handlePaymentIntentFailed,
  handlePaymentIntentProcessing,
  handlePaymentIntentSucceeded,
} from "./handlers/paymentIntent";
import {
  handleUpfrontFeeCanceled,
  handleUpfrontFeeFailed,
  handleUpfrontFeeProcessing,
  handleUpfrontFeeSucceeded,
} from "./handlers/upfrontFee";
import { handleChargeRefunded } from "./handlers/chargeRefunded";
import {
  handleCheckoutSessionCompleted,
  handleSubscriptionChanged,
  handleSubscriptionInvoicePaymentFailed,
} from "./handlers/subscription";
import {
  handleChargeDisputeClosed,
  handleChargeDisputeCreated,
} from "./handlers/chargeDispute";
import {
  handlePayoutCreated,
  handlePayoutFailed,
  handlePayoutPaid,
} from "./handlers/payout";
import type {
  StripeAccount,
  StripeCharge,
  StripeCheckoutSession,
  StripeDispute,
  StripeEvent,
  StripeInvoice,
  StripePaymentIntent,
  StripePayout,
  StripeSubscription,
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

    let event: StripeEvent | null = null;
    // A Connect platform has two endpoints at this URL (platform + connected
    // accounts), each with its own signing secret. STRIPE_WEBHOOK_SECRET holds
    // both, comma-separated; try each until one verifies. `req.rawBody` is the
    // unparsed bytes Stripe signed — parsing loses whitespace and would reject.
    const secrets = STRIPE_WEBHOOK_SECRET.value()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const stripe = getStripe();
    for (const secret of secrets) {
      try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig, secret) as unknown as StripeEvent;
        break;
      } catch {
        // try the next secret
      }
    }
    if (!event) {
      logger.warn("stripeWebhook: signature verification failed against all secrets");
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
        // PaymentIntents are either invoice payments or upfront-fee payments;
        // metadata.paymentType routes to the right handler set (upfront fees
        // live on a job's upfrontFee.payment, invoices on the invoice doc).
        case "payment_intent.processing": {
          const pi = event.data.object as StripePaymentIntent;
          if (pi.metadata?.paymentType === "upfront_fee") {
            await handleUpfrontFeeProcessing(pi, event.id);
          } else {
            await handlePaymentIntentProcessing(pi, event.id);
          }
          break;
        }
        case "payment_intent.succeeded": {
          const pi = event.data.object as StripePaymentIntent;
          if (pi.metadata?.paymentType === "upfront_fee") {
            await handleUpfrontFeeSucceeded(pi, event.id);
          } else {
            await handlePaymentIntentSucceeded(pi, event.id);
          }
          break;
        }
        case "payment_intent.payment_failed": {
          const pi = event.data.object as StripePaymentIntent;
          if (pi.metadata?.paymentType === "upfront_fee") {
            await handleUpfrontFeeFailed(pi, event.id);
          } else {
            await handlePaymentIntentFailed(pi, event.id);
          }
          break;
        }
        case "payment_intent.canceled": {
          const pi = event.data.object as StripePaymentIntent;
          if (pi.metadata?.paymentType === "upfront_fee") {
            await handleUpfrontFeeCanceled(pi, event.id);
          } else {
            await handlePaymentIntentCanceled(pi, event.id);
          }
          break;
        }
        case "charge.refunded":
          await handleChargeRefunded(
            event.data.object as StripeCharge,
            event.id,
          );
          break;
        case "charge.dispute.created":
          await handleChargeDisputeCreated(
            event.data.object as StripeDispute,
            event.id,
          );
          break;
        case "charge.dispute.closed":
          await handleChargeDisputeClosed(
            event.data.object as StripeDispute,
            event.id,
          );
          break;
        case "payout.created":
          await handlePayoutCreated(
            event.data.object as StripePayout,
            event.account ?? null,
            event.id,
          );
          break;
        case "payout.paid":
          await handlePayoutPaid(
            event.data.object as StripePayout,
            event.account ?? null,
            event.id,
          );
          break;
        case "payout.failed":
          await handlePayoutFailed(
            event.data.object as StripePayout,
            event.account ?? null,
            event.id,
          );
          break;
        // Blue Seal Pro subscription lifecycle.
        case "checkout.session.completed":
          await handleCheckoutSessionCompleted(
            event.data.object as StripeCheckoutSession,
          );
          break;
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted":
          await handleSubscriptionChanged(event.data.object as StripeSubscription);
          break;
        case "invoice.payment_failed":
          await handleSubscriptionInvoicePaymentFailed(
            event.data.object as StripeInvoice,
          );
          break;
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
      // Map permanent (caller-side) errors to 4xx so Stripe stops
      // retrying them — anything else returns 500 and Stripe retries
      // with exponential backoff. Without this branch every malformed
      // payload would loop forever in Stripe's retry queue.
      const permanentCodes = new Set([
        "invalid-argument",
        "permission-denied",
        "not-found",
        "failed-precondition",
        "unauthenticated",
      ]);
      const isPermanent =
        err instanceof HttpsError && permanentCodes.has(err.code);
      const status = isPermanent ? 400 : 500;
      res.status(status).send({ received: false, error: message });
    }
  },
);
