<script setup lang="ts">
import { ref } from "vue";
import Button from "primevue/button";
import { useAppUpdate } from "@/composables/useAppUpdate";

// Visible surface for "a new build shipped". Mounted once, globally, in App.vue.
// All the detection lives in useAppUpdate(); this component is just the UI.
const { updateAvailable, updateRequired, applying, applyUpdate } = useAppUpdate();

// The non-critical banner is dismissable. Dismiss only hides THIS appearance —
// the next time a newer build is detected the poll re-sets `updateAvailable`,
// so we never permanently silence updates. Critical (updateRequired) ignores it.
const dismissed = ref(false);

function refresh() {
  void applyUpdate();
}
</script>

<template>
  <!-- Critical release → full-screen blocking overlay. They can't keep using a
       build with a known-dangerous bug; the only way forward is to update. -->
  <div
    v-if="updateRequired"
    class="bs-update-block"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="bs-update-block-title"
  >
    <div class="bs-update-block__card">
      <i class="pi pi-arrow-circle-up bs-update-block__icon" aria-hidden="true"></i>
      <h2 id="bs-update-block-title" class="bs-update-block__title">Update required</h2>
      <p class="bs-update-block__body">
        A newer version of Blue Seal is ready with an important fix. Update now to keep going — it
        only takes a second.
      </p>
      <Button
        label="Update now"
        icon="pi pi-refresh"
        class="w-full"
        :loading="applying"
        @click="refresh"
      />
    </div>
  </div>

  <!-- Normal release → dismissable bottom snackbar. -->
  <Transition name="bs-update-slide">
    <div
      v-if="updateAvailable && !updateRequired && !dismissed"
      class="bs-update-bar"
      role="status"
    >
      <i class="pi pi-arrow-circle-up bs-update-bar__icon" aria-hidden="true"></i>
      <span class="bs-update-bar__text">A new version of Blue Seal is available.</span>
      <Button label="Update" size="small" :loading="applying" @click="refresh" />
      <button
        type="button"
        class="bs-update-bar__close"
        aria-label="Dismiss"
        @click="dismissed = true"
      >
        <i class="pi pi-times" aria-hidden="true"></i>
      </button>
    </div>
  </Transition>
</template>

<style scoped>
/* Bottom snackbar — above the app's bottom nav (z-30) but below toasts/dialogs. */
.bs-update-bar {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: calc(env(safe-area-inset-bottom, 0px) + 1rem);
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: min(92vw, 30rem);
  padding: 0.625rem 0.75rem 0.625rem 0.875rem;
  background: var(--bs-blue-dark);
  color: #fff;
  border-radius: 0.75rem;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
}
.bs-update-bar__icon {
  flex: none;
  font-size: 1.125rem;
  color: var(--bs-blue-light);
}
.bs-update-bar__text {
  flex: 1 1 auto;
  font-size: 0.875rem;
  line-height: 1.25;
}
.bs-update-bar__close {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.75rem;
  height: 1.75rem;
  border: 0;
  border-radius: 9999px;
  background: transparent;
  color: rgba(255, 255, 255, 0.7);
  cursor: pointer;
}
.bs-update-bar__close:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.bs-update-slide-enter-active,
.bs-update-slide-leave-active {
  transition:
    transform 0.25s ease,
    opacity 0.25s ease;
}
.bs-update-slide-enter-from,
.bs-update-slide-leave-to {
  transform: translate(-50%, 1rem);
  opacity: 0;
}

/* Critical blocking overlay. */
.bs-update-block {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 1.5rem;
  background: color-mix(in srgb, var(--bs-blue-dark) 70%, rgba(0, 0, 0, 0.6));
  backdrop-filter: blur(2px);
}
.bs-update-block__card {
  width: min(92vw, 26rem);
  background: var(--bs-surface);
  border-radius: 1rem;
  padding: 1.75rem 1.5rem;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
}
.bs-update-block__icon {
  font-size: 2.5rem;
  color: var(--bs-blue);
}
.bs-update-block__title {
  margin: 0.75rem 0 0.5rem;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--bs-text);
}
.bs-update-block__body {
  margin: 0 0 1.25rem;
  font-size: 0.9375rem;
  line-height: 1.5;
  color: var(--bs-text-muted);
}

@media (prefers-reduced-motion: reduce) {
  .bs-update-slide-enter-active,
  .bs-update-slide-leave-active {
    transition: none;
  }
  .bs-update-block {
    backdrop-filter: none;
  }
}
</style>
