<script setup lang="ts">
// One recurring charge: header (amount / frequency / next draft / status),
// pause-resume, the draft invoices to review & send inline (reusing the full
// InvoiceEditor), and a compact history of past invoices. The "plan" is the
// backing job; its template invoice carries the recurring config, and the
// engine drafts a fresh invoice on the same job each period.
import { computed, onMounted, ref } from "vue";
import Button from "primevue/button";
import Tag from "primevue/tag";
import InvoiceEditor from "@/components/InvoiceEditor.vue";
import { listJobInvoices } from "@/firebase/services/invoices";
import { setRecurringPlanState } from "@/firebase/services/clientsService";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import type { InvoiceDoc, JobDoc, WithId } from "@/firebase/interfaces";

const props = defineProps<{ job: WithId<JobDoc>; tradieUid: string }>();

const { money, date } = useFormatters();
const toast = useToast();
const invoices = ref<WithId<InvoiceDoc>[]>([]);
const loading = ref(true);
const toggling = ref(false);

const template = computed(() => invoices.value.find((i) => i.recurring) ?? null);
const enabled = computed(() => template.value?.recurring?.enabled === true);
const frequency = computed(() => template.value?.recurring?.frequency ?? "monthly");
const nextRunAt = computed(() => template.value?.recurring?.nextRunAt ?? null);
const amount = computed(() => template.value?.total ?? 0);
const drafts = computed(() => invoices.value.filter((i) => i.status === "draft"));
const past = computed(() => invoices.value.filter((i) => i.status !== "draft"));
const freqWord = computed(
  () => ({ weekly: "week", monthly: "month", quarterly: "quarter" })[frequency.value] ?? "period",
);

async function load() {
  loading.value = true;
  try {
    invoices.value = await listJobInvoices(props.tradieUid, props.job.id);
  } catch (e) {
    toast.error("Couldn't load this plan", humanizeError(e));
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function toggle() {
  toggling.value = true;
  try {
    await setRecurringPlanState(props.job.id, !enabled.value);
    await load();
  } catch (e) {
    toast.error(humanizeError(e));
  } finally {
    toggling.value = false;
  }
}
</script>

<template>
  <div class="bs-card p-4">
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0">
        <div class="font-semibold truncate">{{ job.title }}</div>
        <div class="text-sm text-[color:var(--bs-muted)]">
          {{ money(amount) }} / {{ freqWord }}
          <span v-if="nextRunAt && enabled"> · next draft {{ date(nextRunAt) }}</span>
        </div>
      </div>
      <Tag :value="enabled ? 'Active' : 'Paused'" :severity="enabled ? 'success' : 'secondary'" />
    </div>

    <div class="mt-2">
      <Button
        :label="enabled ? 'Pause' : 'Resume'"
        :icon="enabled ? 'pi pi-pause' : 'pi pi-play'"
        size="small"
        outlined
        :loading="toggling"
        @click="toggle"
      />
    </div>

    <div v-if="loading" class="text-sm text-[color:var(--bs-muted)] mt-3">
      <i class="pi pi-spin pi-spinner mr-1"></i> Loading…
    </div>
    <template v-else>
      <div v-if="drafts.length" class="mt-3 space-y-2">
        <p class="text-xs font-medium text-[color:var(--bs-muted)]">To review &amp; send</p>
        <InvoiceEditor
          v-for="d in drafts"
          :key="d.id"
          :invoice-id="d.id"
          :can-edit="true"
          :client-name="job.clientName"
          :default-collapsed="true"
        />
      </div>

      <div v-if="past.length" class="mt-3">
        <p class="text-xs font-medium text-[color:var(--bs-muted)] mb-1">History</p>
        <ul class="text-sm space-y-1">
          <li v-for="p in past" :key="p.id" class="flex items-center justify-between gap-2">
            <span class="truncate">{{ p.invoiceNumber }} · {{ date(p.issuedAt) }}</span>
            <span class="flex items-center gap-2 shrink-0">
              <Tag :value="p.status" />
              {{ money(p.total) }}
            </span>
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>
