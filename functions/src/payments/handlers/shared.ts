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

export interface StripeDispute {
  id: string;
  amount: number;
  currency: string;
  charge: string | { id: string };
  payment_intent?: string | { id: string } | null;
  reason: string;
  status: string;
  // Stripe's evidence-submission deadline as a unix timestamp (seconds).
  // Present on every dispute status that requires action; null on inquiries
  // and closed disputes.
  evidence_details?: { due_by?: number | null } | null;
  metadata?: Record<string, string> | null;
}

export interface StripePayout {
  id: string;
  amount: number;
  currency: string;
  status: string;
  // Unix timestamp (seconds) of when the payout is expected to land in
  // the destination bank account. Stripe sets this on `payout.created` and
  // doesn't change it once the payout completes.
  arrival_date: number;
  failure_code?: string | null;
  failure_message?: string | null;
  metadata?: Record<string, string> | null;
}

// Blue Seal Pro subscription slices.
export interface StripeSubscriptionItemPrice {
  id: string;
  recurring?: { interval?: string | null } | null;
}

export interface StripeSubscription {
  id: string;
  status: string; // trialing | active | past_due | canceled | unpaid | incomplete | incomplete_expired
  customer: string | { id: string };
  cancel_at_period_end?: boolean | null;
  current_period_end?: number | null; // unix seconds
  trial_end?: number | null; // unix seconds
  items?: { data: Array<{ price: StripeSubscriptionItemPrice }> } | null;
  metadata?: Record<string, string> | null;
}

export interface StripeCheckoutSession {
  id: string;
  mode?: string | null;
  customer?: string | { id: string } | null;
  subscription?: string | { id: string } | null;
  metadata?: Record<string, string> | null;
}

export interface StripeInvoice {
  id: string;
  customer?: string | { id: string } | null;
  subscription?: string | { id: string } | null;
  billing_reason?: string | null;
}

export interface StripeEvent {
  id: string;
  type: string;
  // Set on events delivered for connected accounts (Connect direct webhook
  // or Connect-platform webhook with the event scoped to a sub-account).
  // Platform-level events (e.g. payment_intent on a destination charge)
  // don't carry this — they live on the platform's own account.
  account?: string | null;
  data: { object: unknown };
}
