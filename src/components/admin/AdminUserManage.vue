<script setup lang="ts">
// Tradesperson-only admin tools shown in the expanded user detail: the trades
// editor (also marks them verified) and the founding-member Blue Seal Pro comp.
// Roles are edited separately via AdminRoleEditor (at the top of the user row),
// so they aren't buried in here.
import { computed, ref } from "vue";
import Button from "primevue/button";
import MultiSelect from "primevue/multiselect";
import Message from "primevue/message";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import { TRADES } from "@/data/trades";
import { adminGrantFoundingPro, adminSetUserTrades } from "@/firebase/services/admin";
import type { TradespersonDoc, UserDoc, WithId } from "@/firebase/interfaces";

const props = defineProps<{
  user: WithId<UserDoc>;
  tradie: WithId<TradespersonDoc> | null;
}>();

const emit = defineEmits<{
  tradesUpdated: [trades: string[]];
}>();

const toast = useToast();

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

async function grantPro(months: number) {
  savingPro.value = true;
  proError.value = null;
  try {
    const until = new Date();
    until.setMonth(until.getMonth() + months);
    const res = await adminGrantFoundingPro({ uid: props.user.id, until: until.toISOString() });
    compUntil.value = res.data.proCompUntil ? new Date(res.data.proCompUntil) : null;
    toast.success(`Granted ${months} months of Blue Seal Pro.`);
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
      Trades &amp; Blue Seal Pro
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
      <div class="mt-2 flex flex-wrap gap-2">
        <Button
          label="Grant 3 months"
          icon="pi pi-star"
          size="small"
          :loading="savingPro"
          @click="grantPro(3)"
        />
        <Button
          v-if="compActive"
          label="Revoke comp"
          severity="secondary"
          outlined
          size="small"
          :loading="savingPro"
          @click="revokePro"
        />
      </div>
    </div>
  </section>
</template>
