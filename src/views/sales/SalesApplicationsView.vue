<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import { listRepApplications, type RepApplicationSummary } from "@/firebase/services/repVetting";
import { tradeLabel } from "@/data/trades";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import LoadingState from "@/components/LoadingState.vue";

// The applications a rep owns and needs to vet (referral or region). Fed by the
// server-filtered listRepApplications callable.
const toast = useToast();
const apps = ref<RepApplicationSummary[]>([]);
const loading = ref(true);

onMounted(load);
async function load() {
  loading.value = true;
  try {
    apps.value = await listRepApplications();
  } catch (e) {
    toast.error("Couldn't load", humanizeError(e));
  } finally {
    loading.value = false;
  }
}

function tradesLabel(trades: string[]): string {
  return trades.map((t) => tradeLabel(t)).filter(Boolean).join(", ") || "—";
}
function agoLabel(ms: number | null): string {
  if (!ms) return "";
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days <= 0) return "today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}
</script>

<template>
  <section class="bs-container py-8 max-w-2xl">
    <RouterLink to="/sales" class="text-xs text-[color:var(--bs-muted)]">← Sales</RouterLink>
    <header class="mt-2 mb-5">
      <h1 class="text-lg font-semibold">Applications to review</h1>
      <p class="text-sm text-[color:var(--bs-muted)] mt-1">
        Tradespeople in your territory, or who signed up with your code, waiting for review. You are
        responsible for checking their certification and ID before they go live.
      </p>
    </header>

    <LoadingState v-if="loading" />
    <div v-else-if="!apps.length" class="text-sm text-[color:var(--bs-muted)]">
      No applications waiting. New ones in your region or from your referral code will show up here.
    </div>
    <div v-else class="space-y-3">
      <div
        v-for="a in apps"
        :key="a.id"
        class="bs-card p-4 flex items-center justify-between gap-3"
      >
        <div class="min-w-0">
          <div class="text-sm font-semibold truncate">{{ a.displayName || "Unnamed applicant" }}</div>
          <div class="text-xs text-[color:var(--bs-muted)] truncate">{{ tradesLabel(a.trades) }}</div>
          <div class="text-[11px] text-[color:var(--bs-muted)] mt-0.5">
            <span>{{ a.referredByRepId ? "Your referral" : "Your region" }}</span>
            <span v-if="a.submittedAtMs"> · submitted {{ agoLabel(a.submittedAtMs) }}</span>
          </div>
        </div>
        <RouterLink :to="{ name: 'SalesApplicationReview', params: { uid: a.id } }">
          <Button label="Review" icon="pi pi-search" size="small" />
        </RouterLink>
      </div>
    </div>
  </section>
</template>
