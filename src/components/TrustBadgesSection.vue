<script setup lang="ts">
import { onMounted, ref } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import Select from "primevue/select";
import Tag from "primevue/tag";
import Message from "primevue/message";
import type {
  CanadaProvince,
  InsuranceVerificationDoc,
  WithId,
  WsibVerificationDoc,
} from "@/firebase/interfaces";
import {
  getInsurance,
  submitInsurance,
} from "@/firebase/services/insuranceVerifications";
import { getWsib, submitWsib } from "@/firebase/services/wsibVerifications";
import { uploadFile, makeStoragePath } from "@/firebase/services/storage";
import { compressOrPassPdf } from "@/utils/image";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables/useFormatters";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{
  tradieUid: string;
}>();

const toast = useToast();
const { date } = useFormatters();

const insurance = ref<WithId<InsuranceVerificationDoc> | null>(null);
const wsib = ref<WithId<WsibVerificationDoc> | null>(null);
const loading = ref(true);

// Insurance form state
const insurer = ref("");
const policyNumber = ref("");
// Default $2M coverage in cents — most CA general-liability policies for
// trades hit either $1M or $2M; $2M is the more common minimum we'd want
// to encourage. Tradies can change before upload.
const coverageAmount = ref<number>(200_000_000);
const insuranceExpiresAt = ref<string>("");
const insuranceFileInput = ref<HTMLInputElement | null>(null);
const uploadingInsurance = ref(false);

// WSIB form state
const province = ref<CanadaProvince>("ON");
const clearanceNumber = ref("");
const wsibExpiresAt = ref<string>("");
const wsibFileInput = ref<HTMLInputElement | null>(null);
const uploadingWsib = ref(false);

const PROVINCE_OPTIONS: { label: string; value: CanadaProvince }[] = [
  { label: "Alberta (WCB-AB)", value: "AB" },
  { label: "British Columbia (WorkSafeBC)", value: "BC" },
  { label: "Manitoba (WCB-MB)", value: "MB" },
  { label: "New Brunswick (WorkSafeNB)", value: "NB" },
  { label: "Newfoundland and Labrador (WorkplaceNL)", value: "NL" },
  { label: "Nova Scotia (WCB-NS)", value: "NS" },
  { label: "Northwest Territories (WSCC)", value: "NT" },
  { label: "Nunavut (WSCC)", value: "NU" },
  { label: "Ontario (WSIB)", value: "ON" },
  { label: "Prince Edward Island (WCB-PE)", value: "PE" },
  { label: "Quebec (CNESST)", value: "QC" },
  { label: "Saskatchewan (WCB-SK)", value: "SK" },
  { label: "Yukon (YWCHSB)", value: "YT" },
];

const statusSeverity = {
  pending: "warn" as const,
  approved: "success" as const,
  rejected: "danger" as const,
};

async function load() {
  loading.value = true;
  const [i, w] = await Promise.all([getInsurance(props.tradieUid), getWsib(props.tradieUid)]);
  insurance.value = i;
  wsib.value = w;
  loading.value = false;
}

onMounted(load);

async function onInsuranceFile(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  if (!insurer.value.trim() || !policyNumber.value.trim() || !insuranceExpiresAt.value) {
    toast.warn("Please fill insurer, policy number, and expiry date first.");
    target.value = "";
    return;
  }
  if (!coverageAmount.value || coverageAmount.value < 100_000_000) {
    toast.warn("Coverage must be at least $1,000,000.");
    target.value = "";
    return;
  }
  uploadingInsurance.value = true;
  try {
    const prepared = await compressOrPassPdf(file);
    const path = makeStoragePath({
      scope: "tradespeople",
      id: props.tradieUid,
      bucket: "insurance",
      filename: prepared.name,
    });
    const url = await uploadFile(path, prepared);
    await submitInsurance(props.tradieUid, {
      fileUrl: url,
      insurer: insurer.value,
      policyNumber: policyNumber.value,
      coverageAmount: coverageAmount.value,
      expiresAt: new Date(insuranceExpiresAt.value),
    });
    toast.success("Insurance submitted", "An admin will review it shortly.");
    insurer.value = "";
    policyNumber.value = "";
    insuranceExpiresAt.value = "";
    await load();
  } catch (err) {
    toast.error("Upload failed", humanizeError(err));
  } finally {
    uploadingInsurance.value = false;
    target.value = "";
  }
}

async function onWsibFile(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  if (!clearanceNumber.value.trim() || !wsibExpiresAt.value) {
    toast.warn("Please fill clearance number and expiry date first.");
    target.value = "";
    return;
  }
  uploadingWsib.value = true;
  try {
    const prepared = await compressOrPassPdf(file);
    const path = makeStoragePath({
      scope: "tradespeople",
      id: props.tradieUid,
      bucket: "wsib",
      filename: prepared.name,
    });
    const url = await uploadFile(path, prepared);
    await submitWsib(props.tradieUid, {
      fileUrl: url,
      province: province.value,
      clearanceNumber: clearanceNumber.value,
      expiresAt: new Date(wsibExpiresAt.value),
    });
    toast.success("WSIB clearance submitted", "An admin will review it shortly.");
    clearanceNumber.value = "";
    wsibExpiresAt.value = "";
    await load();
  } catch (err) {
    toast.error("Upload failed", humanizeError(err));
  } finally {
    uploadingWsib.value = false;
    target.value = "";
  }
}
</script>

<template>
  <div class="bs-card p-5">
    <h2 class="text-lg font-semibold">Trust badges</h2>
    <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
      Optional verifications that boost client trust and show up as badges on
      your public profile. Upload once, our team reviews within 48 hours.
    </p>

    <div v-if="loading" class="mt-4 text-sm text-[color:var(--bs-muted)]">Loading…</div>

    <template v-else>
      <!-- INSURANCE -->
      <div class="mt-5 rounded-lg border border-[color:var(--bs-border)] p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="flex items-center gap-2">
              <i class="pi pi-verified text-[color:var(--bs-blue)]"></i>
              <h3 class="font-semibold">General liability insurance</h3>
            </div>
            <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
              Most clients ask. Upload your proof of insurance (commonly $1M or $2M coverage).
            </p>
          </div>
          <Tag
            v-if="insurance"
            :value="insurance.status"
            :severity="statusSeverity[insurance.status]"
          />
        </div>

        <template v-if="insurance && insurance.status !== 'rejected'">
          <dl class="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div><dt class="font-medium">Insurer</dt><dd>{{ insurance.insurer }}</dd></div>
            <div>
              <dt class="font-medium">Policy</dt>
              <dd>#{{ insurance.policyNumber }}</dd>
            </div>
            <div>
              <dt class="font-medium">Coverage</dt>
              <dd>${{ (insurance.coverageAmount / 100).toLocaleString("en-CA") }}</dd>
            </div>
            <div><dt class="font-medium">Expires</dt><dd>{{ date(insurance.expiresAt) }}</dd></div>
          </dl>
          <a
            :href="insurance.fileUrl"
            target="_blank"
            rel="noopener"
            class="text-xs text-[color:var(--bs-blue)] mt-2 inline-block"
          >View uploaded document →</a>
        </template>

        <template v-else>
          <Message
            v-if="insurance?.status === 'rejected' && insurance.rejectionReason"
            severity="warn"
            :closable="false"
            class="mt-2"
          >
            Previous submission rejected: {{ insurance.rejectionReason }}
          </Message>

          <div class="bs-form mt-3 grid sm:grid-cols-2 gap-2">
            <InputText v-model="insurer" placeholder="Insurer (e.g. Zensurance, APOLLO)" />
            <InputText v-model="policyNumber" placeholder="Policy number" />
            <InputNumber
              v-model="coverageAmount"
              :min="100_000_000"
              :max="1_000_000_000"
              :step="100_000_000"
              prefix="$"
              :format-options="{ style: 'currency', currency: 'CAD', maximumFractionDigits: 0 }"
              show-buttons
              placeholder="Coverage amount"
            />
            <input
              v-model="insuranceExpiresAt"
              type="date"
              class="border rounded p-2 text-sm"
            />
          </div>
          <div class="mt-3">
            <Button
              icon="pi pi-upload"
              label="Upload certificate (PDF or image)"
              outlined
              :loading="uploadingInsurance"
              @click="insuranceFileInput?.click()"
            />
            <input
              ref="insuranceFileInput"
              type="file"
              accept="image/*,application/pdf"
              class="hidden"
              @change="onInsuranceFile"
            />
          </div>
        </template>
      </div>

      <!-- WSIB / WCB -->
      <div class="mt-4 rounded-lg border border-[color:var(--bs-border)] p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="flex items-center gap-2">
              <i class="pi pi-shield text-[color:var(--bs-blue)]"></i>
              <h3 class="font-semibold">Workers' compensation clearance</h3>
            </div>
            <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
              Required in most provinces. Clearance certs are typically valid for 60–90 days; you'll
              need to re-upload when yours expires.
            </p>
          </div>
          <Tag v-if="wsib" :value="wsib.status" :severity="statusSeverity[wsib.status]" />
        </div>

        <template v-if="wsib && wsib.status !== 'rejected'">
          <dl class="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div><dt class="font-medium">Province</dt><dd>{{ wsib.province }}</dd></div>
            <div>
              <dt class="font-medium">Clearance #</dt>
              <dd>{{ wsib.clearanceNumber }}</dd>
            </div>
            <div><dt class="font-medium">Expires</dt><dd>{{ date(wsib.expiresAt) }}</dd></div>
          </dl>
          <a
            :href="wsib.fileUrl"
            target="_blank"
            rel="noopener"
            class="text-xs text-[color:var(--bs-blue)] mt-2 inline-block"
          >View uploaded document →</a>
        </template>

        <template v-else>
          <Message
            v-if="wsib?.status === 'rejected' && wsib.rejectionReason"
            severity="warn"
            :closable="false"
            class="mt-2"
          >
            Previous submission rejected: {{ wsib.rejectionReason }}
          </Message>

          <div class="bs-form mt-3 grid sm:grid-cols-3 gap-2">
            <Select
              v-model="province"
              :options="PROVINCE_OPTIONS"
              option-label="label"
              option-value="value"
              class="sm:col-span-2"
            />
            <input
              v-model="wsibExpiresAt"
              type="date"
              class="border rounded p-2 text-sm"
            />
            <InputText
              v-model="clearanceNumber"
              placeholder="Clearance certificate number"
              class="sm:col-span-3"
            />
          </div>
          <div class="mt-3">
            <Button
              icon="pi pi-upload"
              label="Upload clearance certificate"
              outlined
              :loading="uploadingWsib"
              @click="wsibFileInput?.click()"
            />
            <input
              ref="wsibFileInput"
              type="file"
              accept="image/*,application/pdf"
              class="hidden"
              @change="onWsibFile"
            />
          </div>
        </template>
      </div>
    </template>
  </div>
</template>
