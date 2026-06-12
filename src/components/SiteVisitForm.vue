<script setup lang="ts">
// Compact editor for a "site visit before quoting" ask. Used by both hosts —
// QuoteSheet (direct request) and the marketplace apply form — when the
// tradesperson toggles "I need a site visit first" instead of building a full
// quote. Emits a normalized state; the host owns the submit action. A single
// fee line ($0 = free visit), an optional proposed date and an optional note.
import { computed, ref, watch } from "vue";
import InputText from "primevue/inputtext";
import NumberField from "@/components/NumberField.vue";
import Textarea from "primevue/textarea";

export interface SiteVisitFormState {
  valid: boolean;
  fee: { description: string; feeCents: number; taxRate: number };
  proposedDate: string | null; // YYYY-MM-DD
  note: string;
}

const emit = defineEmits<{
  "update:state": [state: SiteVisitFormState];
}>();

const description = ref("Site visit / assessment");
const amountDollars = ref<number | null>(0);
const taxPercent = ref<number | null>(0);
const proposedDate = ref<string>("");
const note = ref("");

const feeCents = computed(() => Math.round((amountDollars.value ?? 0) * 100));
const taxRate = computed(() => Math.max(0, Math.min(0.5, (taxPercent.value ?? 0) / 100)));
const isFree = computed(() => feeCents.value === 0);
const valid = computed(() => description.value.trim().length > 0);

watch(
  [description, feeCents, taxRate, proposedDate, note, valid],
  () => {
    emit("update:state", {
      valid: valid.value,
      fee: { description: description.value.trim(), feeCents: feeCents.value, taxRate: taxRate.value },
      proposedDate: proposedDate.value || null,
      note: note.value.trim(),
    });
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex flex-col gap-4">
    <p class="text-sm text-[color:var(--bs-muted)]">
      Ask to see the job before you commit to a price. The client agrees with one tap — no
      signature. Set a fee for the visit, or leave it at $0 for a free visit.
    </p>

    <div>
      <label class="block text-sm font-medium mb-1">What's the visit for?</label>
      <InputText v-model="description" class="w-full" maxlength="200" placeholder="e.g. Site visit / assessment" />
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="block text-sm font-medium mb-1">Visit fee</label>
        <NumberField
          v-model="amountDollars"
          mode="currency"
          currency="CAD"
          :min="0"
          :max-fraction-digits="2"
          input-class="w-full"
          class="w-full"
        />
        <p class="text-xs mt-1" :class="isFree ? 'text-[color:var(--bs-blue)] font-medium' : 'text-[color:var(--bs-muted)]'">
          {{ isFree ? "Free visit — no charge" : "Leave at $0 for a free visit" }}
        </p>
      </div>
      <div>
        <label class="block text-sm font-medium mb-1">Tax %</label>
        <NumberField
          v-model="taxPercent"
          :min="0"
          :max="50"
          :max-fraction-digits="2"
          suffix="%"
          input-class="w-full"
          class="w-full"
        />
      </div>
    </div>

    <div>
      <label class="block text-sm font-medium mb-1">Proposed visit date <span class="text-[color:var(--bs-muted)] font-normal">(optional)</span></label>
      <input v-model="proposedDate" type="date" class="bs-date-input w-full" />
    </div>

    <div>
      <label class="block text-sm font-medium mb-1">Note <span class="text-[color:var(--bs-muted)] font-normal">(optional)</span></label>
      <Textarea v-model="note" rows="2" class="w-full" maxlength="500" auto-resize placeholder="Anything the client should know before the visit" />
    </div>
  </div>
</template>

<style scoped>
.bs-date-input {
  border: 1px solid var(--bs-border);
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.95rem;
  background: white;
}
</style>
