<script setup lang="ts">
// Slide-in overlay that hosts one applicant's Q&A thread for the client. Mirrors
// JobChatOverlay's chrome (slide-in-right ≥640px, slide-up on mobile, body-scroll
// lock, safe-area insets). One applicant at a time — reinforces bid-blindness.
import { watch } from "vue";
import Button from "primevue/button";
import ApplicationThread from "./ApplicationThread.vue";

const props = defineProps<{
  postId: string;
  applicationId: string | null;
  counterpartyName: string;
  role: "client" | "tradesperson";
}>();

const visible = defineModel<boolean>("visible", { required: true });

function close() {
  visible.value = false;
}

// Lock body scroll while open so the thread owns the viewport.
watch(visible, (v) => {
  if (typeof document === "undefined") return;
  document.body.style.overflow = v ? "hidden" : "";
});
</script>

<template>
  <Teleport to="body">
    <Transition name="athread-overlay">
      <div
        v-if="visible && props.applicationId"
        class="athread-overlay"
        role="dialog"
        aria-modal="true"
        :aria-label="`Conversation with ${props.counterpartyName}`"
      >
        <div class="backdrop" @click="close" />
        <aside class="panel">
          <header class="panel-header">
            <div class="title-row">
              <div class="min-w-0">
                <h2 class="title">{{ props.counterpartyName }}</h2>
                <div class="subtitle">About this quote</div>
              </div>
              <Button
                icon="pi pi-times"
                text
                rounded
                severity="secondary"
                aria-label="Close"
                @click="close"
              />
            </div>
          </header>
          <div class="panel-body">
            <ApplicationThread
              :post-id="props.postId"
              :application-id="props.applicationId"
              :role="props.role"
            />
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.athread-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 100dvh;
  z-index: 60;
  display: flex;
  justify-content: flex-end;
}
.backdrop {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
}
.panel {
  position: relative;
  display: flex;
  flex-direction: column;
  background: white;
  width: 100%;
  max-width: 100%;
  height: 100%;
  box-shadow: -12px 0 32px rgba(15, 23, 42, 0.18);
}
@media (min-width: 640px) {
  .panel {
    max-width: 420px;
  }
}
.panel-header {
  border-bottom: 1px solid var(--bs-border);
  background: white;
  padding-top: env(safe-area-inset-top);
}
.title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.75rem 0.75rem 0.75rem 1rem;
}
.title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--bs-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.subtitle {
  font-size: 0.75rem;
  color: var(--bs-muted);
}
.panel-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: white;
  overflow: hidden;
}

.athread-overlay-enter-active,
.athread-overlay-leave-active {
  transition: opacity 180ms ease;
}
.athread-overlay-enter-active .panel,
.athread-overlay-leave-active .panel {
  transition: transform 220ms ease;
}
.athread-overlay-enter-from,
.athread-overlay-leave-to {
  opacity: 0;
}
.athread-overlay-enter-from .panel,
.athread-overlay-leave-to .panel {
  transform: translateX(100%);
}
@media (max-width: 639px) {
  .athread-overlay-enter-from .panel,
  .athread-overlay-leave-to .panel {
    transform: translateY(100%);
  }
}
</style>
