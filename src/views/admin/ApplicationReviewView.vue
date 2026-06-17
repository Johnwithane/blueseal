<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Textarea from "primevue/textarea";
import Dialog from "primevue/dialog";
import Checkbox from "primevue/checkbox";
import { getTradesperson, getTradespersonContact } from "@/firebase/services/tradespeople";
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
import { registryForIssuingBody } from "@/utils/certRegistries";
import { VERIFICATION_SEVERITY, VERIFICATION_LABEL } from "@/utils/verificationStatus";
import LoadingState from "@/components/LoadingState.vue";
import RejectReasonDialog from "@/components/RejectReasonDialog.vue";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toast = useToast();
const { date } = useFormatters();

const uid = route.params.uid as string;
const tradie = ref<WithId<TradespersonDoc> | null>(null);
// Service-area address is private (tradespeople/{uid}/private/contact); admin
// fetches it separately for the review screen.
const tradieAddress = ref<string>("");
const certs = ref<WithId<CertificationDoc>[]>([]);
const idDoc = ref<WithId<IdVerificationDoc> | null>(null);
// The tradesperson's client stores ID as a Storage path (admin-only-read
// rules block `getDownloadURL` on the owner's session). Resolve to a URL
// here on the admin's session and render that.
const idFileUrl = ref<string | null>(null);
const insurance = ref<WithId<InsuranceVerificationDoc> | null>(null);
const wsib = ref<WithId<WsibVerificationDoc> | null>(null);
const loading = ref(true);

// Admin must tick this — confirming the certificate actually names Blue Seal as
// an additional insured — before approving a submission that declares it does.
const additionalInsuredConfirmed = ref(false);
const insDeclaredAdditionalInsured = computed(
  () => insurance.value?.blueSealAdditionalInsured === true,
);
const insReleaseSigned = computed(() => !!insurance.value?.liabilityRelease);
// Docs predating the additional-insured field: approve as before (no new gate).
const insLegacy = computed(
  () => insurance.value != null && insurance.value.blueSealAdditionalInsured === undefined,
);
// Approve only once Blue Seal is protected: cert confirmed (declared named) or
// the liability release is on file (declared not named). Legacy docs pass.
const canApproveInsurance = computed(() => {
  if (insLegacy.value) return true;
  if (insDeclaredAdditionalInsured.value) return additionalInsuredConfirmed.value;
  return insReleaseSigned.value;
});

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
  tradieAddress.value = (await getTradespersonContact(uid))?.primaryAddressText ?? "";
  const [certList, idData, insuranceData, wsibData] = await Promise.all([
    listCertsFor(uid),
    getIdVerification(uid),
    getInsurance(uid),
    getWsib(uid),
  ]);
  certs.value = certList;
  idDoc.value = idData;
  insurance.value = insuranceData;
  additionalInsuredConfirmed.value = false;
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
  if (!auth.fbUser || !canApproveInsurance.value) return;
  await approveInsurance(uid, auth.fbUser.uid, {
    additionalInsuredConfirmed: insDeclaredAdditionalInsured.value,
  });
  toast.success("Insurance approved");
  await load();
}

// Open the server-stored release signature so the admin can verify it's a real
// signed release before approving a "not named" submission.
async function viewReleaseSignature() {
  const path = insurance.value?.liabilityRelease?.signatureStoragePath;
  if (!path) return;
  const url = await resolveFileUrl(path).catch(() => null);
  if (url) openViewer(url, "Liability release signature");
  else toast.error("Couldn't open the signature");
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


async function copyCertNumber(certNumber: string) {
  try {
    await navigator.clipboard.writeText(certNumber);
    toast.info("Copied", `Cert # ${certNumber} copied to clipboard.`);
  } catch {
    toast.error("Copy failed", "Select and copy the cert # manually.");
  }
}

// "Approve everything" is the one-click happy path: flips every pending cert
// + the pending ID + the application all in one callable, then makes the
// profile live. Per-item approve/reject buttons remain for cases where the
// admin wants to selectively reject before bulk-approving the rest.
// Disabled only if there's nothing on file to approve.
const canApproveApplication = computed(
  () => !!idDoc.value && certs.value.length > 0,
);
const approveBlockerHint = computed(() => {
  if (!idDoc.value && certs.value.length === 0) return "No ID or certifications on file yet.";
  if (!idDoc.value) return "No ID document on file yet.";
  if (certs.value.length === 0) return "No certifications on file yet.";
  return "";
});
</script>

<template>
  <section class="bs-container py-6">
    <RouterLink to="/admin/vetting" class="text-xs text-[color:var(--bs-muted)]">← Queue</RouterLink>

    <LoadingState v-if="loading" class="mt-4" />
    <template v-else-if="tradie">
      <header class="mt-2 mb-4 flex flex-wrap items-center justify-between gap-2">
        <div class="text-sm text-[color:var(--bs-muted)]">
          <code>{{ uid }}</code>
        </div>
        <RouterLink :to="{ name: 'AdminUserDetail', params: { uid } }" class="text-sm text-[color:var(--bs-blue)] hover:underline">
          View full account →
        </RouterLink>
      </header>

      <div class="grid lg:grid-cols-3 gap-4">
        <!-- Profile preview -->
        <section class="bs-card p-4 lg:col-span-1">
          <h2 class="font-semibold mb-2">Profile preview</h2>
          <dl class="text-sm space-y-2">
            <div><dt class="font-medium">Trades</dt><dd>{{ tradie.trades.map(tradeLabel).join(", ") }}</dd></div>
            <div><dt class="font-medium">Bio</dt><dd class="whitespace-pre-wrap">{{ tradie.bio }}</dd></div>
            <div><dt class="font-medium">Service area</dt><dd>{{ tradieAddress }} ({{ tradie.serviceRadiusKm }} km)</dd></div>
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
              <Tag :value="VERIFICATION_LABEL[c.status]" :severity="VERIFICATION_SEVERITY[c.status]" />
            </div>
            <div class="text-xs text-[color:var(--bs-muted)]">
              {{ c.issuingBody }} • #{{ c.certNumber }}
            </div>
            <!-- Verify-on-registry helper. Direct link for jurisdictions with
                 public lookup tools (AB/BC/ON-compulsory); Red Seal hub for
                 Red Seal endorsements (province-issued); hidden when there's
                 no known registry to point at. -->
            <div
              v-if="registryForIssuingBody(c.issuingBody)"
              class="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="font-medium text-slate-700">
                    Verify with {{ registryForIssuingBody(c.issuingBody)?.province }}
                  </div>
                  <div class="text-slate-600">
                    {{ registryForIssuingBody(c.issuingBody)?.registryName }}
                  </div>
                  <div
                    v-if="registryForIssuingBody(c.issuingBody)?.notes"
                    class="mt-1 text-[11px] text-slate-500"
                  >
                    {{ registryForIssuingBody(c.issuingBody)?.notes }}
                  </div>
                </div>
                <a
                  :href="registryForIssuingBody(c.issuingBody)?.url"
                  target="_blank"
                  rel="noopener"
                  class="shrink-0 text-[color:var(--bs-info)] underline"
                >
                  Open ↗
                </a>
              </div>
              <Button
                label="Copy cert #"
                icon="pi pi-copy"
                text
                size="small"
                class="mt-1 !p-0 !text-xs"
                @click="copyCertNumber(c.certNumber)"
              />
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
            <div v-else-if="c.rejectionReason" class="text-xs text-[color:var(--bs-danger)] mt-1">
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
              <Tag :value="VERIFICATION_LABEL[idDoc.status]" :severity="VERIFICATION_SEVERITY[idDoc.status]" />
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
            <div v-else-if="idDoc.rejectionReason" class="text-xs text-[color:var(--bs-danger)] mt-1">
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
              :value="VERIFICATION_LABEL[insurance.status]"
              :severity="VERIFICATION_SEVERITY[insurance.status]"
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

            <!-- Additional-insured protection: the tradesperson's declaration +
                 the admin's verification step. -->
            <div class="mt-3 text-sm">
              <dt class="font-medium inline">Blue Seal on policy:</dt>
              <template v-if="insurance.blueSealAdditionalInsured === undefined">
                — (submitted before this was tracked)
              </template>
              <template v-else-if="insurance.blueSealAdditionalInsured">
                declared as additional insured<span
                  v-if="insurance.additionalInsuredConfirmedAt"
                  class="text-[color:var(--bs-success-text)]"
                >
                  · verified</span
                >
              </template>
              <template v-else>
                not named — liability release
                <span :class="insurance.liabilityRelease ? '' : 'text-[color:var(--bs-danger)]'">
                  {{ insurance.liabilityRelease ? "signed" : "NOT signed yet" }}
                </span>
              </template>
            </div>

            <!-- Declared "Blue Seal is named" → admin verifies the certificate. -->
            <label
              v-if="insurance.status === 'pending' && insurance.blueSealAdditionalInsured === true"
              class="mt-2 flex items-start gap-2 text-sm"
            >
              <Checkbox v-model="additionalInsuredConfirmed" binary />
              <span>
                I've checked the certificate — Blue Seal is named as an additional
                insured on this policy.
              </span>
            </label>

            <!-- Declared "not named" → view the signed release before approving. -->
            <div
              v-else-if="insurance.status === 'pending' && insurance.blueSealAdditionalInsured === false"
              class="mt-2"
            >
              <Button
                v-if="insurance.liabilityRelease"
                icon="pi pi-eye"
                label="View liability release signature"
                outlined
                size="small"
                @click="viewReleaseSignature"
              />
              <p v-else class="text-xs text-[color:var(--bs-danger)]">
                Liability release not signed yet — can't approve until the
                tradesperson signs it.
              </p>
            </div>

            <div v-if="insurance.status === 'pending'" class="flex gap-2 mt-2">
              <Button
                label="Approve"
                icon="pi pi-check"
                severity="success"
                size="small"
                :disabled="!canApproveInsurance"
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
            <div v-else-if="insurance.rejectionReason" class="text-xs text-[color:var(--bs-danger)] mt-1">
              {{ insurance.rejectionReason }}
            </div>
          </template>
        </section>

        <section class="bs-card p-4">
          <div class="flex items-center justify-between mb-2">
            <h2 class="font-semibold">WSIB / workers' comp</h2>
            <Tag v-if="wsib" :value="VERIFICATION_LABEL[wsib.status]" :severity="VERIFICATION_SEVERITY[wsib.status]" />
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
            <div v-else-if="wsib.rejectionReason" class="text-xs text-[color:var(--bs-danger)] mt-1">
              {{ wsib.rejectionReason }}
            </div>
          </template>
        </section>
      </div>

      <!-- Decision bar -->
      <footer class="bs-card p-4 mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div class="text-sm text-[color:var(--bs-muted)]">
          <template v-if="canApproveApplication">
            One click approves every pending cert + ID and sets their profile <strong>live</strong>.
          </template>
          <template v-else>
            {{ approveBlockerHint }}
          </template>
        </div>
        <div class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Button label="Request info" icon="pi pi-question-circle" outlined class="w-full sm:w-auto" @click="showRequestInfo = true; notesInput = ''" />
          <Button label="Reject" icon="pi pi-ban" severity="danger" outlined class="w-full sm:w-auto" @click="showReject = true; notesInput = ''" />
          <Button
            label="Approve everything"
            icon="pi pi-check"
            severity="success"
            :disabled="!canApproveApplication"
            class="col-span-2 w-full sm:col-span-1 sm:w-auto"
            @click="approveAll"
          />
        </div>
      </footer>
    </template>

    <Dialog v-model:visible="showRequestInfo" modal header="Request more information" :style="{ width: '32rem', maxWidth: '92vw' }">
      <Textarea v-model="notesInput" rows="5" class="w-full" placeholder="What do they need to fix?" />
      <template #footer>
        <Button label="Cancel" text @click="showRequestInfo = false" />
        <Button label="Send request" icon="pi pi-send" :disabled="!notesInput" @click="submitRequestInfo" />
      </template>
    </Dialog>

    <Dialog v-model:visible="showReject" modal header="Reject application" :style="{ width: '32rem', maxWidth: '92vw' }">
      <Textarea v-model="notesInput" rows="5" class="w-full" placeholder="Reason (sent to applicant)" maxlength="2000" />
      <template #footer>
        <Button label="Cancel" text @click="showReject = false" />
        <Button label="Reject" icon="pi pi-ban" severity="danger" :disabled="!notesInput.trim()" @click="submitReject" />
      </template>
    </Dialog>

    <RejectReasonDialog
      v-model:visible="showRejectCert"
      v-model:reason="rejectReason"
      header="Reject certification"
      @confirm="confirmRejectCert"
    />

    <RejectReasonDialog
      v-model:visible="showRejectId"
      v-model:reason="rejectReason"
      header="Reject ID"
      @confirm="confirmRejectId"
    />

    <RejectReasonDialog
      v-model:visible="showRejectInsurance"
      v-model:reason="rejectReason"
      header="Reject insurance"
      @confirm="confirmRejectInsurance"
    />

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

    <RejectReasonDialog
      v-model:visible="showRejectWsib"
      v-model:reason="rejectReason"
      header="Reject WSIB"
      @confirm="confirmRejectWsib"
    />
  </section>
</template>
