<script setup lang="ts">
// Per-job photo attachment for a PM setting up project jobs. Deliberately reuses
// the client job-post photo pipeline end to end — compressToWebp → uploadFile to
// jobPosts/{uuid}/photos/ → keep the Storage PATH (not a download URL) — so the
// photos ride the dispatched posting and contractors see them exactly like a
// client-posted job (JobPostDetailView resolves the same paths). v-model is the
// array of Storage paths stored on the ProjectJobSpec; previews are resolved
// locally (upload returns a URL; prefilled edit paths resolve on the fly).
import { ref, watch } from "vue";
import { compressToWebp } from "@/utils/image";
import { uploadFile, resolveFileUrl } from "@/firebase/services/storage";
import { humanizeError } from "@/utils/errors";
import { useToast } from "@/composables/useToast";

const props = withDefaults(defineProps<{ modelValue: string[]; max?: number }>(), { max: 8 });
const emit = defineEmits<{ "update:modelValue": [string[]] }>();

const toast = useToast();
const fileInput = ref<HTMLInputElement | null>(null);
const urls = ref<Map<string, string>>(new Map());
const busy = ref(false);
// One temp folder per job, matching the client flow (the uuid never has to become
// the final postId — the path is stored verbatim and resolved on read).
const uuid = crypto.randomUUID();

// Resolve any prefilled paths (edit mode) to preview URLs.
watch(
  () => props.modelValue,
  async (paths) => {
    let changed = false;
    for (const p of paths) {
      if (!urls.value.has(p)) {
        try {
          urls.value.set(p, await resolveFileUrl(p));
          changed = true;
        } catch {
          /* missing — skip */
        }
      }
    }
    if (changed) urls.value = new Map(urls.value);
  },
  { immediate: true },
);

async function onPick(e: Event) {
  const input = e.target as HTMLInputElement;
  if (!input.files) return;
  const room = props.max - props.modelValue.length;
  const incoming = Array.from(input.files).slice(0, Math.max(0, room));
  busy.value = true;
  try {
    const added: string[] = [];
    for (let i = 0; i < incoming.length; i++) {
      const file = await compressToWebp(incoming[i]);
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `jobPosts/${uuid}/photos/${Date.now()}_${i}_${safe}`;
      const url = await uploadFile(path, file);
      urls.value.set(path, url);
      added.push(path);
    }
    urls.value = new Map(urls.value);
    emit("update:modelValue", [...props.modelValue, ...added]);
  } catch (err) {
    toast.error("Upload failed", humanizeError(err));
  } finally {
    busy.value = false;
    input.value = "";
  }
}

function remove(idx: number) {
  const next = props.modelValue.slice();
  next.splice(idx, 1);
  emit("update:modelValue", next);
}
</script>

<template>
  <div>
    <label class="text-xs font-medium text-[color:var(--bs-muted)]">
      Photos <span class="font-normal">(optional, up to {{ max }})</span>
    </label>
    <div class="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-1">
      <div
        v-for="(path, idx) in modelValue"
        :key="path"
        class="relative aspect-square rounded-md overflow-hidden border border-[color:var(--bs-border)] bg-[color:var(--bs-surface-alt)]"
      >
        <img v-if="urls.get(path)" :src="urls.get(path)" alt="" class="h-full w-full object-cover" />
        <div v-else class="h-full w-full flex items-center justify-center text-[color:var(--bs-muted)]">
          <i class="pi pi-image"></i>
        </div>
        <button
          type="button"
          class="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 text-white text-xs"
          aria-label="Remove photo"
          @click="remove(idx)"
        >
          ✕
        </button>
      </div>
      <button
        v-if="modelValue.length < max"
        type="button"
        :disabled="busy"
        class="aspect-square rounded-md border-2 border-dashed border-[color:var(--bs-border)] text-[color:var(--bs-muted)] flex items-center justify-center disabled:opacity-50"
        aria-label="Add photos"
        @click="fileInput?.click()"
      >
        <i :class="busy ? 'pi pi-spin pi-spinner' : 'pi pi-plus'"></i>
      </button>
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        multiple
        class="hidden"
        @change="onPick"
      />
    </div>
  </div>
</template>
