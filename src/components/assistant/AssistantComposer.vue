<script setup lang="ts">
import { nextTick, ref, useTemplateRef, watch } from "vue";
import Button from "primevue/button";
import Textarea from "primevue/textarea";
import { useAssistantStore } from "@/stores/assistant";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const store = useAssistantStore();
const toast = useToast();

const text = ref("");
const textareaRef = useTemplateRef<InstanceType<typeof Textarea>>("textareaEl");

// Quick-prompt chips set store.draft + bump draftTick — watching the tick
// (not draft) lets the same chip refill the textarea on a repeat click.
watch(
  () => store.draftTick,
  () => {
    text.value = store.draft;
    void nextTick(() => {
      const el = (textareaRef.value as unknown as { $el?: HTMLTextAreaElement } | null)?.$el;
      el?.focus();
      // Move caret to end so the user can keep typing without selecting all.
      if (el) el.setSelectionRange(el.value.length, el.value.length);
    });
  },
);

async function submit() {
  const value = text.value.trim();
  if (!value || store.sending) return;
  // Clear immediately so the textarea feels snappy. If the call fails we
  // restore the text so the user doesn't lose what they typed.
  text.value = "";
  try {
    await store.send(value);
  } catch (err) {
    text.value = value;
    toast.error("Couldn't reach the assistant", humanizeError(err));
  }
}

function onKeydown(e: KeyboardEvent) {
  // Enter submits; Shift+Enter inserts a newline (matches the rest of the
  // app's chat composers).
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void submit();
  }
}
</script>

<template>
  <form class="bs-assistant-composer" @submit.prevent="submit">
    <Textarea
      ref="textareaEl"
      v-model="text"
      rows="1"
      auto-resize
      maxlength="4000"
      placeholder="Ask the assistant…"
      class="flex-1"
      :disabled="store.sending"
      @keydown="onKeydown"
    />
    <Button
      icon="pi pi-send"
      type="submit"
      :loading="store.sending"
      :disabled="!text.trim() || store.sending"
      aria-label="Send"
    />
  </form>
</template>

<style scoped>
.bs-assistant-composer {
  border-top: 1px solid var(--bs-border);
  padding: 0.7rem 0.85rem 0.85rem;
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  background: white;
}
/* Soften the textarea border so the composer reads as a single surface
   with the panel rather than two competing rectangles. */
.bs-assistant-composer :deep(.p-textarea) {
  font-size: 0.9rem;
  border-radius: 0.75rem;
  border-color: var(--bs-border);
}
.bs-assistant-composer :deep(.p-textarea:focus) {
  border-color: var(--bs-blue);
  box-shadow: 0 0 0 3px rgba(73, 161, 211, 0.18);
}
.bs-assistant-composer :deep(.p-button) {
  border-radius: 9999px;
  width: 2.4rem;
  height: 2.4rem;
  background: linear-gradient(135deg, #59b0e0 0%, #3a8cc0 100%);
  border: none;
  color: white;
}
.bs-assistant-composer :deep(.p-button:hover) {
  filter: brightness(1.05);
}
.bs-assistant-composer :deep(.p-button:disabled) {
  opacity: 0.5;
  background: var(--bs-muted);
}
</style>
