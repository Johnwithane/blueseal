<script setup lang="ts">
import { computed, ref } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import DatePicker from "primevue/datepicker";
import Tag from "primevue/tag";
import Message from "primevue/message";
import type {
  CanadaProvince,
  WithId,
  WsibVerificationDoc,
} from "@/firebase/interfaces";
import { submitWsib, updateWsib } from "@/firebase/services/wsibVerifications";
import VerificationDocPreview from "@/components/VerificationDocPreview.vue";
import { uploadFile, makeStoragePath } from "@/firebase/services/storage";
import { compressOrPassPdf } from "@/utils/image";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import { useFormatters } from "@/composables/useFormatters";
import { VERIFICATION_SEVERITY } from "@/utils/verificationStatus";

const props = defineProps<{
  tradespersonId: string;
  existing: WithId<WsibVerificationDoc> | null;
}>();

const emit = defineEmits<{
  submitted: [];
  updated: [];
}>();

const toast = useToast();
const { date } = useFormatters();

const fileInput = ref<HTMLInputElement | null>(null);
const pickedFile = ref<File | null>(null);
const pickedFileName = ref<string | null>(null);
const province = ref<CanadaProvince>("ON");
const clearanceNumber = ref("");
const expiresAt = ref<Date | null>(null);
const submitting = ref(false);
const viewerOpen = ref(false);
const editing = ref(false);
const replacing = ref(false);

// Provinces in display order. WSIB is the Ontario brand; other provinces have
// their own clearance schemes (WorkSafeBC, WCB Alberta, etc.) but the doc
// shape and admin review flow are identical so we treat them uniformly.
const provinceOptions: { label: string; value: CanadaProvince }[] = [
  { label: "Ontario (WSIB)", value: "ON" },
  { label: "British Columbia (WorkSafeBC)", value: "BC" },
  { label: "Alberta (WCB)", value: "AB" },
  { label: "Quebec (CNESST)", value: "QC" },
  { label: "Manitoba (WCB)", value: "MB" },
  { label: "Saskatchewan (WCB)", value: "SK" },
  { label: "Nova Scotia (WCB)", value: "NS" },
  { label: "New Brunswick (WorkSafeNB)", value: "NB" },
  { label: "Newfoundland & Labrador (WorkplaceNL)", value: "NL" },
  { label: "Prince Edward Island (WCB)", value: "PE" },
  { label: "Yukon (YWCHSB)", value: "YT" },
  { label: "Northwest Territories (WSCC)", value: "NT" },
  { label: "Nunavut (WSCC)", value: "NU" },
];


const hasUpload = computed(() => props.existing != null);
const provinceLabel = computed(() => {
  const p = props.existing?.province;
  return p ? (provinceOptions.find((o) => o.value === p)?.label ?? p) : "";
});

const isEditingExisting = computed(() => editing.value && hasUpload.value);
const showForm = computed(
  () => !hasUpload.value || replacing.value || isEditingExisting.value,
);

const defaultOpen = computed(
  () =>
    !props.existing ||
    props.existing.status === "rejected" ||
    editing.value ||
    replacing.value,
);

function resetForm() {
  province.value = "ON";
  clearanceNumber.value = "";
  expiresAt.value = null;
  pickedFile.value = null;
  pickedFileName.value = null;
}

function enterReplace() {
  resetForm();
  replacing.value = true;
  editing.value = false;
}

function enterEdit() {
  if (!props.existing) return;
  province.value = props.existing.province;
  clearanceNumber.value = props.existing.clearanceNumber;
  const rawExpiry = props.existing.expiresAt;
  if (rawExpiry) {
    const asDate =
      typeof (rawExpiry as { toDate?: unknown }).toDate === "function"
        ? (rawExpiry as { toDate: () => Date }).toDate()
        : (rawExpiry as unknown as Date);
    expiresAt.value = asDate;
  } else {
    expiresAt.value = null;
  }
  pickedFile.value = null;
  pickedFileName.value = null;
  editing.value = true;
  replacing.value = false;
}

function cancelForm() {
  editing.value = false;
  replacing.value = false;
  resetForm();
}

function onPickFile() {
  fileInput.value?.click();
}

async function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  try {
    const prepared = await compressOrPassPdf(file);
    pickedFile.value = prepared;
    pickedFileName.value = prepared.name;
  } catch (err) {
    toast.error("Couldn't read file", humanizeError(err));
  } finally {
    target.value = "";
  }
}

const canSubmitUpload = computed(
  () =>
    !!pickedFile.value &&
    clearanceNumber.value.trim().length > 0 &&
    expiresAt.value != null,
);

const canSaveEdit = computed(
  () => clearanceNumber.value.trim().length > 0 && expiresAt.value != null,
);

async function submit() {
  if (!canSubmitUpload.value || !pickedFile.value || !expiresAt.value) return;
  submitting.value = true;
  try {
    const path = makeStoragePath({
      scope: "tradespeople",
      id: props.tradespersonId,
      bucket: "wsib",
      filename: pickedFile.value.name,
    });
    const fileUrl = await uploadFile(path, pickedFile.value);
    await submitWsib(props.tradespersonId, {
      fileUrl,
      province: province.value,
      clearanceNumber: clearanceNumber.value,
      expiresAt: expiresAt.value,
    });
    toast.success("WSIB / clearance submitted");
    resetForm();
    replacing.value = false;
    emit("submitted");
  } catch (err) {
    toast.error("Upload failed", humanizeError(err));
  } finally {
    submitting.value = false;
  }
}

async function saveEdit() {
  if (!props.existing || !canSaveEdit.value || !expiresAt.value) return;
  submitting.value = true;
  try {
    await updateWsib(props.tradespersonId, {
      province: province.value,
      clearanceNumber: clearanceNumber.value,
      expiresAt: expiresAt.value,
    });
    toast.success("Clearance details updated");
    editing.value = false;
    resetForm();
    emit("updated");
  } catch (err) {
    toast.error("Save failed", humanizeError(err));
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <details class="bs-card bs-cert-card" :open="defaultOpen">
    <summary class="bs-cert-card__summary">
      <div class="font-semibold">Workers' comp clearance (WSIB / WCB)</div>
      <div class="flex items-center gap-2">
        <span v-if="existing" class="text-xs text-[color:var(--bs-muted)]">
          Uploaded
        </span>
        <Tag v-else value="Optional" severity="info" />
        <Tag
          v-if="existing && existing.status !== 'pending'"
          :value="existing.status"
          :severity="VERIFICATION_SEVERITY[existing.status]"
        />
        <i class="pi pi-chevron-down bs-cert-card__chevron" aria-hidden="true"></i>
      </div>
    </summary>
    <div class="bs-cert-card__body">

    <!-- UPLOADED STATE -->
    <template v-if="existing && !showForm">
      <div class="mt-3 space-y-2 text-sm">
        <div>
          <div class="text-xs text-[color:var(--bs-muted)] uppercase tracking-wide">
            Province
          </div>
          <div>{{ provinceLabel }}</div>
        </div>
        <div>
          <div class="text-xs text-[color:var(--bs-muted)] uppercase tracking-wide">
            Clearance number
          </div>
          <div>{{ existing.clearanceNumber }}</div>
        </div>
        <div>
          <div class="text-xs text-[color:var(--bs-muted)] uppercase tracking-wide">
            Expires
          </div>
          <div>{{ date(existing.expiresAt) }}</div>
        </div>
        <div
          v-if="existing.status === 'rejected' && existing.rejectionReason"
          class="text-sm text-[color:var(--bs-danger-text)] mt-2"
        >
          Reviewer notes: {{ existing.rejectionReason }}
        </div>
        <Message
          v-if="existing.status !== 'pending' && existing.status !== 'rejected'"
          severity="info"
          :closable="false"
        >
          Clearance is reviewed — editing isn't available. Clearance
          certificates expire every 60–90 days; use Replace to upload a fresh
          one when yours renews.
        </Message>
      </div>

      <div class="mt-3 flex items-center gap-2 flex-wrap">
        <Button
          icon="pi pi-eye"
          label="View document"
          outlined
          @click="viewerOpen = true"
        />
        <Button
          v-if="existing.status === 'pending'"
          icon="pi pi-pencil"
          label="Edit details"
          outlined
          @click="enterEdit"
        />
        <Button
          icon="pi pi-refresh"
          label="Replace"
          outlined
          @click="enterReplace"
        />
      </div>

      <VerificationDocPreview
        v-model:visible="viewerOpen"
        :file-url="existing.fileUrl"
        header="Workers' comp clearance"
        label="Clearance certificate"
      />
    </template>

    <!-- EMPTY STATE + EDIT MODE + REPLACE MODE -->
    <template v-else>
      <p class="text-xs text-[color:var(--bs-muted)] mt-1">
        <template v-if="isEditingExisting">
          Update the details on your current submission. To swap the
          uploaded file itself, cancel and use Replace instead.
        </template>
        <template v-else>
          Optional — adds a verified clearance badge to your public profile.
          Clearance certificates typically expire every 60–90 days; you'll
          need to re-upload when yours renews.
        </template>
      </p>

      <div class="bs-form space-y-3 mt-3">
        <div>
          <label class="text-sm font-medium">Province</label>
          <Select
            v-model="province"
            :options="provinceOptions"
            option-label="label"
            option-value="value"
            class="mt-1 w-full"
          />
        </div>
        <div>
          <label class="text-sm font-medium">Clearance number</label>
          <InputText v-model="clearanceNumber" class="mt-1 w-full" />
        </div>
        <div>
          <label class="text-sm font-medium">Clearance expiry</label>
          <DatePicker
            v-model="expiresAt"
            :min-date="new Date()"
            date-format="yy-mm-dd"
            class="mt-1 w-full"
            show-icon
            icon-display="input"
          />
        </div>

        <template v-if="!isEditingExisting">
          <div>
            <Button
              icon="pi pi-upload"
              :label="pickedFileName ? `Selected: ${pickedFileName}` : 'Choose clearance file (PDF or image)'"
              outlined
              @click="onPickFile"
            />
            <input
              ref="fileInput"
              type="file"
              accept="image/*,application/pdf"
              class="hidden"
              @change="onFileChange"
            />
          </div>
        </template>

        <div class="flex items-center justify-end gap-2 pt-1 flex-wrap">
          <template v-if="isEditingExisting">
            <Button label="Cancel" text :disabled="submitting" @click="cancelForm" />
            <Button
              icon="pi pi-check"
              label="Save changes"
              :loading="submitting"
              :disabled="!canSaveEdit"
              @click="saveEdit"
            />
          </template>
          <template v-else>
            <Button
              v-if="replacing"
              label="Cancel"
              text
              :disabled="submitting"
              @click="cancelForm"
            />
            <Button
              icon="pi pi-send"
              :label="replacing ? 'Submit new certificate' : 'Submit'"
              :loading="submitting"
              :disabled="!canSubmitUpload"
              @click="submit"
            />
          </template>
        </div>
      </div>
    </template>
    </div>
  </details>
</template>
