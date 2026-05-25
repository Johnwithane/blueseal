<script setup lang="ts">
import { computed, onMounted } from "vue";
import { RouterView, useRoute } from "vue-router";
import Toast from "primevue/toast";
import ConfirmDialog from "primevue/confirmdialog";
import AppHeader from "@/components/AppHeader.vue";
import AppFooter from "@/components/AppFooter.vue";
import TradieStatusBanner from "@/components/TradieStatusBanner.vue";
import AssistantBubble from "@/components/assistant/AssistantBubble.vue";
import RoleSwitchOverlay from "@/components/RoleSwitchOverlay.vue";
import AppShell from "@/components/shell/AppShell.vue";
import { useNotificationsStore } from "@/stores/notifications";

const route = useRoute();
// `meta.layout` decides which shell wraps the route. Unset → "public" (the
// marketing AppHeader/Footer chrome). "app" mounts the Instagram-style
// AppShell; "chromeless" renders the view alone (onboarding wizard).
const layout = computed<"public" | "app" | "chromeless">(
  () => (route.meta.layout as "public" | "app" | "chromeless" | undefined) ?? "public",
);

// Start the notifications subscription as soon as the app mounts. The store
// itself watches auth.fbUser.uid so it survives sign-in/out without us having
// to re-init. Both AppHeader (public chrome) and the AppShell's
// NotificationsButton consume the same store.
onMounted(() => {
  useNotificationsStore().init();
});
</script>

<template>
  <div class="min-h-full flex flex-col">
    <template v-if="layout === 'public'">
      <AppHeader />
      <TradieStatusBanner />
      <main class="flex-1">
        <RouterView />
      </main>
      <AppFooter />
    </template>

    <AppShell v-else-if="layout === 'app'" class="flex-1">
      <RouterView />
    </AppShell>

    <main v-else class="flex-1">
      <!-- Chromeless: onboarding wizard renders with no shell. -->
      <RouterView />
    </main>

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
