<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import Button from "primevue/button";
import SelectButton from "primevue/selectbutton";
import Message from "primevue/message";
import { useAuthStore } from "@/stores/auth";
import { getTradesperson } from "@/firebase/services/tradespeople";
import { subscribeTradieJobs } from "@/firebase/services/jobs";
import type { JobDoc, TradespersonDoc, WithId } from "@/firebase/interfaces";
import KanbanBoard from "@/components/KanbanBoard.vue";
import CalendarView from "@/components/CalendarView.vue";

const auth = useAuthStore();
const router = useRouter();
const tradie = ref<WithId<TradespersonDoc> | null>(null);
const jobs = ref<WithId<JobDoc>[]>([]);
const view = ref<"kanban" | "calendar">("kanban");
const viewOptions = [
  { label: "Kanban", value: "kanban" },
  { label: "Calendar", value: "calendar" },
];

let unsub: (() => void) | null = null;

onMounted(async () => {
  if (!auth.fbUser) return;
  tradie.value = await getTradesperson(auth.fbUser.uid);
  if (!tradie.value || tradie.value.vettingStatus === "draft") {
    router.replace({ name: "TradieOnboarding" });
    return;
  }
  unsub = subscribeTradieJobs(auth.fbUser.uid, (j) => (jobs.value = j));
});

onUnmounted(() => unsub?.());

const vetting = computed(() => tradie.value?.vettingStatus);
const banner = computed(() => {
  switch (vetting.value) {
    case "pending":
      return {
        severity: "info" as const,
        text: "Your application is under review. We'll notify you when it's approved.",
      };
    case "info_requested":
      return {
        severity: "warn" as const,
        text: `Reviewer requested more info: ${tradie.value?.vettingNotes ?? ""}`,
      };
    case "rejected":
      return {
        severity: "error" as const,
        text: `Application rejected: ${tradie.value?.vettingNotes ?? ""}`,
      };
    default:
      return null;
  }
});
</script>

<template>
  <section class="bs-container py-6">
    <div class="flex items-start justify-between gap-4 mb-4 flex-wrap">
      <div>
        <h1 class="text-2xl font-bold">Your jobs</h1>
        <p class="text-[color:var(--bs-muted)] text-sm">
          Drag cards between columns to update status.
        </p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <SelectButton v-model="view" :options="viewOptions" option-label="label" option-value="value" />
        <template v-if="tradie?.isVisible">
          <RouterLink to="/jobs/browse">
            <Button label="Browse open jobs" icon="pi pi-megaphone" outlined />
          </RouterLink>
          <RouterLink to="/my-applications">
            <Button label="My applications" icon="pi pi-send" text />
          </RouterLink>
        </template>
      </div>
    </div>

    <Message v-if="banner" :severity="banner.severity" :closable="false" class="mb-4">
      {{ banner.text }}
      <template v-if="vetting === 'info_requested' || vetting === 'draft'">
        <RouterLink to="/onboarding" class="ml-2 underline">Update application</RouterLink>
      </template>
    </Message>

    <KanbanBoard v-if="view === 'kanban' && tradie?.isVisible" :jobs="jobs" />
    <CalendarView v-else-if="view === 'calendar' && tradie?.isVisible" :jobs="jobs" :availability="tradie.weeklyAvailability" />

    <div v-if="!tradie?.isVisible && vetting !== 'pending'" class="bs-empty mt-4">
      <i class="pi pi-clock text-3xl mb-2 block"></i>
      <p>Your profile isn't live yet. Finish onboarding to start receiving requests.</p>
      <RouterLink to="/onboarding" class="inline-block mt-3">
        <Button label="Continue onboarding" icon="pi pi-arrow-right" />
      </RouterLink>
    </div>
  </section>
</template>
