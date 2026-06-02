<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
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

// We rasterize the PDF to page images (pdf.js) and show those instead of an
// <iframe src="blob:…pdf">. Inline PDF-in-iframe is unreliable on mobile
// browsers (iOS Safari + many Android browsers render blank or force a
// download), so the previous preview was invisible on phones. Page images
// render identically everywhere. The Download / Open actions still hand over
// the real vector PDF.
const objectUrl = ref<string | null>(null);
const pageImages = ref<string[]>([]);
const rendering = ref(false);
const renderError = ref(false);
// Guards against an earlier (slower) render overwriting a newer blob's pages.
let renderSeq = 0;

function revoke() {
  if (objectUrl.value) {
    URL.revokeObjectURL(objectUrl.value);
    objectUrl.value = null;
  }
}

async function renderBlob(blob: Blob): Promise<void> {
  const seq = ++renderSeq;
  rendering.value = true;
  renderError.value = false;
  pageImages.value = [];
  try {
    // Lazy-load pdf.js (and its worker) only on first preview so it stays off
    // the main bundle.
    const pdfjs = await import("pdfjs-dist");
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

    const data = await blob.arrayBuffer();
    if (seq !== renderSeq) return;
    const doc = await pdfjs.getDocument({ data }).promise;

    // Crisp on retina without rasterizing absurdly large bitmaps.
    const scale = Math.min(2, (window.devicePixelRatio || 1) * 1.5);
    const imgs: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      if (seq !== renderSeq) return;
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      imgs.push(canvas.toDataURL("image/png"));
    }
    if (seq !== renderSeq) return;
    pageImages.value = imgs;
  } catch (e) {
    console.warn("[PdfPreview] render failed", e);
    if (seq === renderSeq) renderError.value = true;
  } finally {
    if (seq === renderSeq) rendering.value = false;
  }
}

watch(
  () => props.blob,
  (b) => {
    revoke();
    pageImages.value = [];
    renderError.value = false;
    if (b) {
      objectUrl.value = URL.createObjectURL(b);
      void renderBlob(b);
    }
  },
  { immediate: true },
);

watch(
  () => props.visible,
  (v) => {
    if (!v) {
      revoke();
      pageImages.value = [];
    }
  },
);

onBeforeUnmount(revoke);

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
      <div v-if="pageImages.length" class="pdf-pages">
        <img
          v-for="(src, i) in pageImages"
          :key="i"
          :src="src"
          class="pdf-page"
          :alt="`Page ${i + 1}`"
        />
      </div>
      <div v-else-if="renderError" class="pdf-loading">
        <i class="pi pi-file-pdf text-3xl text-[color:var(--bs-muted)]"></i>
        <p class="mt-2 px-6 text-center text-sm text-[color:var(--bs-muted)]">
          Couldn't show a preview here. Use <strong>Open</strong> or
          <strong>Download</strong> below to view the PDF.
        </p>
      </div>
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
          label="Open"
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

/* Scrollable stack of rasterized page images. */
.pdf-pages {
  flex: 1;
  min-height: 0;
  width: 100%;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
}
.pdf-page {
  width: 100%;
  max-width: 760px;
  height: auto;
  background: white;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
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
