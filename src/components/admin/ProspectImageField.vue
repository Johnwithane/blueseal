<script setup lang="ts">
// Single-image upload + live preview for the prospect editor (profile photo or
// company logo). Compresses + uploads to prospects/{id}/{bucket} and emits the
// download URL. Shows the actual image, not a link.
import { ref } from "vue";
import Button from "primevue/button";
import { uploadProspectImage } from "@/firebase/services/prospects";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{
  modelValue: string | null;
  prospectId: string;
  bucket: "profile" | "logo";
  label: string;
  hint?: string;
  // Shown (dimmed) when there's no image of our own yet — e.g. the logo field
  // falls back to the profile photo, matching the claim-time behaviour.
  fallback?: string | null;
}>();
const emit = defineEmits<{ "update:modelValue": [string | null] }>();

const toast = useToast();
const uploading = ref(false);
const input = ref<HTMLInputElement | null>(null);
const maxDim = props.bucket === "logo" ? 1024 : 512;

async function onFile(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  uploading.value = true;
  try {
    const url = await uploadProspectImage(props.prospectId, file, props.bucket, maxDim);
    emit("update:modelValue", url);
  } catch (err) {
    toast.error("Upload failed", humanizeError(err));
  } finally {
    uploading.value = false;
    target.value = "";
  }
}
</script>

<template>
  <div>
    <label class="block text-xs font-medium text-[color:var(--bs-muted)] mb-1">{{ label }}</label>
    <div class="flex items-center gap-3">
      <img
        v-if="modelValue"
        :src="modelValue"
        :alt="label"
        class="h-16 w-16 rounded border border-[color:var(--bs-border)] bg-white object-contain"
      />
      <img
        v-else-if="fallback"
        :src="fallback"
        :alt="label"
        title="Using the profile photo until you add a logo"
        class="h-16 w-16 rounded border border-dashed border-[color:var(--bs-border)] bg-white object-contain opacity-60"
      />
      <div
        v-else
        class="h-16 w-16 rounded border border-dashed border-[color:var(--bs-border)] flex items-center justify-center text-[color:var(--bs-muted)] bg-white"
      >
        <i class="pi pi-image" aria-hidden="true" />
      </div>
      <div class="flex flex-col gap-1.5">
        <Button
          :label="modelValue ? 'Replace' : 'Upload'"
          icon="pi pi-upload"
          outlined
          size="small"
          :loading="uploading"
          @click="input?.click()"
        />
        <Button
          v-if="modelValue"
          label="Remove"
          icon="pi pi-times"
          severity="danger"
          text
          size="small"
          @click="emit('update:modelValue', null)"
        />
      </div>
      <input ref="input" type="file" accept="image/*" class="hidden" @change="onFile" />
    </div>
    <p v-if="hint" class="text-[11px] text-[color:var(--bs-muted)] mt-1">{{ hint }}</p>
  </div>
</template>
