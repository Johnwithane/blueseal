<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import Message from "primevue/message";

// A form-level error banner that sits next to the submit button and scrolls
// itself into view whenever a new error appears — so a failed submit is never
// silent off-screen (especially on mobile, where the submit button is far
// below the top of a long form). Drop it directly above the submit row and
// bind :message to the form's error ref.
const props = defineProps<{ message: string | null }>();

const el = ref<HTMLElement | null>(null);
watch(
  () => props.message,
  async (msg) => {
    if (!msg) return;
    await nextTick();
    el.value?.scrollIntoView({ behavior: "smooth", block: "center" });
  },
);
</script>

<template>
  <div ref="el">
    <Message v-if="message" severity="error" :closable="false">{{ message }}</Message>
  </div>
</template>
