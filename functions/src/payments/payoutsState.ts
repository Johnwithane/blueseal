// Default empty PayoutsState seeded onto a tradesperson doc the first time
// they kick off Stripe Connect onboarding. Mirrored by the
// `account.updated` webhook from that point forward.
//
// Lives in its own file (not stripeClient.ts) so callers that only need
// the default shape — e.g. the one-shot backfill — don't transitively
// import the Stripe SDK or trigger `defineSecret()` calls at module load.
// That matters during deploys before STRIPE_SECRET_KEY has been set.

export function emptyPayoutsState(): {
  stripeAccountId: null;
  onboardingStatus: "not_started";
  chargesEnabled: false;
  payoutsEnabled: false;
  detailsSubmitted: false;
  disabledReason: null;
  pendingRequirements: string[];
  /** Payout hold applied at account creation; null = Stripe's default schedule. */
  payoutHoldDays: null;
  lastSyncedAt: null;
} {
  return {
    stripeAccountId: null,
    onboardingStatus: "not_started",
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    disabledReason: null,
    pendingRequirements: [],
    payoutHoldDays: null,
    lastSyncedAt: null,
  };
}
