<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Button from "primevue/button";
import Message from "primevue/message";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import {
  createRepConnectAccount,
  createRepConnectLoginLink,
  createRepConnectOnboardingLink,
  subscribeRepPayoutsState,
} from "@/firebase/services/repPayoutsService";
import type { PayoutsState } from "@/firebase/interfaces";

// Stripe Connect Express onboarding for a sales rep — mirror of the
// tradesperson PayoutsPanel, but reps RECEIVE their monthly commission payout
// (they never take card charges). Reads users/{uid}.salesRep.payouts, which the
// account.updated webhook keeps current.
const auth = useAuthStore();
const toast = useToast();

const state = ref<PayoutsState | null>(null);
const loadingState = ref(true);
const busy = ref<null | "create" | "onboard" | "login">(null);
let unsub: (() => void) | null = null;

onMounted(() => {
  if (!auth.fbUser) return;
  unsub = subscribeRepPayoutsState(auth.fbUser.uid, (s) => {
    state.value = s;
    loadingState.value = false;
  });
});

onBeforeUnmount(() => unsub?.());

const status = computed<PayoutsState["onboardingStatus"]>(
  () => state.value?.onboardingStatus ?? "not_started",
);

const headline = computed(() => {
  switch (status.value) {
    case "enabled":
      return "Payouts are live";
    case "restricted":
      return "Stripe needs more info";
    case "in_progress":
      return "Finish your payout setup";
    default:
      return "Connect your bank account to get paid";
  }
});

const subhead = computed(() => {
  switch (status.value) {
    case "enabled":
      return "Your commission pays out automatically each month to the bank account you connected with Stripe, once your balance clears the $50 minimum.";
    case "restricted":
      return "Stripe paused payouts on your account because of the items below. Click 'Continue Stripe setup' to provide what's needed.";
    case "in_progress":
      return "You started Stripe onboarding but didn't finish. Continue from where you left off. Stripe remembers your progress.";
    default:
      return "Blue Seal pays your commission through Stripe Connect Express. Onboarding takes about 5 minutes. You'll need your bank details, address, and either your SIN or a piece of ID.";
  }
});

const pendingItems = computed(() => state.value?.pendingRequirements ?? []);

async function kickOff() {
  busy.value = "create";
  try {
    if (!state.value?.stripeAccountId) {
      await createRepConnectAccount();
    }
    const { url } = await createRepConnectOnboardingLink();
    busy.value = "onboard";
    window.location.assign(url);
  } catch (err) {
    toast.error(humanizeError(err));
    busy.value = null;
  }
}

async function openDashboard() {
  busy.value = "login";
  try {
    const { url } = await createRepConnectLoginLink();
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (err) {
    toast.error(humanizeError(err));
  } finally {
    busy.value = null;
  }
}

function prettyRequirement(req: string): string {
  const map: Record<string, string> = {
    external_account: "Bank account details",
    "individual.verification.document": "Government-issued ID",
    "individual.id_number": "SIN or last 4 digits of SSN",
    "individual.address.line1": "Mailing address",
    "individual.dob.day": "Date of birth",
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

  <div v-else class="bs-card p-5">
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
        <p class="mt-1 text-sm text-[color:var(--bs-muted)]">{{ subhead }}</p>
      </div>
    </div>

    <div v-if="status === 'restricted'" class="mt-4">
      <Message v-if="state?.disabledReason" severity="warn" :closable="false">
        <span class="font-semibold">Reason:</span>
        {{ state.disabledReason.replace(/_/g, " ") }}
      </Message>
      <div v-if="pendingItems.length" class="mt-3">
        <p class="text-sm font-medium mb-1">Stripe is asking for:</p>
        <ul class="list-disc pl-5 text-sm text-[color:var(--bs-text)]/90 space-y-0.5">
          <li v-for="item in pendingItems" :key="item">{{ prettyRequirement(item) }}</li>
        </ul>
      </div>
    </div>

    <div class="mt-5 flex flex-wrap gap-2">
      <Button
        v-if="status !== 'enabled'"
        :label="status === 'not_started' ? 'Start Stripe setup' : 'Continue Stripe setup'"
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
</template>
