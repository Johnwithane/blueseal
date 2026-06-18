<script setup lang="ts">
// Reusable Blue Seal business-card preview + exporter. Renders both faces
// (front = message/profile + QR, back = vertical logo on the site gradient) and
// owns the PNG / print-PDF downloads, so it can drop into either the admin
// generator or (later) a tradesperson's own profile page unchanged — the parent
// supplies a resolved CardContent, the QR target URL, and (for profile cards)
// the photo URL.
import { onMounted, ref, watch } from "vue";
import Button from "primevue/button";
import {
  CARD_ASSETS,
  CARD_TRIM,
  brandmarkUrlForTheme,
  cardPixelSize,
  drawCardFace,
  downloadCanvasPng,
  downloadCardPdf,
  ensureCardFonts,
  generateQrCanvas,
  loadImage,
  logoUrlForTheme,
  qrDarkForTheme,
  type CardAssets,
  type CardContent,
  type CardFace,
} from "@/utils/businessCard";

const props = defineProps<{
  content: CardContent;
  targetUrl: string;
  includeBrandmark: boolean;
  fileBaseName: string;
  photoUrl?: string | null;
}>();

const frontCanvas = ref<HTMLCanvasElement | null>(null);
const backCanvas = ref<HTMLCanvasElement | null>(null);
const error = ref<string | null>(null);
const photoBlocked = ref(false);
const busy = ref(false);

const imageCache = new Map<string, HTMLImageElement>();
let qrCache: { key: string; canvas: HTMLCanvasElement } | null = null;
let photoCache: { url: string; img: HTMLImageElement } | null = null;
const photoFailed = new Set<string>();

async function getImage(url: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(url);
  if (cached) return cached;
  const img = await loadImage(url);
  imageCache.set(url, img);
  return img;
}

async function getQr(url: string, dark: string): Promise<HTMLCanvasElement> {
  const key = `${url}|${dark}`;
  if (qrCache?.key === key) return qrCache.canvas;
  const canvas = await generateQrCanvas(url, { dark });
  qrCache = { key, canvas };
  return canvas;
}

/**
 * Remote profile photos taint the canvas unless the host sends CORS headers.
 * We load with crossOrigin set; if that fails the card falls back to an
 * initials avatar (and we flag it) so export never breaks. See
 * docs/BUSINESS_CARD_PRINT.md / HUMANTASKS (Storage CORS).
 */
async function getPhoto(): Promise<HTMLImageElement | null> {
  const url = props.photoUrl?.trim();
  if (!url || photoFailed.has(url)) return null;
  if (photoCache?.url === url) return photoCache.img;
  try {
    const img = await loadImage(url);
    photoCache = { url, img };
    return img;
  } catch {
    photoFailed.add(url);
    photoBlocked.value = true;
    return null;
  }
}

async function resolveAssets(): Promise<CardAssets> {
  await ensureCardFonts();
  const theme = props.content.theme;
  const [logo, logoVert, qr, brandmark, markWhite, photo] = await Promise.all([
    getImage(logoUrlForTheme(theme)),
    getImage(CARD_ASSETS.logoVertFull),
    getQr(props.targetUrl, qrDarkForTheme(theme)),
    props.includeBrandmark ? getImage(brandmarkUrlForTheme(theme)) : Promise.resolve(null),
    getImage(CARD_ASSETS.brandmarkWhite), // back chip (always navy)
    getPhoto(),
  ]);
  return { logo, logoVert, qr, brandmark, markWhite, photo };
}

async function renderTo(
  canvas: HTMLCanvasElement,
  face: CardFace,
  bleed: boolean,
  assets: CardAssets,
): Promise<void> {
  const size = cardPixelSize(bleed);
  canvas.width = size.w;
  canvas.height = size.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  drawCardFace(ctx, props.content, assets, face, bleed);
}

async function renderPreview(): Promise<void> {
  if (!frontCanvas.value || !backCanvas.value) return;
  error.value = null;
  photoBlocked.value = false;
  try {
    const assets = await resolveAssets();
    await renderTo(frontCanvas.value, "front", false, assets);
    await renderTo(backCanvas.value, "back", false, assets);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Could not render the card.";
  }
}

async function offscreen(face: CardFace, assets: CardAssets): Promise<HTMLCanvasElement> {
  const c = document.createElement("canvas");
  await renderTo(c, face, true, assets);
  return c;
}

async function downloadPdf(): Promise<void> {
  busy.value = true;
  try {
    const assets = await resolveAssets();
    const front = await offscreen("front", assets);
    const back = await offscreen("back", assets);
    await downloadCardPdf([front, back], `${props.fileBaseName}.pdf`);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Could not export the PDF.";
  } finally {
    busy.value = false;
  }
}

async function downloadPng(face: CardFace): Promise<void> {
  busy.value = true;
  try {
    const assets = await resolveAssets();
    const c = document.createElement("canvas");
    await renderTo(c, face, false, assets);
    downloadCanvasPng(c, `${props.fileBaseName}-${face}.png`);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "Could not export the PNG.";
  } finally {
    busy.value = false;
  }
}

onMounted(renderPreview);
watch(
  () => [props.content, props.targetUrl, props.includeBrandmark, props.photoUrl],
  renderPreview,
  { deep: true },
);
</script>

<template>
  <div class="space-y-4">
    <div class="space-y-3">
      <div>
        <p class="mb-1 text-xs font-semibold text-[color:var(--bs-muted)]">Front</p>
        <div
          class="mx-auto w-full max-w-[460px] rounded-[var(--bs-radius-lg)] overflow-hidden border border-[color:var(--bs-border)] shadow-[var(--bs-shadow-md)]"
          :style="{ aspectRatio: `${CARD_TRIM.w} / ${CARD_TRIM.h}` }"
        >
          <canvas ref="frontCanvas" class="block w-full h-full" />
        </div>
      </div>
      <div>
        <p class="mb-1 text-xs font-semibold text-[color:var(--bs-muted)]">Back</p>
        <div
          class="mx-auto w-full max-w-[460px] rounded-[var(--bs-radius-lg)] overflow-hidden border border-[color:var(--bs-border)] shadow-[var(--bs-shadow-md)]"
          :style="{ aspectRatio: `${CARD_TRIM.w} / ${CARD_TRIM.h}` }"
        >
          <canvas ref="backCanvas" class="block w-full h-full" />
        </div>
      </div>
    </div>

    <p v-if="error" class="text-center text-sm text-[color:var(--bs-danger)]">
      {{ error }}
    </p>
    <p v-else-if="photoBlocked" class="text-center text-xs text-[color:var(--bs-warning)]">
      Couldn't load the profile photo (cross-origin) — showing initials instead.
      See Storage CORS in HUMANTASKS.md.
    </p>

    <div class="flex flex-wrap justify-center gap-2">
      <Button
        label="Print-ready PDF (2-sided)"
        icon="pi pi-file-pdf"
        :loading="busy"
        @click="downloadPdf"
      />
      <Button label="Front PNG" icon="pi pi-image" outlined :loading="busy" @click="downloadPng('front')" />
      <Button label="Back PNG" icon="pi pi-image" outlined :loading="busy" @click="downloadPng('back')" />
    </div>

    <p class="text-center text-xs text-[color:var(--bs-muted)] break-all">
      QR opens: {{ targetUrl }}
    </p>
  </div>
</template>
