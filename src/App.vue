<script setup lang="ts">
import { computed } from "vue";
import { RouterView, useRoute } from "vue-router";
import Toast from "primevue/toast";
import ConfirmDialog from "primevue/confirmdialog";
import AppHeader from "@/components/AppHeader.vue";
import AppFooter from "@/components/AppFooter.vue";
import TradieStatusBanner from "@/components/TradieStatusBanner.vue";
import AssistantBubble from "@/components/assistant/AssistantBubble.vue";

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
    <!-- Renders outside the chromeless gate so admins and tradies both see
         it on their respective pages. The bubble has its own route + role
         visibility rules. -->
    <AssistantBubble />
  </div>
</template>
