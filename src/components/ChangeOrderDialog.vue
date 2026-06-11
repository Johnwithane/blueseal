<script setup lang="ts">
// Popup for proposing a change order — mirrors ManualTimeEntryDialog so every
// work-order addition (time / expense / change order) feels the same. Mounted
// from ChangeOrdersCard.
import { computed, ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import SelectButton from "primevue/selectbutton";
import { proposeExtra } from "@/firebase/services/jobExtras";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{
  visible: boolean;
  jobId: string;
}>();

const emit = defineEmits<{
  "update:visible": [v: boolean];
  proposed: [];
}>();

const { money } = useFormatters();
const toast = useToast();

const desc = ref("");
const billingType = ref<"flat" | "hourly">("hourly");
const amountDollars = ref<number | null>(null);
const estimatedHours = ref<number | null>(null);
const submitting = ref(false);

const billingOptions = [
  { label: "Hourly", value: "hourly" },
  { label: "Flat fee", value: "flat" },
];

// Fresh form each open.
watch(
  () => props.visible,
  (v) => {
    if (!v) return;
    desc.value = "";
    billingType.value = "hourly";
    amountDollars.value = null;
    estimatedHours.value = null;
    submitting.value = false;
  },
);

const canSubmit = computed(
  () => !submitting.value && desc.value.trim().length > 0 && (amountDollars.value ?? 0) > 0,
);

// Ballpark shown to the client: rate × estimated hours (hourly only).
const estimateCents = computed(() => {
  if (billingType.value !== "hourly") return 0;
  const rate = amountDollars.value ?? 0;
  const hrs = estimatedHours.value ?? 0;
  return rate > 0 && hrs > 0 ? Math.round(rate * 100 * hrs) : 0;
});

async function onSubmit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  try {
    await proposeExtra({
      jobId: props.jobId,
      description: desc.value.trim(),
      billingType: billingType.value,
      amountCents: Math.round((amountDollars.value as number) * 100),
      estimatedHours: billingType.value === "hourly" ? (estimatedHours.value ?? null) : null,
    });
    toast.success("Change order sent", "The client will be asked to approve it.");
    emit("proposed");
    emit("update:visible", false);
  } catch (e) {
    toast.error("Couldn't send change order", humanizeError(e));
  } finally {
    submitting.value = false;
  }
}

function close() {
  if (submitting.value) return;
  emit("update:visible", false);
}
</script>

<template>
  <Dialog
    :visible="props.visible"
    modal
    :closable="!submitting"
    :draggable="false"
    header="Add change order"
    :style="{ width: '92vw', maxWidth: '420px' }"
    @update:visible="(v) => emit('update:visible', v)"
  >
    <div class="space-y-4">
      <p class="text-xs leading-snug text-[color:var(--bs-muted)]">
        Extra work beyond the original quote. The client approves it before it can be billed.
      </p>

      <div>
        <label class="mb-1 block text-[11px] text-[color:var(--bs-muted)]" for="co-desc">
          What's the extra work?
        </label>
        <InputText
          id="co-desc"
          v-model="desc"
          maxlength="200"
          placeholder="e.g. Replace corroded shut-off valve"
          class="w-full"
        />
      </div>

      <div>
        <label class="mb-1 block text-[11px] text-[color:var(--bs-muted)]">How is it billed?</label>
        <SelectButton
          v-model="billingType"
          :options="billingOptions"
          option-label="label"
          option-value="value"
          :allow-empty="false"
        />
      </div>

      <div>
        <label class="mb-1 block text-[11px] text-[color:var(--bs-muted)]" for="co-amount">
          {{ billingType === "hourly" ? "Hourly rate (CAD)" : "Amount (CAD)" }}
        </label>
        <InputNumber
          v-model="amountDollars"
          input-id="co-amount"
          mode="currency"
          currency="CAD"
          :min="0"
          :max-fraction-digits="2"
          class="w-full"
          fluid
        />
      </div>

      <div v-if="billingType === 'hourly'">
        <label class="mb-1 block text-[11px] text-[color:var(--bs-muted)]" for="co-est-hours">
          Estimated hours (optional)
        </label>
        <InputNumber
          v-model="estimatedHours"
          input-id="co-est-hours"
          :min="0"
          :max="10000"
          :max-fraction-digits="2"
          suffix=" hrs"
          class="w-full"
          fluid
        />
        <p class="mt-1 text-[11px] text-[color:var(--bs-muted)] leading-snug">
          <template v-if="estimateCents > 0">
            ≈ {{ money(estimateCents) }} ballpark shown to the client — the invoice
            bills the hours you actually clock against it.
          </template>
          <template v-else>
            Gives the client a ballpark. The invoice bills the hours you actually
            clock against it once approved.
          </template>
        </p>
      </div>
    </div>

    <template #footer>
      <div class="flex w-full gap-2">
        <Button label="Cancel" text :disabled="submitting" class="flex-1" @click="close" />
        <Button
          label="Send for approval"
          icon="pi pi-send"
          :loading="submitting"
          :disabled="!canSubmit"
          class="flex-1"
          @click="onSubmit"
        />
      </div>
    </template>
  </Dialog>
</template>
