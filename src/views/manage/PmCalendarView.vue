<script setup lang="ts">
// Global calendar (Project Manager). One place to see every scheduled job across
// all the PM's projects/properties. Reuses the read-only CalendarView the
// tradesperson side already uses (isEditable=false — a PM watches, never edits a
// trade's schedule). Whole surface is Blue Seal Pro, the same subscription
// tradespeople use. The PM has no availability of their own, so an empty week is
// passed; the value is the scheduled jobs.
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import { storeToRefs } from "pinia";
import { useAuthStore } from "@/stores/auth";
import { useSubscriptionStore } from "@/stores/subscription";
import { useSeo } from "@/composables/useSeo";
import { subscribeProjectJobsForPm } from "@/firebase/services/jobs";
import { emptyAvailability } from "@/firebase/services/tradespeople";
import CalendarView from "@/components/CalendarView.vue";
import type { JobDoc, WithId } from "@/firebase/interfaces";

useSeo({ title: "Calendar", noindex: true });

const auth = useAuthStore();
const store = useSubscriptionStore();
const { isPro, loaded: subLoaded } = storeToRefs(store);
const isAdmin = computed(() => (auth.roles ?? []).includes("admin"));
const gated = computed(() => subLoaded.value && !isPro.value && !isAdmin.value);

const jobs = ref<WithId<JobDoc>[]>([]);
const noAvailability = emptyAvailability();
let unsub: (() => void) | null = null;

function start() {
  if (!auth.fbUser || gated.value) return;
  unsub?.();
  unsub = subscribeProjectJobsForPm(auth.fbUser.uid, (j) => (jobs.value = j));
}
onMounted(start);
onUnmounted(() => unsub?.());

const scheduledCount = computed(() => jobs.value.filter((j) => j.scheduledStart).length);
</script>

<template>
  <section class="bs-container py-8 max-w-3xl">
    <h1 class="text-2xl font-bold mb-1">Calendar</h1>
    <p class="text-sm text-[color:var(--bs-muted)] mb-4">
      Every scheduled job across your properties, in one view.
    </p>

    <!-- Pro gate (whole surface), same subscription as the tradesperson tools. -->
    <div v-if="gated" class="bs-card p-6 text-center">
      <i class="pi pi-lock text-3xl text-[color:var(--bs-blue)]"></i>
      <h2 class="mt-3 text-lg font-semibold">The calendar is part of Blue Seal Pro</h2>
      <p class="mt-2 text-sm text-[color:var(--bs-muted)] max-w-sm mx-auto">
        See every job your trades have scheduled across all your clients on one calendar.
      </p>
      <RouterLink to="/pricing" class="inline-block mt-5">
        <Button label="Start 30-day free trial" icon="pi pi-star" />
      </RouterLink>
    </div>

    <template v-else>
      <p v-if="scheduledCount === 0" class="bs-card p-6 text-center text-sm text-[color:var(--bs-muted)]">
        No scheduled jobs yet. Once a trade schedules a job on one of your projects, it shows here.
      </p>
      <CalendarView :jobs="jobs" :availability="noAvailability" :is-editable="false" />
    </template>
  </section>
</template>
