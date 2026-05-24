<script setup lang="ts">
import Button from "primevue/button";
import Textarea from "primevue/textarea";

defineProps<{
  updatingLog: boolean;
}>();

const privateNotes = defineModel<string>("privateNotes", { required: true });

const emit = defineEmits<{
  "save-notes": [];
  "update-log": [];
}>();
</script>

<template>
  <div class="bs-card p-3">
    <label for="job-private-notes" class="block font-semibold text-sm mb-2">
      Private notes
      <span class="font-normal text-[color:var(--bs-muted)]">(tradesperson only)</span>
    </label>

    <button
      type="button"
      class="ai-update-log w-full flex items-center gap-3 rounded-lg p-3 mb-3 text-left transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      :disabled="updatingLog"
      :title="updatingLog ? 'Summarising…' : 'Have AI summarise recent client messages into a new log entry'"
      @click="emit('update-log')"
    >
      <span class="ai-update-log__icon shrink-0">
        <i :class="updatingLog ? 'pi pi-spin pi-spinner' : 'pi pi-sparkles'"></i>
      </span>
      <span class="min-w-0 flex-1">
        <span class="block font-semibold text-sm">
          {{ updatingLog ? "Summarising…" : "Update log with AI" }}
        </span>
        <span class="block text-xs opacity-80 leading-snug mt-0.5">
          Pull a fresh summary of new client chat into your notes.
        </span>
      </span>
      <i v-if="!updatingLog" class="pi pi-arrow-right text-sm opacity-60"></i>
    </button>

    <Textarea id="job-private-notes" v-model="privateNotes" rows="8" class="w-full" />
    <Button
      label="Save notes"
      icon="pi pi-save"
      outlined
      size="small"
      class="mt-2"
      @click="emit('save-notes')"
    />
  </div>
</template>

<style scoped>
.ai-update-log {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.08), rgba(99, 102, 241, 0.12));
  border: 1px solid rgba(139, 92, 246, 0.35);
  color: #4c1d95;
}
.ai-update-log:hover:not(:disabled) {
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.14), rgba(99, 102, 241, 0.18));
  border-color: rgba(139, 92, 246, 0.55);
}
.ai-update-log__icon {
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 0.5rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #8b5cf6, #6366f1);
  color: white;
  font-size: 1.1rem;
}
</style>
