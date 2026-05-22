<script setup lang="ts">
import { computed } from "vue";
import { RouterView, useRoute } from "vue-router";
import Toast from "primevue/toast";
import ConfirmDialog from "primevue/confirmdialog";
import AppHeader from "@/components/AppHeader.vue";
import AppFooter from "@/components/AppFooter.vue";
import TradieStatusBanner from "@/components/TradieStatusBanner.vue";

const route = useRoute();
const chromeless = computed(() => route.path === "/onboarding" || route.path.startsWith("/admin"));
</script>

<template>
  <div class="min-h-full flex flex-col">
    <AppHeader v-if="!chromeless" />
    <TradieStatusBanner v-if="!chromeless" />
    <main class="flex-1">
      <RouterView />
    </main>
    <AppFooter v-if="!chromeless" />
    <Toast position="top-right" />
    <ConfirmDialog />
  </div>
</template>
