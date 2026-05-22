<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import DatePicker from "primevue/datepicker";
import Tag from "primevue/tag";
import type { CertificationDoc, WithId } from "@/firebase/interfaces";
import { tradeLabel } from "@/data/trades";
import {
  ISSUING_BODIES,
  OTHER_CERT,
  presetsForTrade,
  type CertPreset,
} from "@/data/certifications";
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

const presets = computed<CertPreset[]>(() => [...presetsForTrade(props.trade), OTHER_CERT]);

const selectedPreset = ref<CertPreset | null>(presets.value[0] ?? OTHER_CERT);
const customCertName = ref("");
const issuingBody = ref<string>("");
const customIssuingBody = ref("");
const certNumber = ref("");
const expiresAtDate = ref<Date | null>(null);
const neverExpires = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);

const issuingBodyOptions = computed(() => [...ISSUING_BODIES, "Other"]);

// When the user picks a preset that has a default issuer, pre-fill the issuer
// select unless they've already typed something specific.
watch(selectedPreset, (next) => {
  if (next?.defaultIssuer && !issuingBody.value) {
    issuingBody.value = next.defaultIssuer;
  }
});

const certNameForSubmit = computed(() =>
  selectedPreset.value && selectedPreset.value !== OTHER_CERT
    ? selectedPreset.value.name
    : customCertName.value.trim(),
);

const issuingBodyForSubmit = computed(() =>
  issuingBody.value === "Other" ? customIssuingBody.value.trim() : issuingBody.value,
);

const canPickFile = computed(
  () => !!certNameForSubmit.value && !!issuingBodyForSubmit.value && !!certNumber.value.trim(),
);

function triggerFilePicker() {
  if (!canPickFile.value) {
    toast.warn("Fill in the certification, issuing body, and number first.");
    return;
  }
  fileInput.value?.click();
}

async function onFile(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  uploading.value = true;
  try {
    const prepared = await compressOrPassPdf(file);
    const expiresAtIso =
      !neverExpires.value && expiresAtDate.value ? expiresAtDate.value.toISOString() : null;
    // Prefix the cert number with the human-readable credential name so admins
    // reviewing the doc see what was claimed without joining tables.
    const certNumberOut = certNameForSubmit.value
      ? `${certNameForSubmit.value} — ${certNumber.value.trim()}`
      : certNumber.value.trim();
    emit("uploaded", {
      trade: props.trade,
      file: prepared,
      issuingBody: issuingBodyForSubmit.value,
      certNumber: certNumberOut,
      expiresAt: expiresAtIso,
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
      <p class="text-xs text-[color:var(--bs-muted)] mt-1">
        Upload one current credential that proves you can work as a {{ tradeLabel(trade).toLowerCase() }} in Canada — a Red Seal or provincial Certificate of Qualification works best. PDF or photo, both sides if your card has them.
      </p>

      <div class="bs-form space-y-3 mt-3">
        <div>
          <label class="text-sm font-medium">Certification</label>
          <Select
            v-model="selectedPreset"
            :options="presets"
            option-label="label"
            placeholder="Pick the credential you hold"
            class="mt-1 w-full"
          />
          <p class="text-xs text-[color:var(--bs-muted)] mt-1">
            Choose the closest match. Pick <em>Other</em> if your credential isn't listed.
          </p>
          <InputText
            v-if="selectedPreset === OTHER_CERT"
            v-model="customCertName"
            placeholder="Name of your credential (e.g. Journeyperson Certificate)"
            class="mt-2 w-full"
          />
        </div>

        <div>
          <label class="text-sm font-medium">Issuing body</label>
          <Select
            v-model="issuingBody"
            :options="issuingBodyOptions"
            placeholder="Who issued it?"
            class="mt-1 w-full"
            filter
          />
          <p class="text-xs text-[color:var(--bs-muted)] mt-1">
            The province, regulator, or program that issued the credential. Usually printed on the front of the card.
          </p>
          <InputText
            v-if="issuingBody === 'Other'"
            v-model="customIssuingBody"
            placeholder="Name of the issuing body"
            class="mt-2 w-full"
          />
        </div>

        <div>
          <label class="text-sm font-medium">Certificate / licence number</label>
          <InputText v-model="certNumber" placeholder="e.g. 309A-123456" class="mt-1 w-full" />
          <p class="text-xs text-[color:var(--bs-muted)] mt-1">
            The unique number printed on your certificate or wallet card.
          </p>
        </div>

        <div>
          <label class="text-sm font-medium">Expiry date</label>
          <div class="mt-1 flex flex-col sm:flex-row sm:items-center gap-2">
            <DatePicker
              v-model="expiresAtDate"
              :disabled="neverExpires"
              date-format="yy-mm-dd"
              show-icon
              icon-display="input"
              placeholder="YYYY-MM-DD"
              class="w-full sm:flex-1"
            />
            <label class="inline-flex items-center gap-2 text-sm">
              <input v-model="neverExpires" type="checkbox" />
              No expiry
            </label>
          </div>
          <p class="text-xs text-[color:var(--bs-muted)] mt-1">
            If your credential has a renewal date, enter it here so we can remind you before it lapses. Tick <em>No expiry</em> if it doesn't expire (e.g. most Red Seal endorsements).
          </p>
        </div>

        <div class="flex items-center justify-between pt-1">
          <Button
            icon="pi pi-upload"
            label="Upload PDF / image"
            outlined
            :disabled="!canPickFile"
            :loading="uploading"
            @click="triggerFilePicker"
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

    <template v-else>
      <div class="text-xs text-[color:var(--bs-muted)] mt-1">
        {{ existing.issuingBody }} • #{{ existing.certNumber }}
      </div>
      <a :href="existing.fileUrl" target="_blank" rel="noopener" class="text-sm">View uploaded document</a>
    </template>
  </div>
</template>
