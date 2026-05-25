<script setup lang="ts">
import { computed } from "vue";
import { RouterView, useRoute } from "vue-router";
import Toast from "primevue/toast";
import ConfirmDialog from "primevue/confirmdialog";
import AppHeader from "@/components/AppHeader.vue";
import AppFooter from "@/components/AppFooter.vue";
import TradieStatusBanner from "@/components/TradieStatusBanner.vue";
import AssistantBubble from "@/components/assistant/AssistantBubble.vue";
import RoleSwitchOverlay from "@/components/RoleSwitchOverlay.vue";

const route = useRoute();
const chromeless = computed(() => route.path === "/onboarding" || route.path.startsWith("/admin"));
// Mobile-compact routes hide the global chrome below the `sm` breakpoint so
// content (chat threads, sticky CTAs) can use the full viewport height. The
// chrome stays on tablet/desktop because the screen has the room.
const mobileCompact = computed(() => route.meta.mobileCompact === true);
</script>

<template>
  <div class="min-h-full flex flex-col">
    <AppHeader
      v-if="!chromeless"
      :class="{ 'hidden sm:block': mobileCompact }"
    />
    <TradieStatusBanner
      v-if="!chromeless"
      :class="{ 'hidden sm:block': mobileCompact }"
    />
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
    <!-- Global overlay for Airbnb-style role switches. Stays mounted; the
         component shows/hides itself based on the role-switch animation
         store, which `auth.switchActiveRole` drives. -->
    <RoleSwitchOverlay />
  </div>
</template>
