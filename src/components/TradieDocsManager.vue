<script setup lang="ts">
import { onMounted, ref } from "vue";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Message from "primevue/message";
import {
  createCertification,
  deleteCertification,
  listCertsFor,
} from "@/firebase/services/certifications";
import {
  deleteIdVerification,
  getIdVerification,
  submitIdVerification,
} from "@/firebase/services/idVerifications";
import { getInsurance } from "@/firebase/services/insuranceVerifications";
import { getWsib } from "@/firebase/services/wsibVerifications";
import { uploadFile, uploadFileNoUrl, makeStoragePath } from "@/firebase/services/storage";
import { getTradesperson } from "@/firebase/services/tradespeople";
import type {
  CertificationDoc,
  IdDocType,
  IdVerificationDoc,
  InsuranceVerificationDoc,
  WithId,
  WsibVerificationDoc,
} from "@/firebase/interfaces";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables/useFormatters";
import CertUploadCard from "@/components/CertUploadCard.vue";
import IdUploadCard from "@/components/IdUploadCard.vue";
import InsuranceUploadCard from "@/components/InsuranceUploadCard.vue";
import WsibUploadCard from "@/components/WsibUploadCard.vue";

const props = defineProps<{
  tradieUid: string;
}>();

const toast = useToast();
const { date } = useFormatters();

const trades = ref<string[]>([]);
const certs = ref<WithId<CertificationDoc>[]>([]);
const idDoc = ref<WithId<IdVerificationDoc> | null>(null);
const insuranceDoc = ref<WithId<InsuranceVerificationDoc> | null>(null);
const wsibDoc = ref<WithId<WsibVerificationDoc> | null>(null);
const loading = ref(true);
const showIdReupload = ref(false);

async function load() {
  loading.value = true;
  const [t, certList, idData, insData, wsibData] = await Promise.all([
    getTradesperson(props.tradieUid),
    listCertsFor(props.tradieUid),
    getIdVerification(props.tradieUid),
    getInsurance(props.tradieUid),
    getWsib(props.tradieUid),
  ]);
  trades.value = t?.trades ?? [];
  certs.value = certList;
  idDoc.value = idData;
  insuranceDoc.value = insData;
  wsibDoc.value = wsibData;
  showIdReupload.value = !idData;
  loading.value = false;
}

onMounted(load);

async function onCertUploaded(opts: {
  trade: string;
  file: File | null;
  issuingBody: string;
  certNumber: string;
  expiresAt: string | null;
}) {
  let fileUrl = "";
  if (opts.file) {
    const path = makeStoragePath({
      scope: "tradespeople",
      id: props.tradieUid,
      bucket: "certs",
      filename: opts.file.name,
    });
    fileUrl = await uploadFile(path, opts.file);
  }
  await createCertification({
    tradespersonId: props.tradieUid,
    trade: opts.trade,
    issuingBody: opts.issuingBody,
    certNumber: opts.certNumber,
    expiresAt: opts.expiresAt ? (new Date(opts.expiresAt) as unknown as never) : null,
    fileUrl,
  });
  certs.value = await listCertsFor(props.tradieUid);
  toast.success(opts.file ? "Certification uploaded" : "Declaration recorded");
}

async function onCertDeleted(certId: string) {
  await deleteCertification(certId);
  certs.value = await listCertsFor(props.tradieUid);
  toast.success("Certification removed");
}

async function onIdUploaded(opts: { file: File; documentType: IdDocType }) {
  const path = makeStoragePath({
    scope: "tradespeople",
    id: props.tradieUid,
    bucket: "id",
    filename: opts.file.name,
  });
  const storagePath = await uploadFileNoUrl(path, opts.file);
  await submitIdVerification(props.tradieUid, storagePath, opts.documentType);
  idDoc.value = await getIdVerification(props.tradieUid);
  showIdReupload.value = false;
  toast.success("ID uploaded");
}

async function onIdRemoved() {
  await deleteIdVerification(props.tradieUid);
  idDoc.value = null;
  showIdReupload.value = true;
  toast.success("ID removed");
}

async function reloadInsurance() {
  insuranceDoc.value = await getInsurance(props.tradieUid);
}

async function reloadWsib() {
  wsibDoc.value = await getWsib(props.tradieUid);
}

const statusSeverity = {
  pending: "warn" as const,
  approved: "success" as const,
  rejected: "danger" as const,
};
</script>

<template>
  <div class="bs-card mt-4 p-5">
    <h2 class="text-lg font-semibold">Trade documents</h2>
    <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
      Manage the certifications, ID, insurance, and workers' comp clearance
      you submitted for vetting. Changes reset that document's review status
      to pending.
    </p>

    <div v-if="loading" class="bs-empty mt-4">Loading…</div>

    <template v-else>
      <h3 class="font-semibold mt-4 mb-2">Certifications</h3>
      <div v-if="!trades.length" class="bs-empty">
        Add a trade to your profile before uploading a certification.
      </div>
      <div v-else class="space-y-3">
        <CertUploadCard
          v-for="t in trades"
          :key="t"
          :trade="t"
          :existing="certs.find((c) => c.trade === t) ?? null"
          @uploaded="onCertUploaded"
          @deleted="onCertDeleted"
        />
      </div>

      <h3 class="font-semibold mt-6 mb-2">Photo ID verification</h3>
      <p class="text-sm text-[color:var(--bs-muted)]">
        Stored under strict admin-only access. Auto-deleted 90 days after approval.
      </p>

      <div v-if="idDoc && !showIdReupload" class="bs-card p-3 mt-2">
        <div class="flex items-center justify-between gap-2 flex-wrap">
          <div class="font-medium">{{ idDoc.documentType }}</div>
          <Tag :value="idDoc.status" :severity="statusSeverity[idDoc.status]" />
        </div>
        <div class="text-xs text-[color:var(--bs-muted)] mt-1">
          Submitted {{ date(idDoc.submittedAt) }}
        </div>
        <Message
          v-if="idDoc.status === 'rejected' && idDoc.rejectionReason"
          severity="error"
          :closable="false"
          class="mt-2"
        >
          Reviewer notes: {{ idDoc.rejectionReason }}
        </Message>
        <div class="mt-3">
          <Button
            icon="pi pi-replay"
            label="Re-upload ID"
            outlined
            @click="showIdReupload = true"
          />
        </div>
      </div>

      <IdUploadCard
        v-else
        :status="idDoc?.status ?? 'none'"
        class="mt-2"
        @uploaded="onIdUploaded"
        @removed="onIdRemoved"
      />
      <div v-if="idDoc && showIdReupload" class="mt-2">
        <Button
          label="Cancel"
          text
          size="small"
          @click="showIdReupload = false"
        />
      </div>

      <h3 class="font-semibold mt-6 mb-2">Insurance &amp; workers' comp</h3>
      <p class="text-sm text-[color:var(--bs-muted)]">
        Optional verifications that add trust badges to your public profile.
        Reviewed by our team within 48 hours.
      </p>
      <div class="space-y-3 mt-2">
        <InsuranceUploadCard
          :tradesperson-id="tradieUid"
          :existing="insuranceDoc"
          @submitted="reloadInsurance"
          @updated="reloadInsurance"
        />
        <WsibUploadCard
          :tradesperson-id="tradieUid"
          :existing="wsibDoc"
          @submitted="reloadWsib"
          @updated="reloadWsib"
        />
      </div>
    </template>
  </div>
</template>
