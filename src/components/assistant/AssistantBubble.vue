<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from "vue";
import { useRoute } from "vue-router";
import { useAssistantStore } from "@/stores/assistant";
import { useAuthStore } from "@/stores/auth";
import type { AssistantScope } from "@/firebase/interfaces";
import AssistantPanel from "@/components/assistant/AssistantPanel.vue";

const auth = useAuthStore();
const route = useRoute();
const store = useAssistantStore();

// Tradesperson + admin only. Clients use the per-job human chat instead.
const visible = computed(() => auth.isAuthenticated && (auth.isTradie || auth.isAdmin));

// Routes that should hide the bubble even for an eligible role — wizards,
// auth screens, and anything where a floating overlay would fight the page.
const HIDDEN_ROUTE_PREFIXES = ["/sign-in", "/sign-up", "/forgot-password", "/onboarding"];
const hiddenOnThisRoute = computed(() =>
  HIDDEN_ROUTE_PREFIXES.some((p) => route.path.startsWith(p)),
);
const shouldRender = computed(() => visible.value && !hiddenOnThisRoute.value);

function deriveScopeAndJobId(): { scope: AssistantScope; jobId: string | null } {
  // /jobs/:id → job scope (both tradies and admins get a per-job thread when
  // they're inside a specific job).
  if (route.name === "JobDetail" && typeof route.params.id === "string") {
    return { scope: "job", jobId: route.params.id };
  }
  // Anywhere else: admins get the cross-page admin thread; tradies get a
  // rolling general thread. The current page injects into the per-turn
  // prompt (set via store.setContext below) so the bot knows what the user
  // is looking at without spawning a thread per page.
  if (auth.isAdmin) return { scope: "admin", jobId: null };
  return { scope: "general", jobId: null };
}

// Keep the store's context in sync with the route + role. Runs immediately so
// the very first send carries the right scope.
watch(
  [() => route.fullPath, () => auth.activeRole, () => auth.fbUser?.uid ?? null],
  () => {
    if (!shouldRender.value) return;
    const { scope, jobId } = deriveScopeAndJobId();
    void store.setContext({
      userId: auth.fbUser?.uid ?? null,
      scope,
      jobId,
      pageRoute: route.fullPath,
    });
  },
  { immediate: true },
);

// Sign-out: drop subscriptions + close panel. We don't watch auth.fbUser
// alone because role-only changes (admin → tradie via switcher) also matter
// — those are covered by the watcher above re-binding the scope.
watch(
  () => auth.isAuthenticated,
  (isAuth) => {
    if (!isAuth) store.reset();
  },
);

onBeforeUnmount(() => store.reset());

const unreadHint = computed(() => store.messages.length > 0 && !store.isOpen);
</script>

<template>
  <template v-if="shouldRender">
    <button
      v-if="!store.isOpen"
      type="button"
      class="bs-assistant-bubble"
      :aria-label="'Open assistant'"
      @click="store.open()"
    >
      <i class="pi pi-comments" aria-hidden="true" />
      <span v-if="unreadHint" class="bs-assistant-bubble__dot" aria-hidden="true" />
    </button>
    <AssistantPanel v-if="store.isOpen" />
  </template>
</template>

<style scoped>
.bs-assistant-bubble {
  position: fixed;
  bottom: 1rem;
  right: 1rem;
  z-index: 40;
  width: 3.25rem;
  height: 3.25rem;
  border-radius: 9999px;
  background: var(--bs-blue);
  color: white;
  border: none;
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.18);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.4rem;
  cursor: pointer;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
.bs-assistant-bubble:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.22);
}
.bs-assistant-bubble:focus-visible {
  outline: 2px solid var(--bs-blue-dark);
  outline-offset: 2px;
}
.bs-assistant-bubble__dot {
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
  width: 0.65rem;
  height: 0.65rem;
  border-radius: 9999px;
  background: var(--bs-amber);
  border: 2px solid white;
}
@media (min-width: 640px) {
  .bs-assistant-bubble {
    bottom: 1.5rem;
    right: 1.5rem;
  }
}
</style>
