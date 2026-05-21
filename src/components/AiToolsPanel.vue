<script setup lang="ts">
import { ref } from "vue";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import Textarea from "primevue/textarea";
import Message from "primevue/message";
import { diagnose, quoteHelper, summarizeJob } from "@/firebase/services/ai";

const props = defineProps<{
  jobId: string;
  hasActiveSubscription: boolean;
}>();

const open = ref<null | "diagnose" | "quote" | "summary">(null);
const prompt = ref("");
const loading = ref(false);
const result = ref<string | null>(null);
const error = ref<string | null>(null);

function reset(mode: "diagnose" | "quote" | "summary") {
  open.value = mode;
  prompt.value = "";
  result.value = null;
  error.value = null;
}

async function run() {
  loading.value = true;
  result.value = null;
  error.value = null;
  try {
    const fn =
      open.value === "diagnose"
        ? diagnose
        : open.value === "quote"
          ? quoteHelper
          : summarizeJob;
    const res = await fn({ jobId: props.jobId, prompt: prompt.value });
    result.value = res.content;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="bs-card p-3">
    <h3 class="font-semibold text-sm mb-2">AI tools</h3>
    <Message v-if="!props.hasActiveSubscription" severity="info" :closable="false" class="mb-2">
      AI tools unlock with the tradesperson subscription.
    </Message>
    <div class="grid grid-cols-3 gap-2">
      <Button
        label="Diagnose"
        icon="pi pi-bolt"
        size="small"
        outlined
        :disabled="!props.hasActiveSubscription"
        @click="reset('diagnose')"
      />
      <Button
        label="Quote"
        icon="pi pi-dollar"
        size="small"
        outlined
        :disabled="!props.hasActiveSubscription"
        @click="reset('quote')"
      />
      <Button
        label="Summary"
        icon="pi pi-file"
        size="small"
        outlined
        :disabled="!props.hasActiveSubscription"
        @click="reset('summary')"
      />
    </div>

    <Dialog
      :visible="open !== null"
      modal
      :header="open === 'diagnose' ? 'Diagnose' : open === 'quote' ? 'Quote helper' : 'Summary'"
      :style="{ width: '40rem' }"
      @update:visible="(v) => !v && (open = null)"
    >
      <p class="text-sm text-[color:var(--bs-muted)] mb-2">
        The AI sees the chat + intake photos for this job.
      </p>
      <Textarea v-model="prompt" rows="3" class="w-full" placeholder="Optional extra context or question…" />
      <Button label="Run" icon="pi pi-play" :loading="loading" class="mt-2" @click="run" />

      <Message v-if="error" severity="error" :closable="false" class="mt-3">{{ error }}</Message>
      <div v-if="result" class="bs-card p-3 mt-3 whitespace-pre-wrap text-sm">{{ result }}</div>
    </Dialog>
  </div>
</template>
