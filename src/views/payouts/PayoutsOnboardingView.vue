<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import Button from "primevue/button";
import Message from "primevue/message";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import {
  createConnectAccount,
  createConnectLoginLink,
  createConnectOnboardingLink,
  subscribePayoutsState,
} from "@/firebase/services/payoutsService";
import type { PayoutsState } from "@/firebase/interfaces";

// The single payouts entry point for tradespeople. Three routes (named
// `Payouts`, `PayoutsReturn`, `PayoutsRefresh`) all mount this component
// because Stripe's hosted onboarding bounces back via fixed return / refresh
// URLs, and the page they land on needs to look the same — the URL just
// carries an extra "Stripe-said-X" hint that shows a toast.
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const toast = useToast();

const state = ref<PayoutsState | null>(null);
const loadingState = ref(true);
const busy = ref<null | "create" | "onboard" | "login">(null);
let unsub: (() => void) | null = null;

onMounted(() => {
  if (!auth.fbUser) return;
  unsub = subscribePayoutsState(auth.fbUser.uid, (s) => {
    state.value = s;
    loadingState.value = false;
  });
});

onBeforeUnmount(() => {
  unsub?.();
});

// One-time toast for the Stripe return / refresh sub-routes. Stripe sets
// these as fixed redirects on the account link — we treat the redirect as
// a hint to the user (not as truth about state, which only the webhook
// settles). After showing the toast, replace the URL with `/payouts` so a
// reload doesn't fire the toast again.
watch(
  () => route.name,
  (name) => {
    if (name === "PayoutsReturn") {
      toast.success(
        "Stripe says your details are submitted. Give it a few seconds to confirm.",
      );
      void router.replace({ name: "Payouts" });
    } else if (name === "PayoutsRefresh") {
      toast.info(
        "Your onboarding link expired. Click 'Continue Stripe setup' to generate a new one.",
      );
      void router.replace({ name: "Payouts" });
    }
  },
  { immediate: true },
);

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
  <section class="bs-container py-6">
    <div class="mb-4">
      <RouterLink
        to="/dashboard"
        class="text-sm text-[color:var(--bs-muted)] hover:underline"
      >
        <i class="pi pi-arrow-left text-xs"></i>
        Back to dashboard
      </RouterLink>
      <h1 class="text-2xl font-bold mt-2">Payouts</h1>
    </div>

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
    </div>
  </section>
</template>
