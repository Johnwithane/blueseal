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
//   3. Dispatch by event type. For Phase A only `account.updated` is
//      handled — payment / payout / refund / dispute events land in
//      Phase B alongside the sendInvoice rewrite. Any other event today
//      logs at info and returns 200 (Stripe stops retrying); when the
//      dispatcher gets richer the unknown-event arm shrinks.
//
// The webhook is unauthenticated by design — Stripe can't sign in as a
// user. `enforceAppCheck` is false for the same reason. The signature
// check is the security boundary.

import { HttpsError, onRequest } from "firebase-functions/v2/https";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";

import { db } from "../lib/admin";
import {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  getStripe,
} from "./stripeClient";

type ConnectOnboardingStatus =
  | "not_started"
  | "in_progress"
  | "restricted"
  | "enabled";

// Slice of Stripe.Account / Stripe.Event we depend on. Hand-rolled because
// stripe@22's CJS types entry doesn't expose the resource namespace (see
// stripeClient.ts). Stripe's full Account is ~200 mostly-nullable fields;
// being explicit about what we read is also defensive — schema drift in
// fields we don't touch can't break us.
interface StripeAccount {
  id: string;
  payouts_enabled?: boolean | null;
  charges_enabled?: boolean | null;
  details_submitted?: boolean | null;
  metadata?: Record<string, string> | null;
  requirements?: {
    disabled_reason?: string | null;
    currently_due?: string[] | null;
    past_due?: string[] | null;
  } | null;
}

interface StripeEvent {
  id: string;
  type: string;
  data: { object: unknown };
}

interface MirroredPayoutsState {
  stripeAccountId: string;
  onboardingStatus: ConnectOnboardingStatus;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  disabledReason: string | null;
  pendingRequirements: string[];
  lastSyncedAt: FieldValue;
}

function deriveStatus(account: StripeAccount): ConnectOnboardingStatus {
  if (account.payouts_enabled && account.charges_enabled) return "enabled";
  if (account.requirements?.disabled_reason) return "restricted";
  if (
    (account.requirements?.currently_due?.length ?? 0) > 0 ||
    !account.details_submitted
  ) {
    return "in_progress";
  }
  return "restricted";
}

function mirrorAccount(account: StripeAccount): MirroredPayoutsState {
  return {
    stripeAccountId: account.id,
    onboardingStatus: deriveStatus(account),
    chargesEnabled: Boolean(account.charges_enabled),
    payoutsEnabled: Boolean(account.payouts_enabled),
    detailsSubmitted: Boolean(account.details_submitted),
    disabledReason: account.requirements?.disabled_reason ?? null,
    pendingRequirements: [
      ...(account.requirements?.currently_due ?? []),
      ...(account.requirements?.past_due ?? []),
    ],
    lastSyncedAt: FieldValue.serverTimestamp(),
  };
}

async function handleAccountUpdated(account: StripeAccount): Promise<void> {
  // Prefer the metadata round-trip set during `createConnectAccount`. Fall
  // back to a `where payouts.stripeAccountId == account.id` query so we
  // still cope with accounts created before the metadata round-trip
  // existed (legacy / manual creations via the Stripe dashboard).
  const metaUid = account.metadata?.tradespersonId;
  let tradieRef = metaUid ? db.doc(`tradespeople/${metaUid}`) : null;

  if (tradieRef) {
    const snap = await tradieRef.get();
    if (!snap.exists) {
      logger.warn("stripeWebhook account.updated: metadata uid missing doc", {
        accountId: account.id,
        metaUid,
      });
      tradieRef = null;
    }
  }

  if (!tradieRef) {
    const query = await db
      .collection("tradespeople")
      .where("payouts.stripeAccountId", "==", account.id)
      .limit(1)
      .get();
    if (query.empty) {
      logger.warn(
        "stripeWebhook account.updated: no tradesperson for account",
        { accountId: account.id },
      );
      return;
    }
    tradieRef = query.docs[0].ref;
  }

  await tradieRef.set({ payouts: mirrorAccount(account) }, { merge: true });
  logger.info("stripeWebhook account.updated: mirrored", {
    accountId: account.id,
    uid: tradieRef.id,
  });
}

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
        // Phase B adds: payment_intent.succeeded / processing / payment_failed
        //               charge.refunded / dispute.created / dispute.closed
        //               payout.created / paid / failed
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
