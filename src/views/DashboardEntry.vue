<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import ProgressSpinner from "primevue/progressspinner";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";

const auth = useAuthStore();
const router = useRouter();
const toast = useToast();

onMounted(async () => {
  if (!auth.ready) await auth.init();
  // Forward the query so deep links survive the role redirect — e.g. the
  // side-panel "Clients" button hits /dashboard?view=clients, and the tradie
  // dashboard needs ?view=clients to open on the Clients tab.
  const { roleUnavailable, ...query } = router.currentRoute.value.query;
  // The guard redirected a wrong-role deep link here (P2-05). Explain it, then
  // drop the flag so it doesn't ride along to the role dashboard.
  if (roleUnavailable) {
    toast.info("Page not available", "That page isn't available on this account.");
  }
  if (auth.isAdmin) router.replace({ name: "AdminDashboard", query });
  else if (auth.isTradie) router.replace({ name: "TradieDashboard", query });
  else if (auth.isSales) router.replace({ name: "SalesDashboard", query });
  else if (auth.isProjectManager) router.replace({ name: "ProjectManagerDashboard", query });
  else if (auth.isClient) router.replace({ name: "ClientDashboard", query });
  else router.replace({ name: "Home" });
});
</script>

<template>
  <div class="bs-container py-24 flex flex-col items-center gap-3">
    <ProgressSpinner />
    <p class="text-[color:var(--bs-muted)]">Loading your dashboard…</p>
  </div>
</template>
