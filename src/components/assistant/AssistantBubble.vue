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

// AI is a jobs-helper for tradespeople: it should only surface on the
// TradieDashboard (their Jobs page). Anywhere else — Account, Browse jobs,
// Recommendations, Payouts — it's noise. JobDetail has its own combined
// Chat + AI overlay (JobChatOverlay) which handles per-job AI, so the
// global bubble doesn't appear there either. Admins still see the bubble
// across the admin surface since their assistant has a different scope.
const visible = computed(() => {
  if (!auth.isAuthenticated) return false;
  if (auth.isTradie) return route.name === "TradieDashboard";
  if (auth.isAdmin) return true;
  return false;
});

// Routes that should hide the bubble even for an eligible role — wizards,
// auth screens, and anything where a floating overlay would fight the page.
const HIDDEN_ROUTE_PREFIXES = ["/sign-in", "/sign-up", "/forgot-password", "/onboarding"];
// JobDetail has its own combined Chat + AI overlay (JobChatOverlay), so the
// global bubble would double up. Kept here so it also covers admins viewing
// a job detail page.
const HIDDEN_ROUTE_NAMES = new Set(["JobDetail"]);
const hiddenOnThisRoute = computed(() => {
  if (HIDDEN_ROUTE_PREFIXES.some((p) => route.path.startsWith(p))) return true;
  if (typeof route.name === "string" && HIDDEN_ROUTE_NAMES.has(route.name)) return true;
  return false;
});
const shouldRender = computed(() => visible.value && !hiddenOnThisRoute.value);

function deriveScopeAndJobId(): { scope: AssistantScope; jobId: string | null } {
  if (route.name === "JobDetail" && typeof route.params.id === "string") {
    return { scope: "job", jobId: route.params.id };
  }
  if (auth.isAdmin) return { scope: "admin", jobId: null };
  return { scope: "general", jobId: null };
}

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

watch(
  () => auth.isAuthenticated,
  (isAuth) => {
    if (!isAuth) store.reset();
  },
);

onBeforeUnmount(() => store.reset());
</script>

<template>
  <template v-if="shouldRender">
    <button
      v-if="!store.isOpen"
      type="button"
      class="bs-ai-fab"
      aria-label="Open AI assistant"
      title="Ask Blue Seal AI"
      @click="store.open()"
    >
      <span class="bs-ai-fab__glyph" aria-hidden="true">
        <img src="/icons/blueseal_logo_Character.png" alt="" />
      </span>
      <span class="bs-ai-fab__label">AI</span>
    </button>
    <AssistantPanel v-if="store.isOpen" />
  </template>
</template>

<style scoped>
.bs-ai-fab {
  position: fixed;
  /* Sit just above the mobile bottom nav (56px bar + safe-area inset),
     anchored at the SAME height as the Report-a-bug FAB on the left so the two
     line up. AppShell hides the bottom nav above `md`, so the desktop rule
     below resets to the original placement. */
  bottom: calc(56px + env(safe-area-inset-bottom) + 0.5rem);
  right: 1rem;
  z-index: 40;
  height: 3.25rem;
  padding: 0 1rem 0 0.55rem;
  border: none;
  border-radius: 9999px;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: white;
  font-weight: 600;
  font-size: 0.875rem;
  letter-spacing: 0.02em;
  cursor: pointer;
  /* Brand-aligned blue gradient — distinctly "AI" without going full
     Gemini-rainbow. The deep-blue end keeps it readable on light pages. */
  background: linear-gradient(135deg, #6dd5ed 0%, var(--bs-blue) 45%, var(--bs-blue-dark) 100%);
  box-shadow:
    0 8px 24px rgba(29, 64, 106, 0.28),
    0 1px 0 rgba(255, 255, 255, 0.35) inset;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.bs-ai-fab:hover {
  transform: translateY(-1px);
  box-shadow:
    0 12px 28px rgba(29, 64, 106, 0.32),
    0 1px 0 rgba(255, 255, 255, 0.4) inset;
}
.bs-ai-fab:focus-visible {
  outline: 2px solid var(--bs-blue-dark);
  outline-offset: 3px;
}
.bs-ai-fab__glyph {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 9999px;
  background: white;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.12) inset;
}
.bs-ai-fab__glyph img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.bs-ai-fab__label {
  padding-right: 0.25rem;
}
@media (min-width: 768px) {
  /* No bottom nav above `md` — restore the original FAB placement. */
  .bs-ai-fab {
    bottom: 1.5rem;
    right: 1.5rem;
  }
}
</style>
