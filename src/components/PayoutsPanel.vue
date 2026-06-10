<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Button from "primevue/button";
import Message from "primevue/message";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import {
  createConnectAccount,
  createConnectLoginLink,
  createConnectOnboardingLink,
  subscribePayouts,
  subscribePayoutsState,
} from "@/firebase/services/payoutsService";
import { useFormatters } from "@/composables/useFormatters";
import type { PayoutDoc, PayoutsState, WithId } from "@/firebase/interfaces";

// Stripe Connect Express onboarding + payout history. Rendered both as the
// standalone /payouts route (via PayoutsOnboardingView wrapper) and as the
// "Payouts" tab inside AccountView. The route wrapper handles the toast +
// URL replace for Stripe's return/refresh redirect targets; this panel only
// concerns itself with status + actions.
const auth = useAuthStore();
const toast = useToast();

const state = ref<PayoutsState | null>(null);
const loadingState = ref(true);
const busy = ref<null | "create" | "onboard" | "login">(null);
const payouts = ref<WithId<PayoutDoc>[]>([]);
let unsubState: (() => void) | null = null;
let unsubPayouts: (() => void) | null = null;

const { relativeTime } = useFormatters();

onMounted(() => {
  if (!auth.fbUser) return;
  const uid = auth.fbUser.uid;
  unsubState = subscribePayoutsState(uid, (s) => {
    state.value = s;
    loadingState.value = false;
  });
  // Payout history subscription runs unconditionally — the query returns
  // an empty array for tradies who haven't received payouts yet, which is
  // what we want (the history card hides when nothing's there).
  unsubPayouts = subscribePayouts(uid, (p) => (payouts.value = p));
});

onBeforeUnmount(() => {
  unsubState?.();
  unsubPayouts?.();
});

// Effective status: nullish payouts means the doc was created before the
// monetization pivot rolled out; treat as "not_started" so the user gets
// the standard kick-off CTA. Once the backfill callable runs across all
// approved tradies, this fallback is dead code we can drop.
const status = computed<PayoutsState["onboardingStatus"]>(() => {
  return state.value?.onboardingStatus ?? "not_started";
});

const headline = computed(() => {
  switch (status.value) {
    case "enabled":
      return "Payouts are live";
    case "restricted":
      return "Stripe needs more info";
    case "in_progress":
      return "Finish your payout setup";
    case "not_started":
    default:
      return "Connect your bank account to get paid";
  }
});

const subhead = computed(() => {
  switch (status.value) {
    case "enabled":
      return "Invoices you send through Blue Seal will pay out to the bank account you connected with Stripe. Blue Seal's 12% platform fee is taken at the time of payment — you see the net on every invoice before you send it.";
    case "restricted":
      return "Stripe paused payouts on your account because of the items below. Click 'Continue Stripe setup' to provide what's needed — the link below opens Stripe's hosted form.";
    case "in_progress":
      return "You started Stripe onboarding but didn't finish. Continue from where you left off — Stripe remembers your progress.";
    case "not_started":
    default:
      return "Blue Seal uses Stripe Connect Express to pay you directly when clients pay your invoices. Onboarding takes about 5 minutes — you'll need your bank details, address, and either your SIN or a piece of ID.";
  }
});

async function kickOff() {
  busy.value = "create";
  try {
    if (!state.value?.stripeAccountId) {
      await createConnectAccount();
    }
    const { url } = await createConnectOnboardingLink();
    busy.value = "onboard";
    // Full-page nav (not router.push) — Stripe's hosted form is off-app.
    window.location.assign(url);
  } catch (err) {
    toast.error(humanizeError(err));
    busy.value = null;
  }
}

async function openDashboard() {
  busy.value = "login";
  try {
    const { url } = await createConnectLoginLink();
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (err) {
    toast.error(humanizeError(err));
  } finally {
    busy.value = null;
  }
}

const pendingItems = computed(() => state.value?.pendingRequirements ?? []);

function fmtMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
    cents / 100,
  );
}

function statusLabel(s: PayoutDoc["status"]): {
  label: string;
  severity: "info" | "warn" | "error" | "success";
} {
  switch (s) {
    case "paid":
      return { label: "Paid", severity: "success" };
    case "in_transit":
      return { label: "In transit", severity: "info" };
    case "pending":
      return { label: "Pending", severity: "info" };
    case "failed":
      return { label: "Failed", severity: "error" };
    case "canceled":
      return { label: "Canceled", severity: "warn" };
    default:
      return { label: s, severity: "info" };
  }
}

function prettyRequirement(req: string): string {
  // Stripe returns requirement codes like "individual.verification.document"
  // or "external_account". Humanize the common ones; fall back to the raw
  // code (still readable) for anything we haven't mapped.
  const map: Record<string, string> = {
    external_account: "Bank account details",
    "individual.verification.document": "Government-issued ID",
    "individual.verification.additional_document":
      "Additional ID verification",
    "individual.id_number": "SIN or last 4 digits of SSN",
    "individual.address.line1": "Mailing address",
    "individual.dob.day": "Date of birth",
    business_profile_url: "Website or business profile URL",
    tos_acceptance: "Accept Stripe's terms of service",
  };
  return map[req] ?? req.replace(/_/g, " ").replace(/\./g, " — ");
}
</script>

<template>
  <div v-if="loadingState" class="bs-card p-5">
    <div class="flex items-center gap-2 text-[color:var(--bs-muted)] text-sm">
      <i class="pi pi-spin pi-spinner"></i>
      Loading payout status…
    </div>
  </div>

  <div v-else class="space-y-4">
    <!-- Headline state card -->
    <div class="bs-card p-5">
      <div class="flex items-start gap-3">
        <i
          :class="[
            'pi text-2xl mt-0.5',
            status === 'enabled'
              ? 'pi-check-circle text-[color:var(--bs-blue)]'
              : status === 'restricted'
                ? 'pi-exclamation-triangle text-[#b91c1c]'
                : 'pi-credit-card text-[color:var(--bs-muted)]',
          ]"
          aria-hidden="true"
        ></i>
        <div class="flex-1 min-w-0">
          <h2 class="text-lg font-semibold">{{ headline }}</h2>
          <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
            {{ subhead }}
          </p>
        </div>
      </div>

      <!-- Restricted: surface what Stripe wants -->
      <div v-if="status === 'restricted'" class="mt-4">
        <Message
          v-if="state?.disabledReason"
          severity="warn"
          :closable="false"
        >
          <span class="font-semibold">Reason:</span>
          {{ state.disabledReason.replace(/_/g, " ") }}
        </Message>
        <div v-if="pendingItems.length" class="mt-3">
          <p class="text-sm font-medium mb-1">Stripe is asking for:</p>
          <ul
            class="list-disc pl-5 text-sm text-[color:var(--bs-text)]/90 space-y-0.5"
          >
            <li v-for="item in pendingItems" :key="item">
              {{ prettyRequirement(item) }}
            </li>
          </ul>
        </div>
      </div>

      <!-- Action row -->
      <div class="mt-5 flex flex-wrap gap-2">
        <Button
          v-if="status !== 'enabled'"
          :label="
            status === 'not_started'
              ? 'Start Stripe setup'
              : 'Continue Stripe setup'
          "
          icon="pi pi-external-link"
          :loading="busy === 'create' || busy === 'onboard'"
          @click="kickOff"
        />
        <Button
          v-if="status === 'enabled'"
          label="Open Stripe dashboard"
          icon="pi pi-external-link"
          :loading="busy === 'login'"
          @click="openDashboard"
        />
      </div>
    </div>

    <!-- Helpful context card, shown in every state -->
    <div class="bs-card p-5">
      <h3 class="text-base font-semibold">How payouts work on Blue Seal</h3>
      <ul
        class="mt-2 list-disc pl-5 text-sm text-[color:var(--bs-text)]/85 space-y-1"
      >
        <li>
          Clients pay your invoice through Blue Seal using a card. Funds
          settle into Stripe.
        </li>
        <li>
          Blue Seal's 12% platform fee is deducted automatically. The net
          transfers to your connected bank account on Stripe's standard
          payout schedule (typically 2 business days for Canadian accounts).
        </li>
        <li>
          Disputes, refunds, and tax docs are managed inside the Stripe
          dashboard — accessible from this page once you're enabled.
        </li>
      </ul>
    </div>

    <!-- Payout history — only renders once the tradie has received at
         least one payout. The Stripe Express dashboard is the canonical
         place for per-charge breakdowns + downloadable statements; the
         in-app list is for at-a-glance "where's my money?". -->
    <div v-if="payouts.length > 0" class="bs-card p-5">
      <div class="flex items-start justify-between">
        <h3 class="text-base font-semibold">Recent payouts</h3>
        <span class="text-xs text-[color:var(--bs-muted)]">
          Last {{ payouts.length }}
        </span>
      </div>
      <ul class="mt-3 divide-y divide-[color:var(--bs-border)]">
        <li
          v-for="p in payouts"
          :key="p.id"
          class="flex items-center justify-between gap-3 py-3"
        >
          <div class="min-w-0 flex-1">
            <div class="font-medium tabular-nums">
              {{ fmtMoney(p.amount, p.currency) }}
            </div>
            <div class="text-xs text-[color:var(--bs-muted)]">
              Arriving {{ relativeTime(p.arrivalDate) }}
              <span
                v-if="p.status === 'failed' && p.failureMessage"
                class="block text-[color:var(--bs-error,#b91c1c)] mt-0.5"
              >
                {{ p.failureMessage }}
              </span>
            </div>
          </div>
          <span
            :class="[
              'text-xs font-medium rounded-full px-2 py-0.5',
              statusLabel(p.status).severity === 'success' &&
                'bg-[color:var(--bs-success-tint)] text-[color:var(--bs-success-text)]',
              statusLabel(p.status).severity === 'info' &&
                'bg-[color:var(--bs-info-tint)] text-[color:var(--bs-info-text)]',
              statusLabel(p.status).severity === 'warn' &&
                'bg-[color:var(--bs-warning-tint)] text-[color:var(--bs-warning-text)]',
              statusLabel(p.status).severity === 'error' &&
                'bg-[color:var(--bs-danger-tint)] text-[color:var(--bs-danger-text)]',
            ]"
          >
            {{ statusLabel(p.status).label }}
          </span>
        </li>
      </ul>
      <p class="mt-3 text-xs text-[color:var(--bs-muted)]">
        For per-charge breakdowns and downloadable statements, open the
        Stripe dashboard above.
      </p>
    </div>
  </div>
</template>
