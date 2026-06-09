<script setup lang="ts">
import { computed, ref } from "vue";
import Button from "primevue/button";
import Tag from "primevue/tag";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import SelectButton from "primevue/selectbutton";
import Message from "primevue/message";
import type { JobExtraDoc, WithId } from "@/firebase/interfaces";
import { proposeExtra, respondExtra, cancelExtra } from "@/firebase/services/jobExtras";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { useConfirmAction } from "@/composables/useConfirmAction";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{
  jobId: string;
  isTradie: boolean;
  isClient: boolean;
  extras: WithId<JobExtraDoc>[];
}>();

const { money } = useFormatters();
const toast = useToast();
const { confirmDestructive } = useConfirmAction();

// Hide cancelled rows — they're just noise once withdrawn.
const visible = computed(() => props.extras.filter((e) => e.status !== "cancelled"));

const STATUS_TAG: Record<
  JobExtraDoc["status"],
  { label: string; severity: "warn" | "success" | "danger" | "secondary" }
> = {
  proposed: { label: "Awaiting approval", severity: "warn" },
  approved: { label: "Approved", severity: "success" },
  declined: { label: "Declined", severity: "danger" },
  cancelled: { label: "Withdrawn", severity: "secondary" },
};

function priceLabel(ex: WithId<JobExtraDoc>): string {
  return ex.billingType === "hourly"
    ? `${money(ex.hourlyRateCents ?? 0)}/hr`
    : money(ex.flatAmountCents ?? 0);
}

// ---- propose (tradie) ----
const showForm = ref(false);
const desc = ref("");
const billingType = ref<"flat" | "hourly">("hourly");
const amountDollars = ref<number | null>(null);
const submitting = ref(false);

const billingOptions = [
  { label: "Hourly", value: "hourly" },
  { label: "Flat fee", value: "flat" },
];

const canSubmit = computed(
  () => desc.value.trim().length > 0 && amountDollars.value != null && amountDollars.value > 0,
);

function resetForm() {
  desc.value = "";
  amountDollars.value = null;
  billingType.value = "hourly";
  showForm.value = false;
}

async function submit() {
  if (!canSubmit.value || submitting.value) return;
  submitting.value = true;
  try {
    await proposeExtra({
      jobId: props.jobId,
      description: desc.value.trim(),
      billingType: billingType.value,
      amountCents: Math.round((amountDollars.value as number) * 100),
    });
    toast.success("Change order sent", "The client will be asked to approve it.");
    resetForm();
  } catch (e) {
    toast.error("Couldn't send change order", humanizeError(e));
  } finally {
    submitting.value = false;
  }
}

// ---- respond (client) ----
const respondingId = ref<string | null>(null);

async function respond(ex: WithId<JobExtraDoc>, accept: boolean) {
  if (respondingId.value) return;
  respondingId.value = ex.id;
  try {
    await respondExtra({ jobId: props.jobId, extraId: ex.id, accept });
    toast.success(accept ? "Change order approved" : "Change order declined");
  } catch (e) {
    toast.error("Couldn't respond", humanizeError(e));
  } finally {
    respondingId.value = null;
  }
}

// ---- withdraw (tradie) ----
function withdraw(ex: WithId<JobExtraDoc>) {
  confirmDestructive(
    {
      message:
        ex.status === "approved"
          ? "Withdraw this approved change order? Any time already clocked against it stays logged but won't be offered again."
          : "Withdraw this change order?",
      header: "Withdraw change order",
      acceptLabel: "Withdraw",
    },
    async () => {
      try {
        await cancelExtra({ jobId: props.jobId, extraId: ex.id });
        toast.success("Change order withdrawn");
      } catch (e) {
        toast.error("Couldn't withdraw", humanizeError(e));
      }
    },
  );
}
</script>

<template>
  <div class="bs-card p-3">
    <header class="flex items-start justify-between gap-2 mb-2">
      <div class="min-w-0">
        <h3 class="font-semibold text-sm">Change orders</h3>
        <p class="text-xs text-[color:var(--bs-muted)] mt-0.5">
          Extra work beyond the original quote. The client approves each one before it's billed.
        </p>
      </div>
      <Button
        v-if="isTradie && !showForm"
        label="Add"
        icon="pi pi-plus"
        size="small"
        outlined
        class="shrink-0"
        @click="showForm = true"
      />
    </header>

    <!-- Propose form (tradie) -->
    <div
      v-if="isTradie && showForm"
      class="rounded-lg border border-[color:var(--bs-border)] p-3 mb-3 space-y-3"
    >
      <div>
        <label class="text-xs font-medium" for="co-desc">What's the extra work?</label>
        <InputText
          id="co-desc"
          v-model="desc"
          maxlength="200"
          placeholder="e.g. Replace corroded shut-off valve"
          class="w-full mt-1"
        />
      </div>
      <div>
        <label class="text-xs font-medium">How is it billed?</label>
        <SelectButton
          v-model="billingType"
          :options="billingOptions"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          class="mt-1"
        />
      </div>
      <div>
        <label class="text-xs font-medium" for="co-amount">
          {{ billingType === "hourly" ? "Hourly rate (CAD)" : "Amount (CAD)" }}
        </label>
        <InputNumber
          v-model="amountDollars"
          input-id="co-amount"
          mode="currency"
          currency="CAD"
          :min="0"
          class="w-full mt-1"
        />
        <p v-if="billingType === 'hourly'" class="text-[11px] text-[color:var(--bs-muted)] mt-1">
          Once approved, clock your time against it from the time tracker above.
        </p>
      </div>
      <div class="flex gap-2">
        <Button label="Cancel" size="small" text severity="secondary" @click="resetForm" />
        <Button
          label="Send for approval"
          icon="pi pi-send"
          size="small"
          class="ml-auto"
          :loading="submitting"
          :disabled="!canSubmit"
          @click="submit"
        />
      </div>
    </div>

    <Message
      v-if="visible.length === 0"
      severity="info"
      :closable="false"
    >
      <template v-if="isTradie">
        Hit "Add" when a job picks up extra work. The client approves it before you bill it.
      </template>
      <template v-else>
        No extra work has been proposed. If the tradesperson finds something beyond the original
        quote, you'll be asked to approve it here first.
      </template>
    </Message>

    <ul v-else class="space-y-2">
      <li
        v-for="ex in visible"
        :key="ex.id"
        class="rounded-lg border border-[color:var(--bs-border)] p-3"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium leading-snug">{{ ex.description }}</div>
            <div class="text-xs text-[color:var(--bs-muted)] mt-0.5">
              {{ priceLabel(ex) }}
              <span v-if="ex.billingType === 'hourly'"> · hourly</span>
              <span v-else> · flat fee</span>
            </div>
          </div>
          <Tag :value="STATUS_TAG[ex.status].label" :severity="STATUS_TAG[ex.status].severity" />
        </div>

        <p
          v-if="ex.status === 'declined' && ex.declinedReason"
          class="text-xs text-[color:var(--bs-muted)] italic mt-2"
        >
          "{{ ex.declinedReason }}"
        </p>

        <!-- Client: approve / decline a proposed change order -->
        <div v-if="isClient && ex.status === 'proposed'" class="grid grid-cols-2 gap-2 mt-3">
          <Button
            label="Decline"
            icon="pi pi-times"
            severity="secondary"
            outlined
            size="small"
            :disabled="respondingId === ex.id"
            @click="respond(ex, false)"
          />
          <Button
            label="Approve"
            icon="pi pi-check"
            severity="success"
            size="small"
            :loading="respondingId === ex.id"
            @click="respond(ex, true)"
          />
        </div>

        <!-- Tradie: withdraw while not yet invoiced -->
        <div
          v-else-if="isTradie && (ex.status === 'proposed' || ex.status === 'approved') && !ex.invoicedAt"
          class="mt-3"
        >
          <Button
            label="Withdraw"
            icon="pi pi-undo"
            severity="secondary"
            text
            size="small"
            @click="withdraw(ex)"
          />
        </div>
      </li>
    </ul>
  </div>
</template>
