<script setup lang="ts">
import { ref } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Tag from "primevue/tag";
import type { CertificationDoc, WithId } from "@/firebase/interfaces";
import { tradeLabel } from "@/data/trades";
import { compressOrPassPdf } from "@/utils/image";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const toast = useToast();

const props = defineProps<{
  trade: string;
  existing: WithId<CertificationDoc> | null;
}>();

const emit = defineEmits<{
  uploaded: [
    {
      trade: string;
      file: File;
      issuingBody: string;
      certNumber: string;
      expiresAt: string | null;
    },
  ];
}>();

const issuingBody = ref("");
const certNumber = ref("");
const expiresAt = ref<string>("");
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);

async function onFile(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  if (!issuingBody.value || !certNumber.value) {
    toast.warn("Add issuing body and cert number first.");
    target.value = "";
    return;
  }
  uploading.value = true;
  try {
    const prepared = await compressOrPassPdf(file);
    emit("uploaded", {
      trade: props.trade,
      file: prepared,
      issuingBody: issuingBody.value,
      certNumber: certNumber.value,
      expiresAt: expiresAt.value || null,
    });
  } catch (err) {
    toast.error("Upload failed", humanizeError(err));
  } finally {
    uploading.value = false;
    target.value = "";
  }
}

const statusSeverity = {
  pending: "warn" as const,
  approved: "success" as const,
  rejected: "danger" as const,
};
</script>

<template>
  <div class="bs-card p-3">
    <div class="flex items-center justify-between">
      <div class="font-semibold">{{ tradeLabel(trade) }}</div>
      <Tag v-if="existing" :value="existing.status" :severity="statusSeverity[existing.status]" />
    </div>
    <template v-if="!existing">
      <div class="bs-form grid sm:grid-cols-3 gap-2 mt-2">
        <InputText v-model="issuingBody" placeholder="Issuing body" />
        <InputText v-model="certNumber" placeholder="Cert number" />
        <input ref="fileInput" v-model="expiresAt" type="date" class="border rounded p-2 text-sm" />
      </div>
      <div class="flex items-center justify-between mt-2">
        <Button
          icon="pi pi-upload"
          label="Upload PDF / image"
          outlined
          :loading="uploading"
          @click="(fileInput?.parentElement?.querySelector('input[type=file]') as HTMLInputElement)?.click()"
        />
        <input type="file" accept="image/*,application/pdf" class="hidden" @change="onFile" />
      </div>
    </template>
    <template v-else>
      <div class="text-xs text-[color:var(--bs-muted)] mt-1">
        {{ existing.issuingBody }} • #{{ existing.certNumber }}
      </div>
      <a :href="existing.fileUrl" target="_blank" rel="noopener" class="text-sm">View uploaded document</a>
    </template>
  </div>
</template>
