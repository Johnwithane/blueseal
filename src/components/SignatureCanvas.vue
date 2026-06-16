<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type SignaturePad from "signature_pad";

// Reusable finger/mouse signature pad. Owns the gnarly retina-scaling + resize
// logic in ONE place so every signing surface (quote acceptance, uninsured-work
// waiver) shares it. The parent reads emptiness via `update:empty` and pulls the
// drawn image with the exposed `extract()`. Pure capture — the parent owns the
// network call.

const emit = defineEmits<{
  "update:empty": [v: boolean];
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
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
  emit("update:empty", true);
}

async function init() {
  const canvas = canvasRef.value;
  if (!canvas || pad) return;
  // Lazy-load signature_pad on first mount so it stays off the main bundle.
  const { default: SignaturePadCtor } = await import("signature_pad");
  pad = new SignaturePadCtor(canvas, {
    penColor: "#0f172a",
    backgroundColor: "rgba(255,255,255,0)", // transparent → composites on white
  });
  pad.addEventListener("endStroke", () => {
    emit("update:empty", pad?.isEmpty() ?? true);
  });
  resizeCanvas();
  ro = new ResizeObserver(() => resizeCanvas());
  ro.observe(canvas);
}

onMounted(() => {
  void init();
});

onBeforeUnmount(() => {
  ro?.disconnect();
  ro = null;
  pad?.off();
  pad = null;
});

function clear() {
  pad?.clear();
  emit("update:empty", true);
}

function isEmpty(): boolean {
  return pad?.isEmpty() ?? true;
}

/**
 * Export the drawing as a data URL, preferring WebP for size and falling back
 * to PNG. iOS Safari < 16.4 silently ignores the `image/webp` hint and returns
 * a PNG-typed data URL — we detect that by inspecting the returned prefix and
 * accept whatever the browser actually produced, so a signature is always
 * captured. Returns "" if the pad is empty.
 */
function extract(): string {
  if (!pad || pad.isEmpty()) return "";
  const webp = pad.toDataURL("image/webp");
  return webp.startsWith("data:image/webp") ? webp : pad.toDataURL("image/png");
}

defineExpose({ clear, isEmpty, extract });
</script>

<template>
  <div class="sign-frame">
    <canvas ref="canvasRef" class="sign-canvas"></canvas>
    <div class="sign-baseline"><span class="mr-1">✕</span>Sign above the line</div>
  </div>
</template>

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
