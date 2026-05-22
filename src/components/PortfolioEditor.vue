<script setup lang="ts">
import { onMounted, ref } from "vue";
import Button from "primevue/button";
import Message from "primevue/message";
import { getTradesperson, setPortfolioPhotos, PORTFOLIO_MAX } from "@/firebase/services/tradespeople";
import { deleteFile, makeStoragePath, uploadFile } from "@/firebase/services/storage";
import { compressToWebp } from "@/utils/image";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{
  tradieUid: string;
}>();

const toast = useToast();

const photos = ref<string[]>([]);
const loading = ref(true);
const uploading = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

onMounted(async () => {
  await load();
});

async function load() {
  loading.value = true;
  const tradie = await getTradesperson(props.tradieUid);
  photos.value = tradie?.portfolioPhotos ?? [];
  loading.value = false;
}

async function onFile(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  if (photos.value.length >= PORTFOLIO_MAX) {
    toast.warn("Max reached", `You can show up to ${PORTFOLIO_MAX} photos.`);
    target.value = "";
    return;
  }
  uploading.value = true;
  try {
    // Portfolio photos render in a 4-col grid at ~256px; 1280 is plenty
    // for retina and the WebP compression keeps payload small.
    const compressed = await compressToWebp(file, { maxDimension: 1280, quality: 0.85 });
    const path = makeStoragePath({
      scope: "tradespeople",
      id: props.tradieUid,
      bucket: "portfolio",
      filename: compressed.name,
    });
    const url = await uploadFile(path, compressed);
    const next = [...photos.value, url];
    await setPortfolioPhotos(props.tradieUid, next);
    photos.value = next;
  } catch (err) {
    toast.error("Upload failed", humanizeError(err));
  } finally {
    uploading.value = false;
    target.value = "";
  }
}

async function removeAt(idx: number) {
  const removed = photos.value[idx];
  const next = photos.value.filter((_, i) => i !== idx);
  try {
    // Persist the new list first so the public profile updates even if
    // the storage delete fails (orphaned file is the lesser evil vs
    // showing a broken thumbnail).
    await setPortfolioPhotos(props.tradieUid, next);
    photos.value = next;
    // Best-effort: clean up the underlying file. Firebase's `ref()`
    // accepts both gs:// paths and https download URLs, so passing the
    // stored URL works without parsing.
    try {
      await deleteFile(removed);
    } catch {
      /* orphan; non-fatal */
    }
  } catch (err) {
    toast.error("Couldn't remove", humanizeError(err));
  }
}

async function move(idx: number, delta: -1 | 1) {
  const next = [...photos.value];
  const target = idx + delta;
  if (target < 0 || target >= next.length) return;
  [next[idx], next[target]] = [next[target], next[idx]];
  try {
    await setPortfolioPhotos(props.tradieUid, next);
    photos.value = next;
  } catch (err) {
    toast.error("Couldn't reorder", humanizeError(err));
  }
}
</script>

<template>
  <div class="bs-card p-5">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">Portfolio</h2>
        <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
          Up to {{ PORTFOLIO_MAX }} photos of your past work. First photo shows
          biggest on your profile.
        </p>
      </div>
      <Button
        icon="pi pi-upload"
        label="Add photo"
        :loading="uploading"
        :disabled="photos.length >= PORTFOLIO_MAX"
        @click="fileInput?.click()"
      />
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        class="hidden"
        @change="onFile"
      />
    </div>

    <Message v-if="loading" severity="info" :closable="false" class="mt-3">Loading…</Message>

    <p
      v-else-if="photos.length === 0"
      class="mt-4 rounded-lg border border-dashed border-[color:var(--bs-border)] p-6 text-center text-sm text-[color:var(--bs-muted)]"
    >
      Nothing here yet. Before/after shots, finished installs, and proudly-built
      bookshelves all work well.
    </p>

    <ul v-else class="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      <li
        v-for="(url, i) in photos"
        :key="url"
        class="group relative aspect-square overflow-hidden rounded-md border border-[color:var(--bs-border)]"
      >
        <img :src="url" :alt="`Portfolio photo ${i + 1}`" class="h-full w-full object-cover" loading="lazy" />
        <div
          class="absolute inset-0 bg-gradient-to-t from-black/55 via-black/0 to-transparent opacity-0 transition-opacity group-hover:opacity-100"
        ></div>
        <div
          class="absolute inset-x-1 bottom-1 flex items-center justify-between opacity-0 transition-opacity group-hover:opacity-100"
        >
          <div class="flex gap-1">
            <Button
              icon="pi pi-arrow-left"
              text
              rounded
              size="small"
              severity="contrast"
              :disabled="i === 0"
              aria-label="Move left"
              @click="move(i, -1)"
            />
            <Button
              icon="pi pi-arrow-right"
              text
              rounded
              size="small"
              severity="contrast"
              :disabled="i === photos.length - 1"
              aria-label="Move right"
              @click="move(i, 1)"
            />
          </div>
          <Button
            icon="pi pi-trash"
            text
            rounded
            size="small"
            severity="danger"
            aria-label="Remove"
            @click="removeAt(i)"
          />
        </div>
      </li>
    </ul>
  </div>
</template>
