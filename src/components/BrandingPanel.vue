<script setup lang="ts">
// Invoice & quote branding (Blue Seal Pro): company logo, a wide letterhead
// banner, and a brand colour for the header band — applied to the generated
// PDFs and the on-screen versions clients see. The whole panel is Pro-gated
// (the rendering is gated server-side in getInvoicePartyInfo too, so this is
// the UI half). Self-contained: loads its own branding + saves via
// createOrUpdateDraft. Rendered in AccountView's tradesperson tab.
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import { storeToRefs } from "pinia";
import { useAuthStore } from "@/stores/auth";
import { useSubscriptionStore } from "@/stores/subscription";
import { createOrUpdateDraft, getTradesperson } from "@/firebase/services/tradespeople";
import { uploadFile, makeStoragePath } from "@/firebase/services/storage";
import { compressToWebp } from "@/utils/image";
import { tradeLabel } from "@/data/trades";
import { isUnsplashEnabled } from "@/api/unsplash";
import UnsplashPickerDialog from "@/components/UnsplashPickerDialog.vue";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const DEFAULT_COLOR = "#2A3A5C"; // Blue Seal navy

const auth = useAuthStore();
const { isPro, loaded: subLoaded } = storeToRefs(useSubscriptionStore());
const toast = useToast();

const isAdmin = computed(() => (auth.roles ?? []).includes("admin"));
const gated = computed(() => subLoaded.value && !isPro.value && !isAdmin.value);

const loading = ref(true);
const companyLogoUrl = ref<string | null>(null);
const bannerUrl = ref<string | null>(null);
const brandColor = ref<string>(DEFAULT_COLOR);
const hasBrandColor = ref(false);

const uploadingLogo = ref(false);
const removingLogo = ref(false);
const uploadingBanner = ref(false);
const removingBanner = ref(false);
const savingColor = ref(false);
const logoInput = ref<HTMLInputElement | null>(null);
const bannerInput = ref<HTMLInputElement | null>(null);
const showBannerUnsplash = ref(false);
const unsplashEnabled = isUnsplashEnabled();
const tradeQuery = ref("");

async function load() {
  if (!auth.fbUser) {
    loading.value = false;
    return;
  }
  try {
    const t = await getTradesperson(auth.fbUser.uid);
    companyLogoUrl.value = t?.companyLogoUrl ?? null;
    bannerUrl.value = t?.bannerUrl ?? null;
    tradeQuery.value = t?.trades?.[0] ? tradeLabel(t.trades[0]) : "";
    if (t?.brandColor) {
      brandColor.value = t.brandColor;
      hasBrandColor.value = true;
    }
  } catch (e) {
    toast.error(humanizeError(e));
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function uploadImage(file: File, bucket: "logo" | "banner", maxDim: number): Promise<string> {
  const compressed = await compressToWebp(file, { maxDimension: maxDim, quality: 0.92 });
  const path = makeStoragePath({
    scope: "tradespeople",
    id: auth.fbUser!.uid,
    bucket,
    filename: compressed.name,
  });
  return uploadFile(path, compressed);
}

async function onLogoChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file || !auth.fbUser) return;
  uploadingLogo.value = true;
  try {
    const url = await uploadImage(file, "logo", 1024);
    await createOrUpdateDraft(auth.fbUser.uid, { companyLogoUrl: url });
    companyLogoUrl.value = url;
    toast.success("Logo updated");
  } catch (err) {
    toast.error(humanizeError(err));
  } finally {
    uploadingLogo.value = false;
    input.value = "";
  }
}
async function removeLogo() {
  if (!auth.fbUser) return;
  removingLogo.value = true;
  try {
    await createOrUpdateDraft(auth.fbUser.uid, { companyLogoUrl: null });
    companyLogoUrl.value = null;
    toast.success("Logo removed");
  } catch (err) {
    toast.error(humanizeError(err));
  } finally {
    removingLogo.value = false;
  }
}
// Shared banner pipeline for an uploaded File and an Unsplash pick alike.
async function applyBanner(file: File) {
  if (!auth.fbUser) return;
  uploadingBanner.value = true;
  try {
    const url = await uploadImage(file, "banner", 1600);
    await createOrUpdateDraft(auth.fbUser.uid, { bannerUrl: url });
    bannerUrl.value = url;
    toast.success("Banner updated");
  } catch (err) {
    toast.error(humanizeError(err));
  } finally {
    uploadingBanner.value = false;
  }
}
async function onBannerChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  await applyBanner(file);
  input.value = "";
}
async function removeBanner() {
  if (!auth.fbUser) return;
  removingBanner.value = true;
  try {
    await createOrUpdateDraft(auth.fbUser.uid, { bannerUrl: null });
    bannerUrl.value = null;
    toast.success("Banner removed");
  } catch (err) {
    toast.error(humanizeError(err));
  } finally {
    removingBanner.value = false;
  }
}
async function saveColor() {
  if (!auth.fbUser) return;
  savingColor.value = true;
  try {
    await createOrUpdateDraft(auth.fbUser.uid, { brandColor: brandColor.value });
    hasBrandColor.value = true;
    toast.success("Brand colour saved");
  } catch (err) {
    toast.error(humanizeError(err));
  } finally {
    savingColor.value = false;
  }
}
async function resetColor() {
  if (!auth.fbUser) return;
  savingColor.value = true;
  try {
    await createOrUpdateDraft(auth.fbUser.uid, { brandColor: null });
    brandColor.value = DEFAULT_COLOR;
    hasBrandColor.value = false;
    toast.success("Brand colour reset");
  } catch (err) {
    toast.error(humanizeError(err));
  } finally {
    savingColor.value = false;
  }
}
</script>

<template>
  <div class="rounded-lg border border-[color:var(--bs-border)] bg-[color:var(--bs-surface-alt,#f9fafb)] p-3">
    <div class="flex items-center gap-2 mb-1">
      <i class="pi pi-palette text-[color:var(--bs-blue)]"></i>
      <h4 class="text-sm font-semibold m-0">Invoice &amp; quote branding</h4>
      <span class="text-[10px] font-semibold uppercase rounded-full bg-[color:var(--bs-blue)] text-white px-2 py-0.5">Pro</span>
    </div>
    <p class="text-xs text-[color:var(--bs-muted)] mb-3">
      Your logo, a banner, and a brand colour — on your public profile, and on the header of
      every quote and invoice (PDF and on screen).
    </p>

    <div v-if="loading" class="text-sm text-[color:var(--bs-muted)]">
      <i class="pi pi-spin pi-spinner mr-1"></i> Loading…
    </div>

    <!-- Pro gate -->
    <div v-else-if="gated" class="text-center py-3">
      <i class="pi pi-lock text-2xl text-[color:var(--bs-blue)]"></i>
      <p class="mt-2 text-sm text-[color:var(--bs-muted)] max-w-xs mx-auto">
        Make your quotes and invoices unmistakably yours. Branding is part of Blue Seal Pro.
      </p>
      <RouterLink to="/pricing" class="inline-block mt-3">
        <Button label="Start 30-day free trial" icon="pi pi-star" size="small" />
      </RouterLink>
    </div>

    <div v-else class="space-y-4">
      <!-- Logo -->
      <div>
        <label class="block text-xs font-medium mb-1">Logo</label>
        <div class="flex items-center gap-3">
          <img
            v-if="companyLogoUrl"
            :src="companyLogoUrl"
            alt="Company logo"
            class="h-14 w-14 rounded border border-[color:var(--bs-border)] bg-white object-contain"
          />
          <div
            v-else
            class="h-14 w-14 rounded border border-dashed border-[color:var(--bs-border)] flex items-center justify-center text-[color:var(--bs-muted)] bg-white"
          >
            <i class="pi pi-image" aria-hidden="true"></i>
          </div>
          <div class="flex flex-col gap-1.5">
            <Button
              :label="companyLogoUrl ? 'Replace' : 'Upload logo'"
              icon="pi pi-upload"
              outlined
              size="small"
              :loading="uploadingLogo"
              @click="logoInput?.click()"
            />
            <Button
              v-if="companyLogoUrl"
              label="Remove"
              icon="pi pi-times"
              severity="danger"
              text
              size="small"
              :loading="removingLogo"
              @click="removeLogo"
            />
          </div>
          <input ref="logoInput" type="file" accept="image/*" class="hidden" @change="onLogoChange" />
        </div>
        <p class="text-[11px] text-[color:var(--bs-muted)] mt-1">Square works best.</p>
      </div>

      <!-- Banner -->
      <div>
        <label class="block text-xs font-medium mb-1">Letterhead banner</label>
        <img
          v-if="bannerUrl"
          :src="bannerUrl"
          alt="Banner"
          class="w-full h-16 rounded border border-[color:var(--bs-border)] bg-white object-cover mb-2"
        />
        <div v-else class="w-full h-16 rounded border border-dashed border-[color:var(--bs-border)] flex items-center justify-center text-[color:var(--bs-muted)] bg-white mb-2 text-xs">
          No banner — a wide image (e.g. 1600×400)
        </div>
        <div class="flex gap-2 flex-wrap">
          <Button
            :label="bannerUrl ? 'Replace' : 'Upload banner'"
            icon="pi pi-upload"
            outlined
            size="small"
            :loading="uploadingBanner"
            @click="bannerInput?.click()"
          />
          <Button
            v-if="unsplashEnabled"
            label="Unsplash"
            icon="pi pi-images"
            outlined
            severity="secondary"
            size="small"
            :disabled="uploadingBanner"
            @click="showBannerUnsplash = true"
          />
          <Button
            v-if="bannerUrl"
            label="Remove"
            icon="pi pi-times"
            severity="danger"
            text
            size="small"
            :loading="removingBanner"
            @click="removeBanner"
          />
          <input ref="bannerInput" type="file" accept="image/*" class="hidden" @change="onBannerChange" />
        </div>
        <UnsplashPickerDialog
          v-if="unsplashEnabled"
          v-model:visible="showBannerUnsplash"
          :default-query="tradeQuery"
          title="Choose a banner from Unsplash"
          @picked="applyBanner"
        />
      </div>

      <!-- Brand colour -->
      <div>
        <label class="block text-xs font-medium mb-1">Brand colour</label>
        <div class="flex items-center gap-3 flex-wrap">
          <input
            v-model="brandColor"
            type="color"
            class="h-9 w-12 rounded border border-[color:var(--bs-border)] bg-white p-0.5 cursor-pointer"
            aria-label="Brand colour"
          />
          <span class="text-sm tabular-nums">{{ brandColor.toUpperCase() }}</span>
          <Button label="Save colour" icon="pi pi-check" size="small" :loading="savingColor" @click="saveColor" />
          <Button
            v-if="hasBrandColor"
            label="Reset"
            text
            size="small"
            severity="secondary"
            :loading="savingColor"
            @click="resetColor"
          />
        </div>
        <p class="text-[11px] text-[color:var(--bs-muted)] mt-1">
          Drives the header band; text stays readable automatically.
        </p>
      </div>
    </div>
  </div>
</template>
