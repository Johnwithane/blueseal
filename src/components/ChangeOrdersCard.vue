<script setup lang="ts">
import { computed, ref } from "vue";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Message from "primevue/message";
import type { JobExtraDoc, WithId } from "@/firebase/interfaces";
import { respondExtra, cancelExtra } from "@/firebase/services/jobExtras";
import ChangeOrderDialog from "@/components/ChangeOrderDialog.vue";
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

// ---- propose (tradie): popup dialog, same pattern as "Add time manually" ----
const showProposeDialog = ref(false);

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
        v-if="isTradie"
        label="Add"
        icon="pi pi-plus"
        size="small"
        outlined
        class="shrink-0"
        @click="showProposeDialog = true"
      />
    </header>

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
              <span v-if="ex.billingType === 'hourly' && ex.estimatedHours">
                · ~{{ ex.estimatedHours }}h est.</span
              >
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

    <ChangeOrderDialog
      v-if="isTradie"
      v-model:visible="showProposeDialog"
      :job-id="jobId"
    />
  </div>
</template>
