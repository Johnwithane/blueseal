<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import {
  listIncompleteOnboarding,
  nudgeOnboarding,
  type IncompleteOnboardingRow,
} from "@/firebase/services/tradespeople";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { tradeLabel } from "@/data/trades";
import { humanizeError } from "@/utils/errors";
import LoadingState from "@/components/LoadingState.vue";

const rows = ref<IncompleteOnboardingRow[]>([]);
const loading = ref(true);
// Single-flight: any in-flight send disables every "Reach out" button so a
// double-tap can't fire two nudges. Holds the uid currently sending.
const busyUid = ref<string | null>(null);
// Rows nudged this session — shown as "Reached out just now" without a reload.
const justNudged = ref<Record<string, boolean>>({});

const { relativeTime } = useFormatters();
const toast = useToast();

function tradesLabel(r: IncompleteOnboardingRow): string {
  return r.trades.map((k) => tradeLabel(k)).join(", ") || "—";
}

async function refresh() {
  loading.value = true;
  try {
    rows.value = await listIncompleteOnboarding();
  } catch (e) {
    toast.error("Couldn't load incomplete signups", humanizeError(e));
  } finally {
    loading.value = false;
  }
}

async function reachOut(r: IncompleteOnboardingRow) {
  if (!r.email || busyUid.value) return;
  busyUid.value = r.uid;
  try {
    await nudgeOnboarding(r.uid);
    justNudged.value = { ...justNudged.value, [r.uid]: true };
    toast.success("Reached out", `Sent a nudge to ${r.email}.`);
  } catch (e) {
    toast.error("Couldn't send", humanizeError(e));
  } finally {
    busyUid.value = null;
  }
}

onMounted(refresh);
</script>

<template>
  <section class="bs-container py-6">
    <div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <RouterLink to="/dashboard" class="text-xs text-[color:var(--bs-muted)]">← Back</RouterLink>
        <h1 class="text-lg font-semibold mt-1">Incomplete signups</h1>
        <p class="text-[color:var(--bs-muted)] text-sm mt-0.5">
          Tradespeople who started signing up but haven't submitted for review. Oldest first.
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

    <LoadingState v-if="loading" />
    <div v-else-if="rows.length === 0" class="bs-empty">
      <i class="pi pi-check-circle text-[color:var(--bs-success)] mr-2" />Nobody stuck mid-signup.
    </div>
    <ul v-else class="space-y-2">
      <li
        v-for="r in rows"
        :key="r.uid"
        class="bs-card p-3 flex flex-wrap items-center justify-between gap-3"
      >
        <div class="min-w-0">
          <div class="text-sm font-medium truncate">{{ r.displayName }}</div>
          <div class="text-xs text-[color:var(--bs-muted)] mt-0.5">
            {{ tradesLabel(r) }} · signed up {{ relativeTime(r.signedUpAt) }}
          </div>
          <div class="text-xs text-[color:var(--bs-muted)] mt-0.5 truncate">
            <span v-if="r.email">{{ r.email }}</span>
            <span v-else class="text-[color:var(--bs-warning-text)]">No email on file</span>
            <template v-if="justNudged[r.uid]">
              · <span class="text-[color:var(--bs-success)]">reached out just now</span>
            </template>
            <template v-else-if="r.onboardingNudgedAt">
              · reached out {{ relativeTime(r.onboardingNudgedAt) }}
              <template v-if="r.onboardingNudgeCount > 1">({{ r.onboardingNudgeCount }}×)</template>
            </template>
          </div>
        </div>
        <div class="flex gap-2">
          <RouterLink :to="{ name: 'AdminUserDetail', params: { uid: r.uid } }">
            <Button label="Account" icon="pi pi-user" size="small" text />
          </RouterLink>
          <Button
            :label="justNudged[r.uid] ? 'Sent' : 'Reach out'"
            :icon="justNudged[r.uid] ? 'pi pi-check' : 'pi pi-send'"
            size="small"
            :disabled="!r.email || busyUid !== null || justNudged[r.uid]"
            :loading="busyUid === r.uid"
            @click="reachOut(r)"
          />
        </div>
      </li>
    </ul>
  </section>
</template>
