<script setup lang="ts">
// Set up a recurring charge for a client. Collects a label, frequency, and a
// small line-item list; on save the createRecurringPlan callable builds the
// backing job + template invoice the engine drafts each period. unitPrice is
// entered in dollars and converted to cents at the boundary.
import { computed, reactive, ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import SelectButton from "primevue/selectbutton";
import NumberField from "@/components/NumberField.vue";
import { createRecurringPlan } from "@/firebase/services/clientsService";
import { usePaywallStore } from "@/stores/paywall";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{ visible: boolean; clientId: string }>();
const emit = defineEmits<{ "update:visible": [value: boolean]; created: [] }>();

const { money } = useFormatters();
const toast = useToast();
const paywall = usePaywallStore();
const saving = ref(false);

const label = ref("");
const frequency = ref<"weekly" | "monthly" | "quarterly">("monthly");
const frequencyOptions = [
  { label: "Weekly", value: "weekly" as const },
  { label: "Monthly", value: "monthly" as const },
  { label: "Quarterly", value: "quarterly" as const },
];

interface Row {
  description: string;
  quantity: number;
  unitPriceDollars: number;
  taxRate: number;
}
const rows = reactive<Row[]>([]);

function blankRow(): Row {
  return { description: "", quantity: 1, unitPriceDollars: 0, taxRate: 0 };
}
function reset() {
  label.value = "";
  frequency.value = "monthly";
  rows.splice(0, rows.length, blankRow());
}
watch(
  () => props.visible,
  (v) => {
    if (v) reset();
  },
);

const cents = (d: number) => Math.round(d * 100);
const totalCents = computed(() =>
  rows.reduce((s, r) => {
    const line = cents((r.quantity || 0) * (r.unitPriceDollars || 0));
    return s + line + Math.round(line * (r.taxRate ?? 0));
  }, 0),
);
const validRows = computed(() =>
  rows.filter((r) => r.description.trim() && r.unitPriceDollars > 0),
);
const canSave = computed(() => label.value.trim().length > 0 && validRows.value.length > 0);

const freqWord = computed(
  () => ({ weekly: "week", monthly: "month", quarterly: "quarter" })[frequency.value],
);

async function save() {
  if (!canSave.value || saving.value) return;
  saving.value = true;
  try {
    await createRecurringPlan({
      clientId: props.clientId,
      label: label.value.trim(),
      frequency: frequency.value,
      lineItems: validRows.value.map((r) => ({
        description: r.description.trim(),
        quantity: r.quantity || 1,
        unitPrice: cents(r.unitPriceDollars),
        taxRate: r.taxRate ?? 0,
      })),
      discount: null,
    });
    toast.success("Recurring charge set up", "A draft is ready to review and send.");
    emit("created");
    emit("update:visible", false);
  } catch (e) {
    if (paywall.fromError(e)) {
      emit("update:visible", false);
      return;
    }
    toast.error(humanizeError(e));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    header="Set up recurring billing"
    :style="{ width: '94vw', maxWidth: '36rem' }"
    :draggable="false"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="space-y-3">
      <div>
        <label class="block text-xs text-[color:var(--bs-muted)] mb-1">What's this for?</label>
        <InputText
          v-model="label"
          maxlength="140"
          class="w-full"
          placeholder="e.g. Monthly pool maintenance"
        />
      </div>

      <div>
        <label class="block text-xs text-[color:var(--bs-muted)] mb-1">Bill every</label>
        <SelectButton
          v-model="frequency"
          :options="frequencyOptions"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          class="text-sm"
        />
      </div>

      <div>
        <label class="block text-xs text-[color:var(--bs-muted)] mb-1">Charges</label>
        <div class="space-y-2">
          <div v-for="(r, i) in rows" :key="i" class="flex items-end gap-2">
            <div class="flex-1 min-w-0">
              <InputText v-model="r.description" maxlength="200" class="w-full" placeholder="Description" />
            </div>
            <div class="w-28 shrink-0">
              <NumberField v-model="r.unitPriceDollars" :min="0" mode="currency" currency="CAD" :input-class="'w-full text-right'" />
            </div>
            <Button
              v-if="rows.length > 1"
              icon="pi pi-times"
              text
              severity="danger"
              size="small"
              aria-label="Remove charge"
              @click="rows.splice(i, 1)"
            />
          </div>
        </div>
        <Button label="Add charge" icon="pi pi-plus" text size="small" class="mt-1" @click="rows.push(blankRow())" />
      </div>

      <div class="flex justify-between border-t pt-2 text-sm font-semibold">
        <span>Each {{ freqWord }}</span>
        <span>{{ money(totalCents) }}</span>
      </div>
      <p class="text-[11px] text-[color:var(--bs-muted)]">
        Blue Seal drafts this invoice for you to review and send each {{ freqWord }} — it's
        never sent automatically.
      </p>
    </div>

    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="emit('update:visible', false)" />
      <Button
        label="Set up billing"
        icon="pi pi-replay"
        :disabled="!canSave"
        :loading="saving"
        @click="save"
      />
    </template>
  </Dialog>
</template>
