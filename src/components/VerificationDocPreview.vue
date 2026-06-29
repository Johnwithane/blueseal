<script setup lang="ts">
// Shared modal viewer for an uploaded verification document (certification /
// insurance / WSIB clearance). A PDF renders in an iframe, an image inline; the
// footer links out to a new tab. Extracted from the three upload cards, which
// each carried a byte-identical copy of this dialog + the isPdf check.
import { computed } from "vue";
import Dialog from "primevue/dialog";

const props = defineProps<{
  fileUrl: string;
  header: string;
  // Used for the iframe title + image alt text (e.g. "Certification").
  label: string;
}>();

const visible = defineModel<boolean>("visible", { required: true });

const isPdf = computed(() => props.fileUrl.toLowerCase().includes(".pdf"));
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    :header="header"
    :style="{ width: '90vw', maxWidth: '900px' }"
  >
    <div class="w-full" style="height: 70vh">
      <iframe
        v-if="isPdf"
        :src="fileUrl"
        class="w-full h-full rounded border"
        :title="label"
      />
      <img
        v-else
        :src="fileUrl"
        :alt="label"
        class="w-full h-full object-contain rounded border"
      />
    </div>
    <template #footer>
      <a :href="fileUrl" target="_blank" rel="noopener" class="text-sm">
        Open in new tab →
      </a>
    </template>
  </Dialog>
</template>
