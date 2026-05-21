<script setup lang="ts">
import { ref } from "vue";
import Button from "primevue/button";
import Select from "primevue/select";
import Tag from "primevue/tag";
import type { IdDocType } from "@/firebase/interfaces";

const props = defineProps<{
  status: "none" | "pending" | "approved" | "rejected";
}>();

const emit = defineEmits<{
  uploaded: [{ file: File; documentType: IdDocType }];
}>();

const documentType = ref<IdDocType>("drivers_license");
const fileInput = ref<HTMLInputElement | null>(null);

async function onFile(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  emit("uploaded", { file, documentType: documentType.value });
  target.value = "";
}

const statusSeverity = {
  none: "secondary" as const,
  pending: "warn" as const,
  approved: "success" as const,
  rejected: "danger" as const,
};
</script>

<template>
  <div class="bs-card p-3">
    <div class="flex items-center justify-between">
      <div class="font-semibold">Government-issued photo ID</div>
      <Tag :value="props.status" :severity="statusSeverity[props.status]" />
    </div>
    <p class="text-xs text-[color:var(--bs-muted)] mt-1">
      Driver's licence, passport, or provincial ID. Admin-only access.
    </p>
    <div class="bs-form mt-2 flex items-center gap-2">
      <Select
        v-model="documentType"
        :options="[
          { label: 'Driver\'s licence', value: 'drivers_license' },
          { label: 'Passport', value: 'passport' },
          { label: 'Provincial ID', value: 'provincial_id' },
        ]"
        option-label="label"
        option-value="value"
        class="flex-1"
      />
      <Button
        icon="pi pi-upload"
        label="Upload"
        outlined
        @click="fileInput?.click()"
      />
      <input ref="fileInput" type="file" accept="image/*,application/pdf" class="hidden" @change="onFile" />
    </div>
  </div>
</template>
