<script setup lang="ts">
// Portfolio gallery upload + preview for the prospect editor. Compresses +
// uploads each shot to prospects/{id}/portfolio and keeps a v-model array of
// download URLs (persisted when the editor saves).
import { ref } from "vue";
import Button from "primevue/button";
import { uploadProspectImage } from "@/firebase/services/prospects";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const MAX = 8;

const props = defineProps<{ modelValue: string[]; prospectId: string }>();
const emit = defineEmits<{ "update:modelValue": [string[]] }>();

const toast = useToast();
const uploading = ref(false);
const input = ref<HTMLInputElement | null>(null);

async function onFile(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  if (props.modelValue.length >= MAX) {
    toast.warn("Max reached", `Up to ${MAX} photos.`);
    target.value = "";
    return;
  }
  uploading.value = true;
  try {
    const url = await uploadProspectImage(props.prospectId, file, "portfolio", 1280);
    emit("update:modelValue", [...props.modelValue, url]);
  } catch (err) {
    toast.error("Upload failed", humanizeError(err));
  } finally {
    uploading.value = false;
    target.value = "";
  }
}

function removeAt(idx: number) {
  emit(
    "update:modelValue",
    props.modelValue.filter((_, i) => i !== idx),
  );
}
</script>

<template>
  <div>
    <label class="block text-xs font-medium text-[color:var(--bs-muted)] mb-1">Portfolio photos</label>
    <div class="flex items-center gap-2 mb-2">
      <Button
        label="Add photo"
        icon="pi pi-upload"
        size="small"
        outlined
        :loading="uploading"
        :disabled="modelValue.length >= MAX"
        @click="input?.click()"
      />
      <span class="text-[11px] text-[color:var(--bs-muted)]">Up to {{ MAX }} shots of past work.</span>
      <input ref="input" type="file" accept="image/*" class="hidden" @change="onFile" />
    </div>
    <ul v-if="modelValue.length" class="grid grid-cols-3 sm:grid-cols-4 gap-2">
      <li
        v-for="(url, i) in modelValue"
        :key="url"
        class="group relative aspect-square overflow-hidden rounded border border-[color:var(--bs-border)]"
      >
        <img :src="url" :alt="`Photo ${i + 1}`" class="h-full w-full object-cover" loading="lazy" />
        <Button
          icon="pi pi-trash"
          text
          rounded
          size="small"
          severity="danger"
          class="absolute top-0.5 right-0.5 opacity-0 transition-opacity group-hover:opacity-100"
          aria-label="Remove"
          @click="removeAt(i)"
        />
      </li>
    </ul>
  </div>
</template>
