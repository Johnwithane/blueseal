<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import { useFormatters } from "@/composables/useFormatters";
import type SignaturePad from "signature_pad";

// Reusable, jobId-agnostic signature capture. Pure capture — the parent owns
// the network call and drives the Confirm button's loading via `busy`. Used by
// both accept paths (direct-request banner + job-board accept). The client
// draws with a finger/mouse; on confirm we emit a PNG data URL that the server
// decodes + stores as the immutable record of agreement.
const props = defineProps<{
  visible: boolean;
  quoteTotal?: number; // cents — echoed for context
  upfrontFeeCents?: number; // cents — echoed if > 0
  busy?: boolean; // parent-owned loading while the accept callable runs
}>();

const emit = defineEmits<{
  "update:visible": [v: boolean];
  confirm: [dataUrl: string];
}>();

const { money } = useFormatters();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const isEmpty = ref(true);
let pad: SignaturePad | null = null;
let ro: ResizeObserver | null = null;

// Scale the canvas backing store to the device pixel ratio — without this the
// signature is blurry and the pointer coordinates are offset on retina/most
// phones. Resizing the backing store wipes the drawing, so we only call this on
// real size/orientation changes and re-arm the empty state afterward.
function resizeCanvas() {
  const canvas = canvasRef.value;
  if (!canvas || !pad) return;
  const ratio = Math.max(window.devicePixelRatio || 1, 1);
  canvas.width = canvas.offsetWidth * ratio;
  canvas.height = canvas.offsetHeight * ratio;
  canvas.getContext("2d")?.scale(ratio, ratio);
  pad.clear(); // backing-store resize clears the bitmap; re-sync state
  isEmpty.value = true;
}

async function init() {
  const canvas = canvasRef.value;
  if (!canvas || pad) return;
  // Lazy-load signature_pad on first open so it stays off the main bundle.
  const { default: SignaturePadCtor } = await import("signature_pad");
  pad = new SignaturePadCtor(canvas, {
    penColor: "#0f172a",
    backgroundColor: "rgba(255,255,255,0)", // transparent → composites on white
  });
  pad.addEventListener("endStroke", () => {
    isEmpty.value = pad?.isEmpty() ?? true;
  });
  resizeCanvas();
  ro = new ResizeObserver(() => resizeCanvas());
  ro.observe(canvas);
}

// The canvas has zero layout size until the Dialog is actually mounted+visible,
// so init/fit must wait for the show — never at bare onMounted.
watch(
  () => props.visible,
  async (v) => {
    if (!v) return;
    await nextTick();
    if (!pad) await init();
    else resizeCanvas();
  },
);

function clear() {
  pad?.clear();
  isEmpty.value = true;
}

function onConfirm() {
  if (!pad || pad.isEmpty() || props.busy) return;
  emit("confirm", pad.toDataURL("image/png"));
}

onBeforeUnmount(() => {
  ro?.disconnect();
  ro = null;
  pad?.off();
  pad = null;
});
</script>

<template>
  <Dialog
    :visible="props.visible"
    modal
    :draggable="false"
    :closable="!props.busy"
    header="Sign to accept"
    :pt="{ root: { class: 'sign-dialog' } }"
    @update:visible="(v) => emit('update:visible', v)"
  >
    <p class="text-sm text-[color:var(--bs-text)]">
      By signing you accept this quote<template v-if="props.quoteTotal">
        of <span class="font-semibold">{{ money(props.quoteTotal) }}</span></template
      >.
    </p>
    <div
      v-if="props.upfrontFeeCents && props.upfrontFeeCents > 0"
      class="mt-2 rounded-md border border-[color:var(--bs-warning)] bg-[color:var(--bs-warning-tint)] px-3 py-2 text-xs text-[color:var(--bs-warning-text)]"
    >
      <i class="pi pi-wallet text-[color:var(--bs-warning-text)] mr-1"></i>
      A <span class="font-semibold">{{ money(props.upfrontFeeCents) }}</span> upfront amount is due
      before work begins.
    </div>

    <div class="sign-frame mt-3">
      <canvas ref="canvasRef" class="sign-canvas"></canvas>
      <div class="sign-baseline"><span class="mr-1">✕</span>Sign above the line</div>
    </div>

    <template #footer>
      <div class="flex items-center gap-2 w-full">
        <Button
          label="Clear"
          text
          icon="pi pi-eraser"
          :disabled="isEmpty || props.busy"
          @click="clear"
        />
        <span class="flex-1"></span>
        <Button label="Cancel" text :disabled="props.busy" @click="emit('update:visible', false)" />
        <Button
          label="Confirm & accept"
          icon="pi pi-check"
          severity="success"
          :loading="props.busy"
          :disabled="isEmpty || props.busy"
          @click="onConfirm"
        />
      </div>
    </template>
  </Dialog>
</template>

<style>
/* Compact sheet on desktop, full-height on mobile for a large touch target —
   mirrors the PdfPreviewDialog pattern. */
.sign-dialog {
  width: 100vw;
  max-width: 420px;
  margin: 0;
}
.sign-dialog .p-dialog-footer {
  padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
}
@media (max-width: 639px) {
  .sign-dialog {
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
  }
}
</style>

<style scoped>
.sign-frame {
  position: relative;
  border: 1px solid var(--bs-border);
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
}
.sign-canvas {
  display: block;
  width: 100%;
  height: 220px;
  /* The single most important line for mobile: stop a finger drag from
     scrolling the page instead of drawing. */
  touch-action: none;
}
.sign-baseline {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0.75rem;
  text-align: center;
  font-size: 0.7rem;
  color: var(--bs-muted);
  pointer-events: none; /* never eat strokes */
}
</style>
