<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";

const props = defineProps<{
  visible: boolean;
  blob: Blob | null;
  filename: string;
  // Header label rendered in the modal — defaults to filename if empty.
  title?: string;
}>();

const emit = defineEmits<{
  "update:visible": [v: boolean];
}>();

// Object URL for the current Blob. Recreated whenever the blob prop
// changes, and revoked on close / unmount so we don't leak memory.
const objectUrl = ref<string | null>(null);

function revoke() {
  if (objectUrl.value) {
    URL.revokeObjectURL(objectUrl.value);
    objectUrl.value = null;
  }
}

watch(
  () => props.blob,
  (b) => {
    revoke();
    if (b) {
      objectUrl.value = URL.createObjectURL(b);
    }
  },
  { immediate: true },
);

watch(
  () => props.visible,
  (v) => {
    if (!v) revoke();
  },
);

onBeforeUnmount(revoke);

// Append `#toolbar=1&view=FitH` so the embedded PDF viewer shows its
// toolbar (download + print buttons) and fits the page width by
// default — Chrome / Edge / Firefox respect these PDF Open Params.
const iframeSrc = computed(() =>
  objectUrl.value ? `${objectUrl.value}#toolbar=1&view=FitH` : "",
);

function close() {
  emit("update:visible", false);
}

function download() {
  if (!objectUrl.value) return;
  const link = document.createElement("a");
  link.href = objectUrl.value;
  link.download = props.filename || "document.pdf";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function openInNewTab() {
  if (!objectUrl.value) return;
  window.open(objectUrl.value, "_blank", "noopener,noreferrer");
}
</script>

<template>
  <Dialog
    :visible="props.visible"
    modal
    :closable="true"
    :draggable="false"
    :show-header="true"
    :header="props.title || props.filename"
    :pt="{ root: { class: 'pdf-preview-dialog' } }"
    @update:visible="(v) => emit('update:visible', v)"
  >
    <div class="pdf-preview-body">
      <iframe
        v-if="objectUrl"
        :src="iframeSrc"
        class="pdf-iframe"
        title="PDF preview"
      ></iframe>
      <div v-else class="pdf-loading">
        <i class="pi pi-spin pi-spinner text-2xl text-[color:var(--bs-muted)]"></i>
        <p class="mt-2 text-sm text-[color:var(--bs-muted)]">Rendering PDF…</p>
      </div>
    </div>

    <template #footer>
      <div class="flex flex-wrap items-center gap-2 w-full">
        <Button label="Close" text @click="close" />
        <span class="flex-1"></span>
        <Button
          label="Open in new tab"
          icon="pi pi-external-link"
          outlined
          size="small"
          :disabled="!objectUrl"
          @click="openInNewTab"
        />
        <Button
          label="Download"
          icon="pi pi-download"
          severity="primary"
          :disabled="!objectUrl"
          @click="download"
        />
      </div>
    </template>
  </Dialog>
</template>

<style>
/* Full-screen on mobile, large modal on desktop. PrimeVue's default
   Dialog is too narrow for a readable PDF preview. */
.pdf-preview-dialog {
  width: 100vw;
  max-width: 960px;
  height: 90vh;
  margin: 0;
  display: flex;
  flex-direction: column;
}
.pdf-preview-dialog .p-dialog-content {
  flex: 1 1 auto;
  overflow: hidden;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.pdf-preview-dialog .p-dialog-footer {
  border-top: 1px solid var(--bs-border);
  background: white;
  padding: 0.6rem 1rem;
  padding-bottom: max(0.6rem, env(safe-area-inset-bottom));
  flex-shrink: 0;
}
@media (max-width: 639px) {
  .pdf-preview-dialog {
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
  }
}
</style>

<style scoped>
.pdf-preview-body {
  flex: 1;
  min-height: 0;
  display: flex;
  background: #525659; /* matches Chrome's built-in PDF viewer grey */
}

.pdf-iframe {
  flex: 1;
  width: 100%;
  height: 100%;
  border: 0;
  background: white;
}

.pdf-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: white;
}
</style>
