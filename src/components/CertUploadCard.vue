<script setup lang="ts">
import { computed, ref, watch } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import DatePicker from "primevue/datepicker";
import Dialog from "primevue/dialog";
import Tag from "primevue/tag";
import Message from "primevue/message";
import type { CertificationDoc, WithId } from "@/firebase/interfaces";
import { tradeLabel } from "@/data/trades";
import {
  ISSUING_BODIES,
  OTHER_CERT,
  presetsForTrade,
  type CertPreset,
} from "@/data/certifications";
import { isSelfDeclaredNoCert, NO_CERT_SENTINEL } from "@/firebase/services/certifications";
import { compressOrPassPdf } from "@/utils/image";
import { useToast } from "@/composables/useToast";
import { useConfirmAction } from "@/composables/useConfirmAction";
import { useFormatters } from "@/composables/useFormatters";
import { humanizeError } from "@/utils/errors";
import { VERIFICATION_SEVERITY } from "@/utils/verificationStatus";

const toast = useToast();
const { confirmDestructive } = useConfirmAction();
const { date } = useFormatters();

const props = defineProps<{
  trade: string;
  existing: WithId<CertificationDoc> | null;
}>();

const emit = defineEmits<{
  uploaded: [
    {
      trade: string;
      file: File | null;
      issuingBody: string;
      certNumber: string;
      expiresAt: string | null;
    },
  ];
  deleted: [certId: string];
  updated: [
    {
      certId: string;
      issuingBody: string;
      certNumber: string;
      expiresAt: string | null;
    },
  ];
}>();

// `OTHER_CERT` is the trailing "Other / custom" option. We also append a
// "no certification" preset so the tradesperson can declare they don't hold
// a formal credential — admins still see it in the vetting queue.
const NO_CERT_PRESET: CertPreset = {
  label: "I don't have a formal certification for this trade",
  name: NO_CERT_SENTINEL,
};

const presets = computed<CertPreset[]>(() => [
  ...presetsForTrade(props.trade),
  OTHER_CERT,
  NO_CERT_PRESET,
]);

const selectedPreset = ref<CertPreset | null>(presets.value[0] ?? OTHER_CERT);
const customCertName = ref("");
const issuingBody = ref<string>("");
const customIssuingBody = ref("");
const certNumber = ref("");
const expiresAtDate = ref<Date | null>(null);
const neverExpires = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const removing = ref(false);
const saving = ref(false);
const viewerOpen = ref(false);
// When true, the card is showing the same form as the empty state but
// pre-filled with the existing cert's values so the user can fix typos /
// wrong selections without removing and re-uploading the file.
const editing = ref(false);

const issuingBodyOptions = computed(() => [...ISSUING_BODIES, "Other"]);

const isNoCertSelected = computed(() => selectedPreset.value === NO_CERT_PRESET);

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

async function submitNoCertDeclaration() {
  uploading.value = true;
  try {
    emit("uploaded", {
      trade: props.trade,
      file: null,
      issuingBody: "Self-declared",
      certNumber: NO_CERT_SENTINEL,
      expiresAt: null,
    });
  } finally {
    uploading.value = false;
  }
}

function removeExisting() {
  if (!props.existing) return;
  const id = props.existing.id;
  confirmDestructive(
    {
      message: "Remove this certification? You can upload a new one after.",
      header: "Remove certification",
    },
    () => {
      removing.value = true;
      try {
        emit("deleted", id);
      } finally {
        removing.value = false;
      }
    },
  );
}

// Walk the form refs back to the values stored on the existing cert so the
// edit form opens pre-filled. If the cert name doesn't match any known
// preset, fall back to OTHER_CERT with the saved name in the custom input.
function enterEdit() {
  if (!props.existing) return;
  const { name, number } = displayCertName.value;
  const matchedPreset = presets.value.find((p) => p !== OTHER_CERT && p.name === name);
  selectedPreset.value = matchedPreset ?? OTHER_CERT;
  customCertName.value = matchedPreset ? "" : name;

  const knownIssuer = ISSUING_BODIES.includes(props.existing.issuingBody);
  issuingBody.value = knownIssuer ? props.existing.issuingBody : "Other";
  customIssuingBody.value = knownIssuer ? "" : props.existing.issuingBody;

  certNumber.value = number;

  const rawExpiry = props.existing.expiresAt;
  if (rawExpiry) {
    // Firestore returns a Timestamp on the wire but JS Date instances when
    // the converter has already run — handle both.
    const asDate =
      typeof (rawExpiry as { toDate?: unknown }).toDate === "function"
        ? (rawExpiry as { toDate: () => Date }).toDate()
        : (rawExpiry as unknown as Date);
    expiresAtDate.value = asDate;
    neverExpires.value = false;
  } else {
    expiresAtDate.value = null;
    neverExpires.value = true;
  }

  editing.value = true;
}

function cancelEdit() {
  editing.value = false;
}

async function saveEdit() {
  if (!props.existing) return;
  if (!certNameForSubmit.value || !issuingBodyForSubmit.value || !certNumber.value.trim()) {
    toast.warn("Fill in the certification, issuing body, and number first.");
    return;
  }
  saving.value = true;
  try {
    const expiresAtIso =
      !neverExpires.value && expiresAtDate.value ? expiresAtDate.value.toISOString() : null;
    const certNumberOut = certNameForSubmit.value
      ? `${certNameForSubmit.value} — ${certNumber.value.trim()}`
      : certNumber.value.trim();
    emit("updated", {
      certId: props.existing.id,
      issuingBody: issuingBodyForSubmit.value,
      certNumber: certNumberOut,
      expiresAt: expiresAtIso,
    });
    editing.value = false;
  } finally {
    saving.value = false;
  }
}

const isPdf = computed(() => {
  const url = props.existing?.fileUrl ?? "";
  return url.toLowerCase().includes(".pdf");
});

const isNoCertDoc = computed(() =>
  props.existing ? isSelfDeclaredNoCert(props.existing) : false,
);

const displayCertName = computed(() => {
  // Cert number was stored as "<name> — <number>" so the admin sees the
  // claimed credential. Split it back out for the owner's view.
  const raw = props.existing?.certNumber ?? "";
  const idx = raw.indexOf(" — ");
  if (idx === -1) return { name: "", number: raw };
  return { name: raw.slice(0, idx), number: raw.slice(idx + 3) };
});

// Default-open the card when there's nothing uploaded yet (the user needs
// to fill out the form) or when the cert was rejected (needs attention).
// Completed pending / approved certs collapse by default so a long list of
// trades doesn't dominate the screen — the user can still expand to view.
const defaultOpen = computed(
  () => !props.existing || props.existing.status === "rejected" || editing.value,
);
</script>

<template>
  <details class="bs-card bs-cert-card" :open="defaultOpen">
    <summary class="bs-cert-card__summary">
      <div class="font-semibold">{{ tradeLabel(trade) }}</div>
      <div class="flex items-center gap-2">
        <!-- Status hint in the collapsed header so the user knows at a
             glance whether this trade needs attention. "pending" is the
             default and uninformative on its own — show "Uploaded" instead
             so it reads as progress, not as a yellow warning. -->
        <span v-if="existing" class="text-xs text-[color:var(--bs-muted)]">
          {{ isNoCertDoc ? "No formal cert" : "Uploaded" }}
        </span>
        <Tag
          v-else
          value="Needed"
          severity="warn"
        />
        <Tag
          v-if="existing && existing.status !== 'pending'"
          :value="existing.status"
          :severity="VERIFICATION_SEVERITY[existing.status]"
        />
        <i class="pi pi-chevron-down bs-cert-card__chevron" aria-hidden="true"></i>
      </div>
    </summary>
    <div class="bs-cert-card__body">

    <!-- UPLOADED STATE: keep the card fully expanded so the user can see what
         was submitted, view the file, and replace / remove it. -->
    <template v-if="existing && !editing">
      <div class="mt-3 space-y-2 text-sm">
        <Message
          v-if="isNoCertDoc"
          severity="info"
          :closable="false"
        >
          You declared no formal certification for this trade. The vetting team
          will review your application and may follow up for references or
          proof of work.
        </Message>
        <div v-else>
          <div class="text-xs text-[color:var(--bs-muted)] uppercase tracking-wide">
            Certification
          </div>
          <div>{{ displayCertName.name || existing.certNumber }}</div>
        </div>
        <div v-if="!isNoCertDoc">
          <div class="text-xs text-[color:var(--bs-muted)] uppercase tracking-wide">Issuer</div>
          <div>{{ existing.issuingBody }}</div>
        </div>
        <div v-if="!isNoCertDoc">
          <div class="text-xs text-[color:var(--bs-muted)] uppercase tracking-wide">
            Number
          </div>
          <div>{{ displayCertName.number }}</div>
        </div>
        <div v-if="!isNoCertDoc">
          <div class="text-xs text-[color:var(--bs-muted)] uppercase tracking-wide">
            Expires
          </div>
          <div>{{ existing.expiresAt ? date(existing.expiresAt) : "No expiry" }}</div>
        </div>
        <div
          v-if="existing.status === 'rejected' && existing.rejectionReason"
          class="text-sm text-red-700 mt-2"
        >
          Reviewer notes: {{ existing.rejectionReason }}
        </div>
      </div>

      <div class="mt-3 flex items-center gap-2 flex-wrap">
        <Button
          v-if="!isNoCertDoc"
          icon="pi pi-eye"
          label="View document"
          outlined
          @click="viewerOpen = true"
        />
        <Button
          v-if="!isNoCertDoc"
          icon="pi pi-pencil"
          label="Edit details"
          outlined
          @click="enterEdit"
        />
        <Button
          icon="pi pi-trash"
          :label="isNoCertDoc ? 'Remove declaration' : 'Remove'"
          severity="danger"
          outlined
          :loading="removing"
          @click="removeExisting"
        />
      </div>

      <Dialog
        v-model:visible="viewerOpen"
        modal
        :header="tradeLabel(trade) + ' — certification'"
        :style="{ width: '90vw', maxWidth: '900px' }"
      >
        <div class="w-full" style="height: 70vh">
          <iframe
            v-if="isPdf"
            :src="existing.fileUrl"
            class="w-full h-full rounded border"
            title="Certification PDF"
          />
          <img
            v-else
            :src="existing.fileUrl"
            alt="Certification"
            class="w-full h-full object-contain rounded border"
          />
        </div>
        <template #footer>
          <a :href="existing.fileUrl" target="_blank" rel="noopener" class="text-sm">
            Open in new tab →
          </a>
        </template>
      </Dialog>
    </template>

    <!-- EMPTY STATE + EDIT MODE: the same form drives both initial upload
         and editing an existing cert's metadata. `editing` toggles the
         action footer (Upload vs Save/Cancel). -->
    <template v-else>
      <p v-if="!editing" class="text-xs text-[color:var(--bs-muted)] mt-1">
        Upload one current credential that proves you can work as a {{ tradeLabel(trade).toLowerCase() }} in Canada — a Red Seal or provincial Certificate of Qualification works best. PDF or photo, both sides if your card has them. No formal credential? Pick the last option in the list.
      </p>
      <p v-else class="text-xs text-[color:var(--bs-muted)] mt-1">
        Update the details for this credential. To swap the uploaded file itself, cancel and use Remove + upload again.
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
            Choose the closest match. Pick <em>Other</em> for an unlisted credential, or the
            last option to declare you don't have one.
          </p>
          <InputText
            v-if="selectedPreset === OTHER_CERT"
            v-model="customCertName"
            placeholder="Name of your credential (e.g. Journeyperson Certificate)"
            class="mt-2 w-full"
          />
        </div>

        <!-- Standard upload flow -->
        <template v-if="!isNoCertSelected">
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

          <div class="flex items-center justify-between pt-1 gap-2 flex-wrap">
            <template v-if="!editing">
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
            </template>
            <template v-else>
              <Button label="Cancel" text @click="cancelEdit" />
              <Button
                icon="pi pi-check"
                label="Save changes"
                :disabled="!canPickFile"
                :loading="saving"
                @click="saveEdit"
              />
            </template>
          </div>
        </template>

        <!-- "No certification" declaration flow -->
        <template v-else>
          <Message severity="warn" :closable="false">
            By declaring no formal certification, the vetting team will review your
            application manually. You may need to provide references or proof of
            past work before being approved. Trades like Plumber and Electrician
            typically require a credential to operate legally in Canada.
          </Message>
          <div class="flex justify-end">
            <Button
              icon="pi pi-flag"
              label="Mark as no certification"
              :loading="uploading"
              @click="submitNoCertDeclaration"
            />
          </div>
        </template>
      </div>
    </template>
    </div>
  </details>
</template>
