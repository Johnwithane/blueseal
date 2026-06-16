<script setup lang="ts">
import { computed, ref } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import NumberField from "@/components/NumberField.vue";
import DatePicker from "primevue/datepicker";
import Dialog from "primevue/dialog";
import Tag from "primevue/tag";
import Message from "primevue/message";
import type { InsuranceVerificationDoc, WithId } from "@/firebase/interfaces";
import {
  submitInsurance,
  updateInsurance,
  signInsuranceLiabilityRelease,
} from "@/firebase/services/insuranceVerifications";
import { uploadFile, makeStoragePath } from "@/firebase/services/storage";
import { compressOrPassPdf } from "@/utils/image";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables/useFormatters";
import { INSURANCE_PARTNER } from "@/data/insurancePartner";
import { humanizeError } from "@/utils/errors";
import { VERIFICATION_SEVERITY } from "@/utils/verificationStatus";
import InsuranceLiabilityReleaseDialog from "@/components/InsuranceLiabilityReleaseDialog.vue";

const props = defineProps<{
  tradespersonId: string;
  existing: WithId<InsuranceVerificationDoc> | null;
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
const insurer = ref("");
const policyNumber = ref("");
// Coverage in millions of dollars — most CA general-liability policies are
// $1M / $2M / $5M. Stored server-side in cents, so we multiply by
// 100_000_000 on submit.
const coverageMillions = ref<number | null>(2);
const expiresAt = ref<Date | null>(null);
// The tradesperson's declaration: is Blue Seal named as an additional insured?
// null until they pick. "No" routes them to sign the liability release.
const blueSealAdditionalInsured = ref<boolean | null>(null);
const showReleaseDialog = ref(false);
const signingRelease = ref(false);
const submitting = ref(false);
const viewerOpen = ref(false);
// Toggled by Edit details on an existing pending doc. The form is shared
// between empty/replace/edit; the action footer differs.
const editing = ref(false);
// Toggled by Replace on an uploaded doc. Shows the form pre-blank so the
// owner can submit a fresh upload (a new setDoc overwrite, same as create).
const replacing = ref(false);


const hasUpload = computed(() => props.existing != null);
// Partial state: they declared Blue Seal is NOT named but haven't signed the
// release yet (e.g. they closed the dialog). Surfaces a "finish this" CTA.
const needsRelease = computed(
  () =>
    props.existing?.status === "pending" &&
    props.existing.blueSealAdditionalInsured === false &&
    !props.existing.liabilityRelease,
);
const coverageDollarsLabel = computed(() => {
  const c = props.existing?.coverageAmount;
  if (c == null) return "";
  return `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
});

const isPdf = computed(() => {
  const url = props.existing?.fileUrl ?? "";
  return url.toLowerCase().includes(".pdf");
});

const isEditingExisting = computed(() => editing.value && hasUpload.value);
const showForm = computed(
  () => !hasUpload.value || replacing.value || isEditingExisting.value,
);

// Default-open the card when there's nothing uploaded yet, when the prior
// submission was rejected (needs attention), or while the user is editing /
// replacing. Pending and approved collapse so the docs list stays compact.
const defaultOpen = computed(
  () =>
    !props.existing ||
    props.existing.status === "rejected" ||
    editing.value ||
    replacing.value,
);

function resetForm() {
  insurer.value = "";
  policyNumber.value = "";
  coverageMillions.value = 2;
  expiresAt.value = null;
  blueSealAdditionalInsured.value = null;
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
  insurer.value = props.existing.insurer;
  policyNumber.value = props.existing.policyNumber;
  coverageMillions.value = props.existing.coverageAmount / 100_000_000;
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
    insurer.value.trim().length > 0 &&
    policyNumber.value.trim().length > 0 &&
    coverageMillions.value != null &&
    coverageMillions.value > 0 &&
    expiresAt.value != null &&
    blueSealAdditionalInsured.value != null,
);

const canSaveEdit = computed(
  () =>
    insurer.value.trim().length > 0 &&
    policyNumber.value.trim().length > 0 &&
    coverageMillions.value != null &&
    coverageMillions.value > 0 &&
    expiresAt.value != null,
);

async function submit() {
  if (
    !canSubmitUpload.value ||
    !pickedFile.value ||
    !expiresAt.value ||
    coverageMillions.value == null ||
    blueSealAdditionalInsured.value == null
  ) {
    return;
  }
  const additionalInsured = blueSealAdditionalInsured.value;
  submitting.value = true;
  try {
    const path = makeStoragePath({
      scope: "tradespeople",
      id: props.tradespersonId,
      bucket: "insurance",
      filename: pickedFile.value.name,
    });
    const fileUrl = await uploadFile(path, pickedFile.value);
    await submitInsurance(props.tradespersonId, {
      fileUrl,
      insurer: insurer.value,
      policyNumber: policyNumber.value,
      coverageAmount: Math.round(coverageMillions.value * 100_000_000),
      expiresAt: expiresAt.value,
      blueSealAdditionalInsured: additionalInsured,
    });
    resetForm();
    replacing.value = false;
    emit("submitted");
    if (!additionalInsured) {
      // Blue Seal isn't named — the submission isn't complete until they sign
      // the liability release. The dialog is mounted at the card root, so it
      // works after the form collapses.
      toast.success("Insurance submitted", "One more step — sign the liability release.");
      showReleaseDialog.value = true;
    } else {
      toast.success("Insurance submitted", "We'll verify Blue Seal is named on your certificate.");
    }
  } catch (err) {
    toast.error("Upload failed", humanizeError(err));
  } finally {
    submitting.value = false;
  }
}

async function onSignRelease(signatureDataUrl: string) {
  if (signingRelease.value) return;
  signingRelease.value = true;
  try {
    await signInsuranceLiabilityRelease(signatureDataUrl);
    showReleaseDialog.value = false;
    toast.success("Release signed", "Thanks — your insurance submission is complete.");
    emit("submitted");
  } catch (err) {
    toast.error("Couldn't sign the release", humanizeError(err));
  } finally {
    signingRelease.value = false;
  }
}

async function saveEdit() {
  if (
    !props.existing ||
    !canSaveEdit.value ||
    !expiresAt.value ||
    coverageMillions.value == null
  ) {
    return;
  }
  submitting.value = true;
  try {
    await updateInsurance(props.tradespersonId, {
      insurer: insurer.value,
      policyNumber: policyNumber.value,
      coverageAmount: Math.round(coverageMillions.value * 100_000_000),
      expiresAt: expiresAt.value,
    });
    toast.success("Insurance details updated");
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
      <div class="font-semibold">General-liability insurance</div>
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
            Insurer
          </div>
          <div>{{ existing.insurer }}</div>
        </div>
        <div>
          <div class="text-xs text-[color:var(--bs-muted)] uppercase tracking-wide">
            Policy number
          </div>
          <div>{{ existing.policyNumber }}</div>
        </div>
        <div>
          <div class="text-xs text-[color:var(--bs-muted)] uppercase tracking-wide">
            Coverage
          </div>
          <div>{{ coverageDollarsLabel }}</div>
        </div>
        <div>
          <div class="text-xs text-[color:var(--bs-muted)] uppercase tracking-wide">
            Expires
          </div>
          <div>{{ date(existing.expiresAt) }}</div>
        </div>
        <div v-if="existing.blueSealAdditionalInsured !== undefined">
          <div class="text-xs text-[color:var(--bs-muted)] uppercase tracking-wide">
            Blue Seal on policy
          </div>
          <div v-if="existing.blueSealAdditionalInsured">
            Named as additional insured<span v-if="existing.additionalInsuredConfirmedAt"> · verified</span>
          </div>
          <div v-else>
            Not named ·
            {{ existing.liabilityRelease ? "liability release signed" : "release pending" }}
          </div>
        </div>
        <Message v-if="needsRelease" severity="warn" :closable="false">
          Your policy doesn't name Blue Seal — sign the liability release to
          complete your submission.
        </Message>
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
          Insurance is reviewed — editing isn't available. Use Replace to
          upload a new certificate (e.g. when your policy renews).
        </Message>
      </div>

      <div class="mt-3 flex items-center gap-2 flex-wrap">
        <Button
          v-if="needsRelease"
          icon="pi pi-pencil"
          label="Sign liability release"
          severity="warn"
          @click="showReleaseDialog = true"
        />
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

      <Dialog
        v-model:visible="viewerOpen"
        modal
        header="General-liability insurance"
        :style="{ width: '90vw', maxWidth: '900px' }"
      >
        <div class="w-full" style="height: 70vh">
          <iframe
            v-if="isPdf"
            :src="existing.fileUrl"
            class="w-full h-full rounded border"
            title="Insurance PDF"
          />
          <img
            v-else
            :src="existing.fileUrl"
            alt="Insurance certificate"
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

    <!-- EMPTY STATE + EDIT MODE + REPLACE MODE -->
    <template v-else>
      <p class="text-xs text-[color:var(--bs-muted)] mt-1">
        <template v-if="isEditingExisting">
          Update the details on your current submission. To swap the
          uploaded file itself, cancel and use Replace instead.
        </template>
        <template v-else>
          Optional — adds a verified "Insured" badge to your public profile.
          Most clients ask. PDF or image; common coverage is $1M or $2M.
        </template>
      </p>

      <a
        v-if="!isEditingExisting"
        :href="INSURANCE_PARTNER.url"
        target="_blank"
        rel="noopener"
        class="ins-get-covered mt-3"
      >
        <i class="pi pi-shield" aria-hidden="true"></i>
        <span>
          Don't have coverage yet? Get covered in minutes with
          {{ INSURANCE_PARTNER.name }}
        </span>
        <i class="pi pi-external-link ins-get-covered__ext" aria-hidden="true"></i>
      </a>

      <div class="bs-form space-y-3 mt-3">
        <div>
          <label class="text-sm font-medium">Insurer</label>
          <InputText
            v-model="insurer"
            class="mt-1 w-full"
            placeholder="e.g. Northbridge, Zensurance, APOLLO"
          />
        </div>
        <div>
          <label class="text-sm font-medium">Policy number</label>
          <InputText v-model="policyNumber" class="mt-1 w-full" />
        </div>
        <div>
          <label class="text-sm font-medium">Coverage amount (CAD millions)</label>
          <NumberField
            v-model="coverageMillions"
            :min="0"
            :max="50"
            :max-fraction-digits="1"
            suffix="M"
            class="mt-1 w-full"
          />
          <p class="text-xs text-[color:var(--bs-muted)] mt-1">
            $1M is the typical minimum; $2M is common for general trades.
          </p>
        </div>
        <div>
          <label class="text-sm font-medium">Policy expiry</label>
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
              :label="pickedFileName ? `Selected: ${pickedFileName}` : 'Choose certificate file (PDF or image)'"
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

          <div class="rounded-md border border-[color:var(--bs-border)] p-3">
            <div class="text-sm font-medium">
              Is Blue Seal named as an additional insured on this policy?
            </div>
            <p class="text-xs text-[color:var(--bs-muted)] mt-1">
              "Additional insured" means your policy actually covers Blue Seal — a
              "certificate holder" does not. It's automatic on a Blue Seal partner
              policy. If Blue Seal isn't named, you'll sign a short liability
              release next.
            </p>
            <div class="mt-2 flex flex-col gap-2">
              <label class="flex items-center gap-2 text-sm">
                <input
                  v-model="blueSealAdditionalInsured"
                  type="radio"
                  name="bs-additional-insured"
                  :value="true"
                />
                Yes — Blue Seal is named as an additional insured
              </label>
              <label class="flex items-center gap-2 text-sm">
                <input
                  v-model="blueSealAdditionalInsured"
                  type="radio"
                  name="bs-additional-insured"
                  :value="false"
                />
                No / not sure — I'll sign the liability release
              </label>
            </div>
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

    <InsuranceLiabilityReleaseDialog
      v-model:visible="showReleaseDialog"
      :busy="signingRelease"
      @confirm="onSignRelease"
    />
  </details>
</template>

<style scoped>
.ins-get-covered {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid color-mix(in srgb, var(--bs-blue) 25%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--bs-blue) 6%, transparent);
  color: var(--bs-blue-dark);
  font-size: 0.82rem;
  font-weight: 600;
  line-height: 1.3;
  transition: background 0.15s ease;
}
.ins-get-covered:hover {
  background: color-mix(in srgb, var(--bs-blue) 12%, transparent);
}
.ins-get-covered .pi-shield {
  flex: none;
}
.ins-get-covered__ext {
  margin-left: auto;
  flex: none;
  font-size: 0.72rem;
  opacity: 0.7;
}
</style>
