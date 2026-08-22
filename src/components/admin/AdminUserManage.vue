<script setup lang="ts">
// Tradesperson-only admin tools shown in the expanded user detail: the trades
// editor (also marks them verified), the founding-member Blue Seal Pro comp,
// and the card-payments pause. Roles are edited separately via AdminRoleEditor
// (at the top of the user row), so they aren't buried in here.
import { computed, ref } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import MultiSelect from "primevue/multiselect";
import Message from "primevue/message";
import Tag from "primevue/tag";
import { useToast } from "@/composables/useToast";
import { useConfirmAction } from "@/composables/useConfirmAction";
import { humanizeError } from "@/utils/errors";
import { TRADES } from "@/data/trades";
import {
  adminGrantFoundingPro,
  adminSetCardPayments,
  adminSetUserTrades,
} from "@/firebase/services/admin";
import type { TradespersonDoc, UserDoc, WithId } from "@/firebase/interfaces";

const props = defineProps<{
  user: WithId<UserDoc>;
  tradie: WithId<TradespersonDoc> | null;
}>();

const emit = defineEmits<{
  tradesUpdated: [trades: string[]];
}>();

const toast = useToast();
const { confirmDestructive } = useConfirmAction();

// --- Card payments (risk kill switch) -------------------------------------
// ToS § 7.7 reserves the right to withdraw in-app payments to manage fraud or
// chargeback risk; this is the button. Deliberately narrower than disabling the
// account — the tradesperson keeps working and can still be paid by e-transfer
// or cash, we just stop taking cards for them.
const savingCards = ref(false);
const cardsError = ref<string | null>(null);
const cardsPaused = ref(!!props.tradie?.payments?.cardPaymentsPausedAt);
const pauseReason = ref("");

async function setCardPayments(paused: boolean) {
  if (!props.tradie) return;
  savingCards.value = true;
  cardsError.value = null;
  try {
    const res = await adminSetCardPayments({
      tradespersonId: props.tradie.id,
      paused,
      ...(paused && pauseReason.value.trim() ? { reason: pauseReason.value.trim() } : {}),
    });
    cardsPaused.value = res.data.paused;
    if (!paused) pauseReason.value = "";
    toast.success(paused ? "Card payments paused." : "Card payments resumed.");
  } catch (e) {
    cardsError.value = humanizeError(e);
  } finally {
    savingCards.value = false;
  }
}

function confirmPause() {
  confirmDestructive(
    {
      header: "Pause card payments?",
      message:
        "Clients won't be able to pay this tradesperson by card. Their account, jobs and chat keep working, and they can still be paid by e-transfer or cash.",
      acceptLabel: "Pause card payments",
    },
    () => setCardPayments(true),
  );
}

// --- Trades editor --------------------------------------------------------
const selectedTrades = ref<string[]>([...(props.tradie?.trades ?? [])]);
const savedTrades = ref<string[]>([...(props.tradie?.trades ?? [])]);
const savingTrades = ref(false);
const tradesError = ref<string | null>(null);
const key = (r: string[]) => [...r].sort().join(",");
const tradesChanged = computed(() => key(selectedTrades.value) !== key(savedTrades.value));

async function saveTrades() {
  savingTrades.value = true;
  tradesError.value = null;
  try {
    const res = await adminSetUserTrades({
      targetUid: props.user.id,
      trades: selectedTrades.value,
    });
    savedTrades.value = [...res.data.trades];
    selectedTrades.value = [...res.data.trades];
    toast.success(`Trades updated (${res.data.trades.length}).`);
    emit("tradesUpdated", res.data.trades);
  } catch (e) {
    tradesError.value = humanizeError(e);
  } finally {
    savingTrades.value = false;
  }
}

// --- Founding Pro comp (tradesperson only) --------------------------------
// Grants free Blue Seal Pro until a date with no Stripe involved — the
// 3-months-on-us founding offer (MONETIZATION.md). Local state reflects the
// last action; the authoritative isPro comes back on the next user reload.
const savingPro = ref(false);
const proError = ref<string | null>(null);
const compUntil = ref<Date | null>(props.user.subscription?.proCompUntil?.toDate() ?? null);

const proStatusLabel = computed(() => {
  if (props.tradie?.isPro) return "Pro is active";
  return "Not Pro";
});
const compActive = computed(() => !!compUntil.value && compUntil.value.getTime() > Date.now());

// Grant durations. The callable takes an arbitrary `until` ISO datetime, so we
// just compute it from now. Days vs months kept separate so "2 weeks" is exact.
interface ProDuration {
  label: string;
  days?: number;
  months?: number;
}
const PRO_DURATIONS: ProDuration[] = [
  { label: "2 weeks", days: 14 },
  { label: "1 month", months: 1 },
  { label: "3 months", months: 3 },
  { label: "6 months", months: 6 },
  { label: "1 year", months: 12 },
];

async function grantPro(opt: ProDuration) {
  savingPro.value = true;
  proError.value = null;
  try {
    const until = new Date();
    if (opt.days) until.setDate(until.getDate() + opt.days);
    if (opt.months) until.setMonth(until.getMonth() + opt.months);
    const res = await adminGrantFoundingPro({ uid: props.user.id, until: until.toISOString() });
    compUntil.value = res.data.proCompUntil ? new Date(res.data.proCompUntil) : null;
    toast.success(`Granted ${opt.label} of Blue Seal Pro.`);
  } catch (e) {
    proError.value = humanizeError(e);
  } finally {
    savingPro.value = false;
  }
}

async function revokePro() {
  savingPro.value = true;
  proError.value = null;
  try {
    await adminGrantFoundingPro({ uid: props.user.id, until: null });
    compUntil.value = null;
    toast.success("Founding Pro comp revoked.");
  } catch (e) {
    proError.value = humanizeError(e);
  } finally {
    savingPro.value = false;
  }
}
</script>

<template>
  <section class="space-y-4">
    <h3 class="text-xs font-semibold uppercase tracking-wide text-[color:var(--bs-muted)]">
      Trades, Blue Seal Pro &amp; payments
    </h3>

    <!-- Trades -->
    <div class="rounded border border-[color:var(--bs-border)] p-3">
      <p class="text-sm font-medium mb-2">Trades</p>
      <MultiSelect
        v-model="selectedTrades"
        :options="TRADES"
        option-label="label"
        option-value="key"
        filter
        display="chip"
        placeholder="Select trades"
        class="w-full"
        :disabled="savingTrades"
      />
      <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
        Saved trades are marked verified.
      </p>
      <Message v-if="tradesError" severity="error" :closable="false" class="mt-2">
        {{ tradesError }}
      </Message>
      <div class="mt-2">
        <Button
          label="Save trades"
          icon="pi pi-save"
          size="small"
          :loading="savingTrades"
          :disabled="!tradesChanged"
          @click="saveTrades"
        />
      </div>
    </div>

    <!-- Founding Pro comp -->
    <div class="rounded border border-[color:var(--bs-border)] p-3">
      <p class="text-sm font-medium mb-1">Blue Seal Pro (founding comp)</p>
      <p class="text-xs text-[color:var(--bs-muted)]">
        {{ proStatusLabel }}<template v-if="compActive && compUntil">
          — comped until {{ compUntil.toLocaleDateString() }}</template>.
        Grants free Pro (AI + fee waiver) with no Stripe involved.
      </p>
      <Message v-if="proError" severity="error" :closable="false" class="mt-2">
        {{ proError }}
      </Message>
      <p class="mt-2 text-xs text-[color:var(--bs-muted)]">Grant free Pro for:</p>
      <div class="mt-1 flex flex-wrap gap-2">
        <Button
          v-for="opt in PRO_DURATIONS"
          :key="opt.label"
          :label="opt.label"
          icon="pi pi-star"
          size="small"
          outlined
          :loading="savingPro"
          @click="grantPro(opt)"
        />
      </div>
      <div v-if="compActive" class="mt-2">
        <Button
          label="Revoke comp"
          icon="pi pi-times"
          severity="secondary"
          outlined
          size="small"
          :loading="savingPro"
          @click="revokePro"
        />
      </div>
    </div>

    <!-- Card payments (risk) -->
    <div v-if="tradie" class="rounded border border-[color:var(--bs-border)] p-3">
      <div class="flex items-center gap-2 mb-1">
        <p class="text-sm font-medium">Card payments</p>
        <Tag
          :severity="cardsPaused ? 'danger' : 'success'"
          :value="cardsPaused ? 'Paused' : 'Active'"
        />
      </div>
      <p class="text-xs text-[color:var(--bs-muted)]">
        Pausing stops new card payments to this tradesperson. Their account,
        jobs and chat keep working, and clients can still pay by e-transfer or
        cash. Use for fraud or chargeback risk — it's narrower than disabling
        the account.
      </p>
      <Message v-if="cardsError" severity="error" :closable="false" class="mt-2">
        {{ cardsError }}
      </Message>
      <template v-if="!cardsPaused">
        <InputText
          v-model="pauseReason"
          placeholder="Reason (internal note, optional)"
          class="w-full mt-2"
          :disabled="savingCards"
        />
        <div class="mt-2">
          <Button
            label="Pause card payments"
            icon="pi pi-ban"
            severity="danger"
            outlined
            size="small"
            :loading="savingCards"
            @click="confirmPause"
          />
        </div>
      </template>
      <template v-else>
        <p
          v-if="tradie.payments?.cardPaymentsPausedReason"
          class="mt-2 text-xs text-[color:var(--bs-muted)]"
        >
          Reason: {{ tradie.payments.cardPaymentsPausedReason }}
        </p>
        <div class="mt-2">
          <Button
            label="Resume card payments"
            icon="pi pi-check"
            size="small"
            :loading="savingCards"
            @click="setCardPayments(false)"
          />
        </div>
      </template>
    </div>
  </section>
</template>
