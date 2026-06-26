<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Button from "primevue/button";
import Message from "primevue/message";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables";
import { humanizeError } from "@/utils/errors";
import { usePmEarnings } from "@/composables/usePmEarnings";
import {
  createPmConnectAccount,
  createPmConnectLoginLink,
  createPmConnectOnboardingLink,
  subscribePmPayoutsState,
} from "@/firebase/services/pmPayoutsService";
import { PM_AGREEMENT_VERSION } from "@/projectManager/agreement";
import PmAgreementDialog from "@/components/manage/PmAgreementDialog.vue";
import type { CommissionPayoutDoc, PayoutsState, WithId } from "@/firebase/interfaces";

// The PM cockpit "Earnings" surface: their commission balance, the payout setup
// gate (sign the agreement, then Stripe Connect), and payout history. The agreement
// gates MONEY only — a PM uses the cockpit freely before signing.
const auth = useAuthStore();
const toast = useToast();
const { money, date } = useFormatters();
const { summary, payouts, loading } = usePmEarnings();

// Has the PM signed the CURRENT agreement version?
const signed = computed(
  () => auth.user?.projectManager?.liability?.version === PM_AGREEMENT_VERSION,
);
const showAgreement = ref(false);

const state = ref<PayoutsState | null>(null);
const busy = ref<null | "create" | "onboard" | "login">(null);
let unsub: (() => void) | null = null;

onMounted(() => {
  if (!auth.fbUser) return;
  unsub = subscribePmPayoutsState(auth.fbUser.uid, (s) => (state.value = s));
});
onBeforeUnmount(() => unsub?.());

const status = computed<PayoutsState["onboardingStatus"]>(
  () => state.value?.onboardingStatus ?? "not_started",
);

const sortedPayouts = computed(() =>
  [...payouts.value].sort(
    (a, b) => (b.periodEnd?.toMillis?.() ?? 0) - (a.periodEnd?.toMillis?.() ?? 0),
  ),
);

const batchStatus: Record<string, { label: string; cls: string }> = {
  paid: { label: "Paid", cls: "bg-[color:var(--bs-success-tint)] text-[color:var(--bs-success-text)]" },
  pending: { label: "Processing", cls: "bg-[color:var(--bs-info-tint)] text-[color:var(--bs-info-text)]" },
  failed: { label: "Retrying", cls: "bg-[color:var(--bs-warning-tint)] text-[color:var(--bs-warning-text)]" },
};

async function kickOff() {
  busy.value = "create";
  try {
    if (!state.value?.stripeAccountId) await createPmConnectAccount();
    const { url } = await createPmConnectOnboardingLink();
    busy.value = "onboard";
    window.location.assign(url);
  } catch (err) {
    toast.error("Couldn't start setup", humanizeError(err));
    busy.value = null;
  }
}

async function openDashboard() {
  busy.value = "login";
  try {
    const { url } = await createPmConnectLoginLink();
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (err) {
    toast.error("Couldn't open Stripe", humanizeError(err));
  } finally {
    busy.value = null;
  }
}

function payoutStatusLabel(p: WithId<CommissionPayoutDoc>) {
  return batchStatus[p.status] ?? { label: p.status, cls: "" };
}
</script>

<template>
  <div class="space-y-3">
    <!-- Balance summary -->
    <div v-if="!loading" class="grid grid-cols-2 gap-3">
      <div class="bs-card p-4">
        <div class="text-xs text-[color:var(--bs-muted)]">Unpaid balance</div>
        <div class="text-xl font-semibold tabular-nums mt-1">{{ money(summary.unpaidCents) }}</div>
        <div class="text-[11px] text-[color:var(--bs-muted)] mt-1">
          <template v-if="summary.meetsMinimum">Pays out on the 1st</template>
          <template v-else>Pays out once it reaches $50</template>
        </div>
      </div>
      <div class="bs-card p-4">
        <div class="text-xs text-[color:var(--bs-muted)]">Paid to date</div>
        <div class="text-xl font-semibold tabular-nums mt-1">{{ money(summary.lifetimePaidCents) }}</div>
      </div>
    </div>

    <!-- Payout setup: agreement gate, then Stripe Connect -->
    <div v-if="!signed" class="bs-card p-5">
      <h3 class="font-semibold">Get set up to be paid</h3>
      <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
        Your commission accrues as your trades get paid. Sign the agreement, then connect your bank
        account with Stripe to receive your monthly payout.
      </p>
      <Button label="Review & sign the agreement" icon="pi pi-pencil" class="mt-3" size="small" @click="showAgreement = true" />
    </div>

    <div v-else class="bs-card p-5">
      <h3 class="font-semibold">
        <template v-if="status === 'enabled'">Payouts are live</template>
        <template v-else-if="status === 'restricted'">Stripe needs more info</template>
        <template v-else-if="status === 'in_progress'">Finish your payout setup</template>
        <template v-else>Connect your bank account to get paid</template>
      </h3>
      <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
        <template v-if="status === 'enabled'">
          Your commission pays out automatically each month to your connected bank account, once the
          balance clears the $50 minimum.
        </template>
        <template v-else>
          Blue Seal pays your commission through Stripe Connect. Onboarding takes about 5 minutes;
          you'll need your bank details, address, and ID.
        </template>
      </p>
      <Message
        v-if="status === 'restricted' && state?.disabledReason"
        severity="warn"
        :closable="false"
        class="mt-3"
      >
        {{ state.disabledReason.replace(/_/g, " ") }}
      </Message>
      <div class="mt-4 flex flex-wrap gap-2">
        <Button
          v-if="status !== 'enabled'"
          :label="status === 'not_started' ? 'Start Stripe setup' : 'Continue Stripe setup'"
          icon="pi pi-external-link"
          size="small"
          :loading="busy === 'create' || busy === 'onboard'"
          @click="kickOff"
        />
        <Button
          v-else
          label="Open Stripe dashboard"
          icon="pi pi-external-link"
          size="small"
          :loading="busy === 'login'"
          @click="openDashboard"
        />
      </div>
    </div>

    <!-- Payout history -->
    <div v-if="sortedPayouts.length" class="bs-card p-5">
      <h3 class="text-base font-semibold">Payout history</h3>
      <ul class="mt-2 divide-y divide-[color:var(--bs-border)]">
        <li v-for="p in sortedPayouts" :key="p.id" class="flex items-center justify-between gap-3 py-2">
          <div class="min-w-0">
            <div class="font-medium tabular-nums">{{ money(p.amountCents) }}</div>
            <div class="text-xs text-[color:var(--bs-muted)]">
              {{ date(p.periodEnd) }} · {{ p.commissionIds.length }} entries
            </div>
          </div>
          <span :class="['text-xs font-medium rounded-full px-2 py-0.5', payoutStatusLabel(p).cls]">
            {{ payoutStatusLabel(p).label }}
          </span>
        </li>
      </ul>
    </div>

    <PmAgreementDialog v-model:visible="showAgreement" />
  </div>
</template>
