<script setup lang="ts">
// Admin error log. Lists client-side errors captured by the global handlers
// (main.ts) and explicit reportClientError() calls, lets an admin filter by
// resolved state, inspect the stack, and mark an error resolved. Self-contained
// (no Pinia) per the admin-view convention; reads/writes go through the
// errorReporting service.
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import Tag from "primevue/tag";
import SelectButton from "primevue/selectbutton";
import { listErrorLogs, setErrorResolved } from "@/firebase/services/errorReporting";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import type { ErrorLogDoc, ErrorLogSource, WithId } from "@/firebase/interfaces";
import LoadingState from "@/components/LoadingState.vue";

const { relativeTime } = useFormatters();
const toast = useToast();

const logs = ref<WithId<ErrorLogDoc>[]>([]);
const loading = ref(true);
const errored = ref(false);
const filter = ref<"unresolved" | "resolved" | "all">("unresolved");
const updatingId = ref<string | null>(null);
const expanded = ref<Set<string>>(new Set());

const filterOptions = [
  { label: "Unresolved", value: "unresolved" },
  { label: "Resolved", value: "resolved" },
  { label: "All", value: "all" },
];

function sourceSeverity(s: ErrorLogSource): "warn" | "danger" | "info" {
  if (s === "window" || s === "unhandledrejection") return "danger";
  if (s === "vue") return "warn";
  return "info";
}

const visible = computed(() => {
  if (filter.value === "all") return logs.value;
  const wantResolved = filter.value === "resolved";
  return logs.value.filter((l) => l.resolved === wantResolved);
});
const unresolvedCount = computed(() => logs.value.filter((l) => !l.resolved).length);

async function refresh() {
  loading.value = true;
  errored.value = false;
  try {
    logs.value = await listErrorLogs();
  } catch (e) {
    errored.value = true;
    toast.error("Couldn't load error logs", humanizeError(e));
  } finally {
    loading.value = false;
  }
}

onMounted(refresh);

function toggleExpanded(id: string) {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}

async function toggleResolved(log: WithId<ErrorLogDoc>) {
  updatingId.value = log.id;
  const next = !log.resolved;
  log.resolved = next; // optimistic
  try {
    await setErrorResolved(log.id, next);
  } catch (e) {
    log.resolved = !next;
    toast.error("Couldn't update", humanizeError(e));
  } finally {
    updatingId.value = null;
  }
}
</script>

<template>
  <section class="bs-container py-6">
    <div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <RouterLink to="/dashboard" class="text-xs text-[color:var(--bs-muted)]">← Back</RouterLink>
        <h1 class="mt-1 text-lg font-semibold text-[color:var(--bs-blue-dark)]">Error log</h1>
        <p class="text-sm text-[color:var(--bs-muted)]">
          {{ unresolvedCount }} unresolved · client-side errors users hit, newest first.
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
      <p class="font-medium text-[color:var(--bs-text)]">Couldn't load the error log.</p>
      <p class="mt-1 text-sm">
        If this is the first deploy, the <code>errorLogs</code> security rules may not be live yet.
        Deploy them, then refresh.
      </p>
    </div>

    <div v-else-if="visible.length === 0" class="bs-empty">
      <i class="pi pi-check-circle mr-2 text-[color:var(--bs-success)]"></i>No
      {{ filter === "all" ? "" : filter + " " }}errors.
    </div>

    <ul v-else class="space-y-3">
      <li v-for="l in visible" :key="l.id" class="bs-card p-4" :class="{ 'opacity-60': l.resolved }">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <Tag :severity="sourceSeverity(l.source)" :value="l.source" />
              <span v-if="l.resolved" class="bs-pill text-[11px]">resolved</span>
              <span class="text-xs text-[color:var(--bs-muted)]">{{ relativeTime(l.createdAt) }}</span>
            </div>
            <p class="mt-1 break-words font-medium text-[color:var(--bs-text)]">{{ l.message }}</p>
          </div>
          <Button
            :label="l.resolved ? 'Reopen' : 'Resolve'"
            :icon="l.resolved ? 'pi pi-undo' : 'pi pi-check'"
            size="small"
            :outlined="!l.resolved"
            :severity="l.resolved ? 'secondary' : 'success'"
            :loading="updatingId === l.id"
            @click="toggleResolved(l)"
          />
        </div>

        <dl class="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-[color:var(--bs-muted)] sm:grid-cols-2">
          <div v-if="l.route" class="truncate"><span class="font-medium">Route:</span> {{ l.route }}</div>
          <div v-if="l.context" class="truncate"><span class="font-medium">Where:</span> {{ l.context }}</div>
          <div class="truncate">
            <span class="font-medium">User:</span> {{ l.uid ? l.uid.slice(0, 12) + "…" : "signed out" }}
          </div>
          <div v-if="l.userAgent" class="truncate"><span class="font-medium">Agent:</span> {{ l.userAgent }}</div>
        </dl>

        <div v-if="l.stack" class="mt-2">
          <button
            type="button"
            class="text-xs font-medium text-[color:var(--bs-blue)]"
            @click="toggleExpanded(l.id)"
          >
            {{ expanded.has(l.id) ? "Hide" : "Show" }} stack
          </button>
          <pre
            v-if="expanded.has(l.id)"
            class="mt-1 overflow-x-auto whitespace-pre-wrap rounded-lg bg-[color:var(--bs-surface-alt)] p-3 text-[11px] leading-snug text-[color:var(--bs-text)]"
          >{{ l.stack }}</pre>
        </div>
      </li>
    </ul>
  </section>
</template>
