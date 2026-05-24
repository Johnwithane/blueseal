// Local type slices for the Stripe webhook handlers. See stripeClient.ts
// for why we hand-roll these instead of using `Stripe.Account` etc.
//
// Cast Stripe's `event.data.object` once at the dispatcher boundary; the
// handler functions then operate on these typed slices. Stripe's full
// object shapes have hundreds of nullable fields, almost all unused —
// being explicit about what we read also makes the schema we depend on
// auditable in one place.

export interface StripeRequirements {
  disabled_reason?: string | null;
  currently_due?: string[] | null;
  past_due?: string[] | null;
}

export interface StripeAccount {
  id: string;
  payouts_enabled?: boolean | null;
  charges_enabled?: boolean | null;
  details_submitted?: boolean | null;
  metadata?: Record<string, string> | null;
  requirements?: StripeRequirements | null;
}

export interface StripePaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: string;
  latest_charge?: string | { id: string } | null;
  // Last failure attached to the intent (Stripe sets this on payment_failed
  // events). Use both `last_payment_error` and `message` defensively.
  last_payment_error?: { message?: string | null; code?: string | null } | null;
  metadata?: Record<string, string> | null;
}

export interface StripeRefund {
  id: string;
  amount: number;
  reason?: string | null;
  created: number;
}

export interface StripeCharge {
  id: string;
  amount: number;
  amount_refunded: number;
  refunded: boolean;
  payment_intent?: string | null;
  transfer?: string | null;
  // For `charge.refunded` events the refund object is on `refunds.data`.
  refunds?: { data: StripeRefund[] } | null;
  metadata?: Record<string, string> | null;
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: unknown };
}
