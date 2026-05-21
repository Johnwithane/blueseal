<script setup lang="ts">
import { onMounted } from "vue";
import { useRouter } from "vue-router";
import ProgressSpinner from "primevue/progressspinner";
import { useAuthStore } from "@/stores/auth";

const auth = useAuthStore();
const router = useRouter();

onMounted(async () => {
  if (!auth.ready) await auth.init();
  if (auth.isAdmin) router.replace({ name: "AdminDashboard" });
  else if (auth.isTradie) router.replace({ name: "TradieDashboard" });
  else if (auth.isClient) router.replace({ name: "ClientDashboard" });
  else router.replace({ name: "Home" });
});
</script>

<template>
  <div class="bs-container py-24 flex flex-col items-center gap-3">
    <ProgressSpinner />
    <p class="text-[color:var(--bs-muted)]">Loading your dashboard…</p>
  </div>
</template>
