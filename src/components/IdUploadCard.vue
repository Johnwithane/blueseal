<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import Button from "primevue/button";
import Select from "primevue/select";
import Tag from "primevue/tag";
import Dialog from "primevue/dialog";
import Message from "primevue/message";
import type { IdDocType } from "@/firebase/interfaces";
import { compressOrPassPdf } from "@/utils/image";
import { useToast } from "@/composables/useToast";
import { useConfirmAction } from "@/composables/useConfirmAction";
import { humanizeError } from "@/utils/errors";
import { VERIFICATION_SEVERITY, VERIFICATION_LABEL } from "@/utils/verificationStatus";

const toast = useToast();
const { confirmDestructive } = useConfirmAction();

const props = defineProps<{
  status: "none" | "pending" | "approved" | "rejected";
}>();

const emit = defineEmits<{
  uploaded: [{ file: File; documentType: IdDocType }];
  removed: [];
}>();

const documentType = ref<IdDocType>("drivers_license");
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const removing = ref(false);
const viewerOpen = ref(false);

// Local preview state. The ID storage path is admin-read-only, so the only
// way the owner can see their own uploaded ID is from the blob URL we hold
// in memory for this session. A page reload loses this — the card then
// shows status info and a remove + re-upload path.
const localFileUrl = ref<string | null>(null);
const localIsPdf = ref(false);
const localFileName = ref<string | null>(null);

onBeforeUnmount(() => {
  if (localFileUrl.value) URL.revokeObjectURL(localFileUrl.value);
});

async function onFile(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  uploading.value = true;
  try {
    const prepared = await compressOrPassPdf(file);
    // Stash a blob URL for in-session preview before we hand the file off.
    if (localFileUrl.value) URL.revokeObjectURL(localFileUrl.value);
    localFileUrl.value = URL.createObjectURL(prepared);
    localIsPdf.value = prepared.type === "application/pdf";
    localFileName.value = prepared.name;
    emit("uploaded", { file: prepared, documentType: documentType.value });
  } catch (err) {
    toast.error("Upload failed", humanizeError(err));
  } finally {
    uploading.value = false;
    target.value = "";
  }
}

function removeUploaded() {
  confirmDestructive(
    { message: "Remove this ID? You'll need to upload a new one.", header: "Remove ID" },
    () => {
      removing.value = true;
      try {
        if (localFileUrl.value) {
          URL.revokeObjectURL(localFileUrl.value);
          localFileUrl.value = null;
          localFileName.value = null;
        }
        emit("removed");
      } finally {
        removing.value = false;
      }
    },
  );
}


const documentTypeOptions = [
  { label: "Driver's licence", value: "drivers_license" as IdDocType },
  { label: "Passport", value: "passport" as IdDocType },
  { label: "Provincial ID", value: "provincial_id" as IdDocType },
];

const hasUpload = computed(() => props.status !== "none");
</script>

<template>
  <div class="bs-card p-3">
    <div class="flex items-center justify-between gap-2 flex-wrap">
      <div class="font-semibold">Government-issued photo ID</div>
      <Tag :value="VERIFICATION_LABEL[props.status]" :severity="VERIFICATION_SEVERITY[props.status]" />
    </div>
    <p class="text-xs text-[color:var(--bs-muted)] mt-1">
      Driver's licence, passport, or provincial ID. Stored under strict
      admin-only access — we won't be able to show it back to you after you
      leave this page.
    </p>

    <!-- UPLOADED STATE -->
    <template v-if="hasUpload">
      <div v-if="localFileUrl" class="mt-3">
        <div class="rounded border overflow-hidden bg-[color:var(--bs-surface-alt)]">
          <iframe
            v-if="localIsPdf"
            :src="localFileUrl"
            class="w-full"
            style="height: 240px"
            title="ID preview"
          />
          <img
            v-else
            :src="localFileUrl"
            alt="ID preview"
            class="w-full object-contain"
            style="max-height: 240px"
          />
        </div>
        <div v-if="localFileName" class="text-xs text-[color:var(--bs-muted)] mt-1">
          {{ localFileName }}
        </div>
      </div>
      <Message v-else severity="info" :closable="false" class="mt-3">
        Your ID is submitted and pending admin review. We can't display it
        here because the file is admin-only readable. Remove it to upload a
        replacement.
      </Message>

      <div class="mt-3 flex items-center gap-2 flex-wrap">
        <Button
          v-if="localFileUrl"
          icon="pi pi-eye"
          label="View full size"
          outlined
          @click="viewerOpen = true"
        />
        <Button
          icon="pi pi-trash"
          label="Remove"
          severity="danger"
          outlined
          :loading="removing"
          :disabled="props.status === 'approved'"
          @click="removeUploaded"
        />
      </div>

      <Dialog
        v-if="localFileUrl"
        v-model:visible="viewerOpen"
        modal
        header="Your photo ID"
        :style="{ width: '90vw', maxWidth: '900px' }"
      >
        <div class="w-full" style="height: 70vh">
          <iframe
            v-if="localIsPdf"
            :src="localFileUrl"
            class="w-full h-full rounded border"
            title="ID"
          />
          <img
            v-else
            :src="localFileUrl"
            alt="ID"
            class="w-full h-full object-contain rounded border"
          />
        </div>
      </Dialog>
    </template>

    <!-- EMPTY STATE -->
    <div v-else class="bs-form mt-2 flex items-center gap-2">
      <Select
        v-model="documentType"
        :options="documentTypeOptions"
        option-label="label"
        option-value="value"
        class="flex-1"
      />
      <Button
        icon="pi pi-upload"
        label="Upload"
        outlined
        :loading="uploading"
        @click="fileInput?.click()"
      />
      <input
        ref="fileInput"
        type="file"
        accept="image/*,application/pdf"
        class="hidden"
        @change="onFile"
      />
    </div>
  </div>
</template>
