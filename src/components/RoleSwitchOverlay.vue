<script setup lang="ts">
import { computed } from "vue";
import { useRoleSwitchAnimationStore } from "@/stores/roleSwitchAnimation";
import { roleViewMeta } from "@/data/roleViews";

const store = useRoleSwitchAnimationStore();

const visible = computed(() => store.targetRole !== null);
const label = computed(() =>
  store.targetRole ? roleViewMeta(store.targetRole).label : "",
);
const icon = computed(() =>
  store.targetRole ? roleViewMeta(store.targetRole).icon : "",
);
</script>

<template>
  <Transition name="role-switch">
    <!-- The :key reset lets a rapid second switch restart the fade-in/scale
         from zero instead of jumping to the already-shown state. -->
    <div
      v-if="visible"
      :key="store.playId"
      class="role-switch-overlay"
      role="status"
      aria-live="polite"
    >
      <div class="role-switch-overlay__inner">
        <i :class="[icon, 'role-switch-overlay__icon']" aria-hidden="true"></i>
        <div class="role-switch-overlay__label">
          Switching to <span class="font-semibold">{{ label }}</span> view…
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.role-switch-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bs-blue);
  color: #fff;
  /* Stop clicks from leaking through to whatever is changing underneath. */
  pointer-events: auto;
}

.role-switch-overlay__inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.25rem;
  text-align: center;
  padding: 0 1.5rem;
  /* The whole stack scales in slightly so it lands with a little weight. */
  animation: role-switch-pop 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.2) both;
}

.role-switch-overlay__icon {
  font-size: 4rem;
  line-height: 1;
  /* Subtle pulse while held so it doesn't feel like a frozen splash. */
  animation: role-switch-pulse 1s ease-in-out infinite;
}

.role-switch-overlay__label {
  font-size: 1.125rem;
  letter-spacing: 0.01em;
  opacity: 0.95;
}

@keyframes role-switch-pop {
  0% {
    transform: scale(0.85);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes role-switch-pulse {
  0%, 100% {
    transform: scale(1);
    opacity: 0.95;
  }
  50% {
    transform: scale(1.06);
    opacity: 1;
  }
}

/* Fade in / out on the outer overlay. Total fade ≈ 200ms in, 400ms out — the
   middle ~600ms is the "held" phase. Sum stays under
   ROLE_SWITCH_ANIMATION_MS so the state clears AFTER the visible animation. */
.role-switch-enter-active {
  transition: opacity 0.2s ease-out;
}
.role-switch-leave-active {
  transition: opacity 0.4s ease-in;
}
.role-switch-enter-from,
.role-switch-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .role-switch-overlay__inner,
  .role-switch-overlay__icon {
    animation: none;
  }
  .role-switch-enter-active,
  .role-switch-leave-active {
    transition: none;
  }
}
</style>
