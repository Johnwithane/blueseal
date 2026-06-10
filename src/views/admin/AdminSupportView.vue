<script setup lang="ts">
// Admin support queue. Lists Help Center contact-form tickets, lets an admin
// filter by status, change a ticket's status, and reply by email. Self-
// contained (no Pinia) per the admin-view convention; reads/writes go through
// the support service.
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import { listSupportTickets, setSupportTicketStatus } from "@/firebase/services/support";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import type {
  SupportTicketDoc,
  SupportTicketStatus,
  WithId,
} from "@/firebase/interfaces";
import LoadingState from "@/components/LoadingState.vue";

const { relativeTime } = useFormatters();
const toast = useToast();

const tickets = ref<WithId<SupportTicketDoc>[]>([]);
const loading = ref(true);
const errored = ref(false);
const filter = ref<SupportTicketStatus | "all">("open");
const updatingId = ref<string | null>(null);

const STATUS_OPTIONS: { label: string; value: SupportTicketStatus }[] = [
  { label: "Open", value: "open" },
  { label: "In progress", value: "in_progress" },
  { label: "Resolved", value: "resolved" },
  { label: "Closed", value: "closed" },
];

const filterOptions = [{ label: "All", value: "all" }, ...STATUS_OPTIONS];

function statusSeverity(s: SupportTicketStatus): "info" | "warn" | "success" | "secondary" {
  if (s === "open") return "info";
  if (s === "in_progress") return "warn";
  if (s === "resolved") return "success";
  return "secondary";
}

function statusLabel(s: SupportTicketStatus): string {
  return STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s;
}

const visible = computed(() =>
  filter.value === "all" ? tickets.value : tickets.value.filter((t) => t.status === filter.value),
);
const openCount = computed(() => tickets.value.filter((t) => t.status === "open").length);

async function refresh() {
  loading.value = true;
  errored.value = false;
  try {
    tickets.value = await listSupportTickets();
  } catch (e) {
    errored.value = true;
    toast.error("Couldn't load tickets", humanizeError(e));
  } finally {
    loading.value = false;
  }
}

onMounted(refresh);

async function changeStatus(ticket: WithId<SupportTicketDoc>, status: SupportTicketStatus) {
  if (status === ticket.status) return;
  updatingId.value = ticket.id;
  const prev = ticket.status;
  ticket.status = status; // optimistic
  try {
    await setSupportTicketStatus(ticket.id, status);
    toast.success("Updated", `Marked ${statusLabel(status).toLowerCase()}.`);
  } catch (e) {
    ticket.status = prev;
    toast.error("Couldn't update", humanizeError(e));
  } finally {
    updatingId.value = null;
  }
}

function replyHref(t: WithId<SupportTicketDoc>): string {
  const subject = `Re: [Support] ${t.topic}`;
  return `mailto:${t.email}?subject=${encodeURIComponent(subject)}`;
}
</script>

<template>
  <section class="bs-container py-6">
    <div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <RouterLink to="/dashboard" class="text-xs text-[color:var(--bs-muted)]">← Back</RouterLink>
        <h1 class="mt-1 text-lg font-semibold text-[color:var(--bs-blue-dark)]">Support tickets</h1>
        <p class="text-sm text-[color:var(--bs-muted)]">
          {{ openCount }} open · messages sent from the Help Center contact form.
        </p>
      </div>
      <Button
        label="Refresh"
        icon="pi pi-refresh"
        outlined
        :loading="loading"
        class="self-start sm:self-auto"
        @click="refresh"
      />
    </div>

    <SelectButton
      v-model="filter"
      :options="filterOptions"
      option-label="label"
      option-value="value"
      :allow-empty="false"
      class="mb-4"
    />

    <LoadingState v-if="loading" />

    <div v-else-if="errored" class="bs-empty">
      <i class="pi pi-exclamation-triangle mb-2 block text-2xl text-[color:var(--bs-warning)]"></i>
      <p class="font-medium text-[color:var(--bs-text)]">Couldn't load tickets.</p>
      <p class="mt-1 text-sm">
        If this is the first deploy, the <code>supportTickets</code> security rules may not be live
        yet. Deploy them, then refresh.
      </p>
    </div>

    <div v-else-if="visible.length === 0" class="bs-empty">
      <i class="pi pi-check-circle mr-2 text-[color:var(--bs-success)]"></i>No
      {{ filter === "all" ? "" : statusLabel(filter as SupportTicketStatus).toLowerCase() + " " }}tickets.
    </div>

    <ul v-else class="space-y-3">
      <li v-for="t in visible" :key="t.id" class="bs-card p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-semibold text-[color:var(--bs-blue-dark)]">{{ t.name }}</span>
              <Tag :severity="statusSeverity(t.status)" :value="statusLabel(t.status)" />
              <span class="bs-pill text-[11px]">{{ t.topic }}</span>
            </div>
            <div class="mt-0.5 text-xs text-[color:var(--bs-muted)]">
              {{ t.email }} · {{ relativeTime(t.createdAt) }}
            </div>
          </div>
          <a :href="replyHref(t)" class="no-underline">
            <Button label="Reply" icon="pi pi-reply" size="small" outlined />
          </a>
        </div>

        <p class="mt-3 whitespace-pre-wrap rounded-lg bg-[color:var(--bs-surface-alt)] p-3 text-sm text-[color:var(--bs-text)]">
          {{ t.message }}
        </p>

        <div class="mt-3 flex items-center gap-2">
          <label class="text-xs font-medium text-[color:var(--bs-muted)]">Status</label>
          <Select
            :model-value="t.status"
            :options="STATUS_OPTIONS"
            option-label="label"
            option-value="value"
            :loading="updatingId === t.id"
            class="w-44"
            @update:model-value="(s: SupportTicketStatus) => changeStatus(t, s)"
          />
        </div>
      </li>
    </ul>
  </section>
</template>
