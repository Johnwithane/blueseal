<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import ProgressSpinner from "primevue/progressspinner";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const router = useRouter();

onMounted(async () => {
  if (!auth.ready) await auth.init();
  // Forward the query so deep links survive the role redirect — e.g. the
  // side-panel "Clients" button hits /dashboard?view=clients, and the tradie
  // dashboard needs ?view=clients to open on the Clients tab.
  const query = router.currentRoute.value.query;
  if (auth.isAdmin) router.replace({ name: "AdminDashboard", query });
  else if (auth.isTradie) router.replace({ name: "TradieDashboard", query });
  else if (auth.isSales) router.replace({ name: "SalesDashboard", query });
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
