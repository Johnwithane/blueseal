<script setup lang="ts">
// Search Unsplash and pick a photo. On selection we fetch the image as a File
// and emit it, so the caller runs it through the same compress + upload flow as
// a normal upload. Shown only where isUnsplashEnabled() is true.
import { ref, watch } from "vue";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import Button from "primevue/button";
import {
  searchUnsplash,
  fetchUnsplashAsFile,
  type UnsplashPhoto,
} from "@/api/unsplash";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const props = withDefaults(
  defineProps<{
    visible: boolean;
    defaultQuery?: string;
    title?: string;
  }>(),
  { defaultQuery: "", title: "Choose a photo from Unsplash" },
);
const emit = defineEmits<{ "update:visible": [boolean]; picked: [File] }>();

const toast = useToast();
const query = ref("");
const photos = ref<UnsplashPhoto[]>([]);
const page = ref(1);
const totalPages = ref(0);
const loading = ref(false);
const pickingId = ref<string | null>(null);
const searched = ref(false);

async function runSearch(reset = true) {
  const q = query.value.trim();
  if (!q) return;
  loading.value = true;
  searched.value = true;
  try {
    if (reset) {
      page.value = 1;
      photos.value = [];
    }
    const { photos: found, totalPages: pages } = await searchUnsplash(q, page.value);
    photos.value = reset ? found : [...photos.value, ...found];
    totalPages.value = pages;
  } catch (e) {
    toast.error("Unsplash search failed", humanizeError(e));
  } finally {
    loading.value = false;
  }
}

async function loadMore() {
  if (page.value >= totalPages.value || loading.value) return;
  page.value += 1;
  await runSearch(false);
}

async function pick(photo: UnsplashPhoto) {
  if (pickingId.value) return;
  pickingId.value = photo.id;
  try {
    const file = await fetchUnsplashAsFile(photo);
    emit("picked", file);
    emit("update:visible", false);
  } catch (e) {
    toast.error("Couldn't use that photo", humanizeError(e));
  } finally {
    pickingId.value = null;
  }
}

// Seed the query from the caller (e.g. the tradesperson's trade) each time the
// dialog opens, and run an initial search so it's not an empty box.
watch(
  () => props.visible,
  (open) => {
    if (!open) return;
    query.value = query.value || props.defaultQuery;
    if (query.value.trim() && !photos.value.length) void runSearch(true);
  },
  { immediate: true },
);
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="title"
    :style="{ width: '56rem', maxWidth: '96vw' }"
    :dismissable-mask="true"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="flex gap-2 mb-3">
      <InputText
        v-model="query"
        class="flex-1"
        placeholder="Search Unsplash, e.g. plumbing, kitchen, tools"
        @keydown.enter="runSearch(true)"
      />
      <Button label="Search" icon="pi pi-search" :loading="loading && page === 1" @click="runSearch(true)" />
    </div>

    <div v-if="loading && !photos.length" class="py-10 text-center text-[color:var(--bs-muted)]">
      <i class="pi pi-spin pi-spinner text-2xl"></i>
    </div>
    <div
      v-else-if="searched && !photos.length"
      class="py-10 text-center text-sm text-[color:var(--bs-muted)]"
    >
      No photos found. Try a different search.
    </div>

    <div v-if="photos.length" class="unsplash-grid">
      <figure
        v-for="p in photos"
        :key="p.id"
        class="unsplash-tile"
        :style="{ backgroundColor: p.color || 'var(--bs-surface-alt)' }"
      >
        <button
          type="button"
          class="unsplash-tile__btn"
          :aria-label="`Use this photo by ${p.authorName}`"
          @click="pick(p)"
        >
          <img :src="p.thumbUrl" :alt="p.description || 'Unsplash photo'" loading="lazy" />
          <span v-if="pickingId === p.id" class="unsplash-tile__loading">
            <i class="pi pi-spin pi-spinner"></i>
          </span>
          <span v-else class="unsplash-tile__use"><i class="pi pi-check"></i> Use</span>
        </button>
        <figcaption class="unsplash-tile__credit">
          <a :href="p.authorLink" target="_blank" rel="noopener nofollow">{{ p.authorName }}</a>
        </figcaption>
      </figure>
    </div>

    <div v-if="page < totalPages" class="mt-3 text-center">
      <Button label="Load more" text :loading="loading && page > 1" @click="loadMore" />
    </div>

    <template #footer>
      <span class="text-xs text-[color:var(--bs-muted)] mr-auto">
        Photos via
        <a
          href="https://unsplash.com/?utm_source=blue_seal&utm_medium=referral"
          target="_blank"
          rel="noopener nofollow"
          class="underline"
          >Unsplash</a
        >
      </span>
      <Button label="Close" text severity="secondary" @click="emit('update:visible', false)" />
    </template>
  </Dialog>
</template>

<style scoped>
.unsplash-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 0.6rem;
  max-height: 56vh;
  overflow-y: auto;
}
.unsplash-tile {
  margin: 0;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--bs-border);
}
.unsplash-tile__btn {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  border: 0;
  padding: 0;
  cursor: pointer;
  background: transparent;
}
.unsplash-tile__btn img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.unsplash-tile__use,
.unsplash-tile__loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  color: #fff;
  font-weight: 700;
  font-size: 0.85rem;
  background: rgba(20, 28, 40, 0.45);
  opacity: 0;
  transition: opacity 0.15s;
}
.unsplash-tile__loading {
  opacity: 1;
}
.unsplash-tile__btn:hover .unsplash-tile__use {
  opacity: 1;
}
.unsplash-tile__credit {
  padding: 0.25rem 0.45rem;
  font-size: 0.68rem;
  line-height: 1.2;
  background: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.unsplash-tile__credit a {
  color: var(--bs-muted);
}
.unsplash-tile__credit a:hover {
  text-decoration: underline;
}
</style>
