<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Textarea from "primevue/textarea";
import Dialog from "primevue/dialog";
import { getTradesperson } from "@/firebase/services/tradespeople";
import { listCertsFor, approveCertification, rejectCertification } from "@/firebase/services/certifications";
import { getIdVerification, approveId, rejectId } from "@/firebase/services/idVerifications";
import { resolveFileUrl } from "@/firebase/services/storage";
import {
  approveInsurance,
  getInsurance,
  rejectInsurance,
} from "@/firebase/services/insuranceVerifications";
import {
  approveWsib,
  getWsib,
  rejectWsib,
} from "@/firebase/services/wsibVerifications";
import {
  approveApplication,
  requestApplicationInfo,
  rejectApplication,
} from "@/firebase/services/admin";
import type {
  CertificationDoc,
  IdVerificationDoc,
  InsuranceVerificationDoc,
  TradespersonDoc,
  WithId,
  WsibVerificationDoc,
} from "@/firebase/interfaces";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { tradeLabel } from "@/data/trades";
import { useFormatters } from "@/composables/useFormatters";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toast = useToast();
const { date } = useFormatters();

const uid = route.params.uid as string;
const tradie = ref<WithId<TradespersonDoc> | null>(null);
const certs = ref<WithId<CertificationDoc>[]>([]);
const idDoc = ref<WithId<IdVerificationDoc> | null>(null);
// The tradesperson's client stores ID as a Storage path (admin-only-read
// rules block `getDownloadURL` on the owner's session). Resolve to a URL
// here on the admin's session and render that.
const idFileUrl = ref<string | null>(null);
const insurance = ref<WithId<InsuranceVerificationDoc> | null>(null);
const wsib = ref<WithId<WsibVerificationDoc> | null>(null);
const loading = ref(true);

const showRequestInfo = ref(false);
const showReject = ref(false);
const notesInput = ref("");

// Per-cert and ID rejection live in modals (no native prompt()).
const showRejectCert = ref(false);
const showRejectId = ref(false);
const showRejectInsurance = ref(false);
const showRejectWsib = ref(false);
const rejectCertId = ref<string | null>(null);
const rejectReason = ref("");

// Inline document viewer (PDF iframe / image). Mirrors the onboarding pattern
// in CertUploadCard so admins don't have to context-switch to a new tab.
// `watermark` overlays "ADMIN VIEW ONLY" — used for ID docs.
const viewer = ref<{ url: string; title: string; watermark: boolean } | null>(null);
const viewerIsPdf = computed(() => viewer.value?.url.toLowerCase().includes(".pdf") ?? false);

function openViewer(url: string | null | undefined, title: string, watermark = false) {
  if (!url) return;
  viewer.value = { url, title, watermark };
}

async function load() {
  loading.value = true;
  tradie.value = await getTradesperson(uid);
  const [certList, idData, insuranceData, wsibData] = await Promise.all([
    listCertsFor(uid),
    getIdVerification(uid),
    getInsurance(uid),
    getWsib(uid),
  ]);
  certs.value = certList;
  idDoc.value = idData;
  insurance.value = insuranceData;
  wsib.value = wsibData;
  idFileUrl.value = idData ? await resolveFileUrl(idData.fileUrl).catch(() => null) : null;
  loading.value = false;
}

onMounted(load);

async function approveCert(certId: string) {
  if (!auth.fbUser) return;
  await approveCertification(certId, auth.fbUser.uid);
  toast.success("Certification approved");
  await load();
}

function openRejectCert(certId: string) {
  rejectCertId.value = certId;
  rejectReason.value = "";
  showRejectCert.value = true;
}

async function confirmRejectCert() {
  if (!auth.fbUser || !rejectCertId.value || !rejectReason.value.trim()) return;
  try {
    await rejectCertification(rejectCertId.value, auth.fbUser.uid, rejectReason.value.trim());
    toast.warn("Certification rejected");
    showRejectCert.value = false;
    await load();
  } catch (e) {
    toast.error("Reject failed", (e as Error).message);
  }
}

async function approveIdHere() {
  if (!auth.fbUser) return;
  await approveId(uid, auth.fbUser.uid);
  toast.success("ID approved");
  await load();
}

function openRejectId() {
  rejectReason.value = "";
  showRejectId.value = true;
}

async function confirmRejectId() {
  if (!auth.fbUser || !rejectReason.value.trim()) return;
  try {
    await rejectId(uid, auth.fbUser.uid, rejectReason.value.trim());
    toast.warn("ID rejected");
    showRejectId.value = false;
    await load();
  } catch (e) {
    toast.error("Reject failed", (e as Error).message);
  }
}

async function approveInsuranceHere() {
  if (!auth.fbUser) return;
  await approveInsurance(uid, auth.fbUser.uid);
  toast.success("Insurance approved");
  await load();
}

function openRejectInsurance() {
  rejectReason.value = "";
  showRejectInsurance.value = true;
}

async function confirmRejectInsurance() {
  if (!auth.fbUser || !rejectReason.value.trim()) return;
  try {
    await rejectInsurance(uid, auth.fbUser.uid, rejectReason.value.trim());
    toast.warn("Insurance rejected");
    showRejectInsurance.value = false;
    await load();
  } catch (e) {
    toast.error("Reject failed", (e as Error).message);
  }
}

async function approveWsibHere() {
  if (!auth.fbUser) return;
  await approveWsib(uid, auth.fbUser.uid);
  toast.success("WSIB approved");
  await load();
}

function openRejectWsib() {
  rejectReason.value = "";
  showRejectWsib.value = true;
}

async function confirmRejectWsib() {
  if (!auth.fbUser || !rejectReason.value.trim()) return;
  try {
    await rejectWsib(uid, auth.fbUser.uid, rejectReason.value.trim());
    toast.warn("WSIB rejected");
    showRejectWsib.value = false;
    await load();
  } catch (e) {
    toast.error("Reject failed", (e as Error).message);
  }
}

async function approveAll() {
  // Per design.md: callable handles email + sets isVisible/verifiedTrades via downstream triggers.
  // Callable also refuses if ID/cert aren't approved yet — surface that to the
  // admin instead of leaving an unhandled rejection in the console.
  try {
    await approveApplication({ tradieUid: uid });
    toast.success("Application approved", "Welcome email queued.");
    router.replace({ name: "AdminVetting" });
  } catch (e) {
    toast.error("Couldn't approve", (e as Error).message);
  }
}

async function submitRequestInfo() {
  await requestApplicationInfo({ tradieUid: uid, notes: notesInput.value });
  showRequestInfo.value = false;
  toast.info("Info requested", "Tradesperson has been emailed.");
  router.replace({ name: "AdminVetting" });
}

async function submitReject() {
  await rejectApplication({ tradieUid: uid, reason: notesInput.value });
  showReject.value = false;
  toast.warn("Application rejected");
  router.replace({ name: "AdminVetting" });
}

const certSeverity = {
  pending: "warn" as const,
  approved: "success" as const,
  rejected: "danger" as const,
};

// Mirrors the server-side precondition in approveApplication — disable the
// "Approve all" button until the gates are met so the admin doesn't get a
// toast error instead of an outcome.
const idApproved = computed(() => idDoc.value?.status === "approved");
const hasApprovedCert = computed(() => certs.value.some((c) => c.status === "approved"));
const canApproveApplication = computed(() => idApproved.value && hasApprovedCert.value);
const approveBlockerHint = computed(() => {
  if (idApproved.value && hasApprovedCert.value) return "";
  const missing: string[] = [];
  if (!idApproved.value) missing.push("ID");
  if (!hasApprovedCert.value) missing.push("a certification");
  return `Approve ${missing.join(" and ")} first.`;
});
</script>

<template>
  <section class="bs-container py-6">
    <RouterLink to="/admin/vetting" class="text-xs text-[color:var(--bs-muted)]">← Queue</RouterLink>

    <div v-if="loading" class="bs-empty mt-4">Loading…</div>
    <template v-else-if="tradie">
      <header class="mt-2 mb-4">
        <h1 class="text-2xl font-bold">Application review</h1>
        <div class="text-sm text-[color:var(--bs-muted)]">
          <code>{{ uid }}</code>
        </div>
      </header>

      <div class="grid lg:grid-cols-3 gap-4">
        <!-- Profile preview -->
        <section class="bs-card p-4 lg:col-span-1">
          <h2 class="font-semibold mb-2">Profile preview</h2>
          <dl class="text-sm space-y-2">
            <div><dt class="font-medium">Trades</dt><dd>{{ tradie.trades.map(tradeLabel).join(", ") }}</dd></div>
            <div><dt class="font-medium">Bio</dt><dd class="whitespace-pre-wrap">{{ tradie.bio }}</dd></div>
            <div><dt class="font-medium">Service area</dt><dd>{{ tradie.primaryAddressText }} ({{ tradie.serviceRadiusKm }} km)</dd></div>
            <div><dt class="font-medium">Pricing</dt><dd>{{ tradie.pricingModel }}{{ tradie.hourlyRate ? ` @ $${(tradie.hourlyRate/100).toFixed(2)}/hr` : "" }}</dd></div>
          </dl>
        </section>

        <!-- Certs -->
        <section class="bs-card p-4 lg:col-span-1">
          <h2 class="font-semibold mb-2">Certifications</h2>
          <div v-if="!certs.length" class="bs-empty">No certs uploaded.</div>
          <article v-for="c in certs" :key="c.id" class="border-t py-3 first:border-t-0 first:pt-0">
            <div class="flex items-center justify-between">
              <div class="font-medium">{{ tradeLabel(c.trade) }}</div>
              <Tag :value="c.status" :severity="certSeverity[c.status]" />
            </div>
            <div class="text-xs text-[color:var(--bs-muted)]">
              {{ c.issuingBody }} • #{{ c.certNumber }}
            </div>
            <Button
              icon="pi pi-eye"
              label="View document"
              outlined
              size="small"
              class="mt-2"
              @click="openViewer(c.fileUrl, tradeLabel(c.trade) + ' — certification')"
            />
            <div v-if="c.status === 'pending'" class="flex gap-2 mt-2">
              <Button label="Approve" icon="pi pi-check" severity="success" size="small" @click="approveCert(c.id)" />
              <Button label="Reject" icon="pi pi-times" severity="danger" outlined size="small" @click="openRejectCert(c.id)" />
            </div>
            <div v-else-if="c.rejectionReason" class="text-xs text-red-600 mt-1">
              {{ c.rejectionReason }}
            </div>
          </article>
        </section>

        <!-- ID -->
        <section class="bs-card p-4 lg:col-span-1 relative">
          <h2 class="font-semibold mb-2">ID verification</h2>
          <div v-if="!idDoc" class="bs-empty">No ID uploaded.</div>
          <template v-else>
            <div class="flex items-center justify-between mb-2">
              <div class="font-medium">{{ idDoc.documentType }}</div>
              <Tag :value="idDoc.status" :severity="certSeverity[idDoc.status]" />
            </div>
            <div v-if="!idFileUrl" class="bs-empty">Loading document…</div>
            <Button
              v-else
              icon="pi pi-id-card"
              label="View ID document"
              outlined
              size="small"
              @click="openViewer(idFileUrl, 'ID — ' + idDoc.documentType, true)"
            />
            <div v-if="idDoc.status === 'pending'" class="flex gap-2 mt-2">
              <Button label="Approve ID" icon="pi pi-check" severity="success" size="small" @click="approveIdHere" />
              <Button label="Reject ID" icon="pi pi-times" severity="danger" outlined size="small" @click="openRejectId" />
            </div>
            <div v-else-if="idDoc.rejectionReason" class="text-xs text-red-600 mt-1">
              {{ idDoc.rejectionReason }}
            </div>
          </template>
        </section>
      </div>

      <!-- Trust badges (insurance + WSIB). Optional verifications, not gates
           for approving the application as a whole. -->
      <div class="grid lg:grid-cols-2 gap-4 mt-4">
        <section class="bs-card p-4">
          <div class="flex items-center justify-between mb-2">
            <h2 class="font-semibold">Insurance verification</h2>
            <Tag
              v-if="insurance"
              :value="insurance.status"
              :severity="certSeverity[insurance.status]"
            />
          </div>
          <div v-if="!insurance" class="bs-empty">Not submitted (optional).</div>
          <template v-else>
            <dl class="text-sm space-y-1">
              <div><dt class="font-medium inline">Insurer:</dt> {{ insurance.insurer }}</div>
              <div><dt class="font-medium inline">Policy:</dt> #{{ insurance.policyNumber }}</div>
              <div>
                <dt class="font-medium inline">Coverage:</dt>
                ${{ (insurance.coverageAmount / 100).toLocaleString("en-CA") }}
              </div>
              <div><dt class="font-medium inline">Expires:</dt> {{ date(insurance.expiresAt) }}</div>
            </dl>
            <Button
              icon="pi pi-eye"
              label="View document"
              outlined
              size="small"
              class="mt-2"
              @click="openViewer(insurance.fileUrl, 'Insurance — ' + insurance.insurer)"
            />
            <div v-if="insurance.status === 'pending'" class="flex gap-2 mt-2">
              <Button
                label="Approve"
                icon="pi pi-check"
                severity="success"
                size="small"
                @click="approveInsuranceHere"
              />
              <Button
                label="Reject"
                icon="pi pi-times"
                severity="danger"
                outlined
                size="small"
                @click="openRejectInsurance"
              />
            </div>
            <div v-else-if="insurance.rejectionReason" class="text-xs text-red-600 mt-1">
              {{ insurance.rejectionReason }}
            </div>
          </template>
        </section>

        <section class="bs-card p-4">
          <div class="flex items-center justify-between mb-2">
            <h2 class="font-semibold">WSIB / workers' comp</h2>
            <Tag v-if="wsib" :value="wsib.status" :severity="certSeverity[wsib.status]" />
          </div>
          <div v-if="!wsib" class="bs-empty">Not submitted (optional).</div>
          <template v-else>
            <dl class="text-sm space-y-1">
              <div><dt class="font-medium inline">Province:</dt> {{ wsib.province }}</div>
              <div>
                <dt class="font-medium inline">Clearance #:</dt>
                {{ wsib.clearanceNumber }}
              </div>
              <div><dt class="font-medium inline">Expires:</dt> {{ date(wsib.expiresAt) }}</div>
            </dl>
            <Button
              icon="pi pi-eye"
              label="View document"
              outlined
              size="small"
              class="mt-2"
              @click="openViewer(wsib.fileUrl, 'WSIB — ' + wsib.province)"
            />
            <div v-if="wsib.status === 'pending'" class="flex gap-2 mt-2">
              <Button
                label="Approve"
                icon="pi pi-check"
                severity="success"
                size="small"
                @click="approveWsibHere"
              />
              <Button
                label="Reject"
                icon="pi pi-times"
                severity="danger"
                outlined
                size="small"
                @click="openRejectWsib"
              />
            </div>
            <div v-else-if="wsib.rejectionReason" class="text-xs text-red-600 mt-1">
              {{ wsib.rejectionReason }}
            </div>
          </template>
        </section>
      </div>

      <!-- Decision bar -->
      <footer class="bs-card p-4 mt-6 flex flex-wrap gap-2 items-center justify-between">
        <div class="text-sm text-[color:var(--bs-muted)]">
          <template v-if="canApproveApplication">
            Approving will set their profile <strong>live</strong> and email them.
          </template>
          <template v-else>
            {{ approveBlockerHint }}
          </template>
        </div>
        <div class="flex gap-2">
          <Button label="Request info" icon="pi pi-question-circle" outlined @click="showRequestInfo = true; notesInput = ''" />
          <Button label="Reject" icon="pi pi-ban" severity="danger" outlined @click="showReject = true; notesInput = ''" />
          <Button
            label="Approve all"
            icon="pi pi-check"
            severity="success"
            :disabled="!canApproveApplication"
            @click="approveAll"
          />
        </div>
      </footer>
    </template>

    <Dialog v-model:visible="showRequestInfo" modal header="Request more information" :style="{ width: '32rem' }">
      <Textarea v-model="notesInput" rows="5" class="w-full" placeholder="What do they need to fix?" />
      <template #footer>
        <Button label="Cancel" text @click="showRequestInfo = false" />
        <Button label="Send request" icon="pi pi-send" :disabled="!notesInput" @click="submitRequestInfo" />
      </template>
    </Dialog>

    <Dialog v-model:visible="showReject" modal header="Reject application" :style="{ width: '32rem' }">
      <Textarea v-model="notesInput" rows="5" class="w-full" placeholder="Reason (sent to applicant)" maxlength="2000" />
      <template #footer>
        <Button label="Cancel" text @click="showReject = false" />
        <Button label="Reject" icon="pi pi-ban" severity="danger" :disabled="!notesInput.trim()" @click="submitReject" />
      </template>
    </Dialog>

    <Dialog v-model:visible="showRejectCert" modal header="Reject certification" :style="{ width: '32rem' }">
      <Textarea v-model="rejectReason" rows="4" class="w-full" placeholder="Reason for rejection" maxlength="2000" />
      <template #footer>
        <Button label="Cancel" text @click="showRejectCert = false" />
        <Button label="Reject" icon="pi pi-ban" severity="danger" :disabled="!rejectReason.trim()" @click="confirmRejectCert" />
      </template>
    </Dialog>

    <Dialog v-model:visible="showRejectId" modal header="Reject ID" :style="{ width: '32rem' }">
      <Textarea v-model="rejectReason" rows="4" class="w-full" placeholder="Reason for rejection" maxlength="2000" />
      <template #footer>
        <Button label="Cancel" text @click="showRejectId = false" />
        <Button label="Reject" icon="pi pi-ban" severity="danger" :disabled="!rejectReason.trim()" @click="confirmRejectId" />
      </template>
    </Dialog>

    <Dialog v-model:visible="showRejectInsurance" modal header="Reject insurance" :style="{ width: '32rem' }">
      <Textarea v-model="rejectReason" rows="4" class="w-full" placeholder="Reason for rejection" maxlength="2000" />
      <template #footer>
        <Button label="Cancel" text @click="showRejectInsurance = false" />
        <Button label="Reject" icon="pi pi-ban" severity="danger" :disabled="!rejectReason.trim()" @click="confirmRejectInsurance" />
      </template>
    </Dialog>

    <Dialog
      :visible="viewer !== null"
      modal
      :header="viewer?.title ?? ''"
      :style="{ width: '90vw', maxWidth: '900px' }"
      @update:visible="(v) => { if (!v) viewer = null; }"
    >
      <div v-if="viewer" class="relative w-full" style="height: 70vh">
        <iframe
          v-if="viewerIsPdf"
          :src="viewer.url"
          class="w-full h-full rounded border"
          title="Document"
        />
        <img
          v-else
          :src="viewer.url"
          alt="Document"
          class="w-full h-full object-contain rounded border"
        />
        <div
          v-if="viewer.watermark"
          class="absolute inset-0 flex items-center justify-center pointer-events-none text-white/80 text-3xl font-bold rotate-[-20deg]"
          style="text-shadow: 0 0 8px rgba(0,0,0,0.6);"
        >
          ADMIN VIEW ONLY
        </div>
      </div>
      <template #footer>
        <a v-if="viewer" :href="viewer.url" target="_blank" rel="noopener" class="text-sm">
          Open in new tab →
        </a>
      </template>
    </Dialog>

    <Dialog v-model:visible="showRejectWsib" modal header="Reject WSIB" :style="{ width: '32rem' }">
      <Textarea v-model="rejectReason" rows="4" class="w-full" placeholder="Reason for rejection" maxlength="2000" />
      <template #footer>
        <Button label="Cancel" text @click="showRejectWsib = false" />
        <Button label="Reject" icon="pi pi-ban" severity="danger" :disabled="!rejectReason.trim()" @click="confirmRejectWsib" />
      </template>
    </Dialog>
  </section>
</template>
