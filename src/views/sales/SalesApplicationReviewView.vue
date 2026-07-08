<script setup lang="ts">
import { onMounted, ref, computed } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import Button from "primevue/button";
import Textarea from "primevue/textarea";
import Dialog from "primevue/dialog";
import Tag from "primevue/tag";
import Message from "primevue/message";
import {
  getApplicationDetails,
  approveApplication,
  requestApplicationInfo,
  rejectApplication,
  type RepApplicationDetail,
} from "@/firebase/services/repVetting";
import { tradeLabel } from "@/data/trades";
import { NO_CERT_SENTINEL } from "@/firebase/services/certifications";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import { registryForIssuingBody } from "@/utils/certRegistries";
import LoadingState from "@/components/LoadingState.vue";

// Rep-facing review of one owned application: tradesperson summary, their
// certifications + ID (signed document links), and the three decisions. The
// server re-checks ownership on every call. "Approve" approves all certs + ID
// and takes the tradesperson live (same one-click as the admin flow).
const route = useRoute();
const router = useRouter();
const toast = useToast();
const uid = route.params.uid as string;

const detail = ref<RepApplicationDetail | null>(null);
const loading = ref(true);
const busy = ref(false);

const showInfo = ref(false);
const infoNotes = ref("");
const showReject = ref(false);
const rejectReason = ref("");
// Approve is the one irreversible-feeling action (takes the tradesperson live);
// reject/request-info already confirm via dialog, approve did not (P1-06).
const showApproveConfirm = ref(false);

const hasSelfDeclaredCredential = computed(() =>
  (detail.value?.certifications ?? []).some(
    (c) => c.issuingBody === "Self-declared" || c.certNumber === NO_CERT_SENTINEL,
  ),
);

onMounted(load);
async function load() {
  loading.value = true;
  try {
    detail.value = await getApplicationDetails(uid);
  } catch (e) {
    toast.error("Couldn't load", humanizeError(e));
  } finally {
    loading.value = false;
  }
}

function statusSeverity(s: string): "success" | "danger" | "warn" {
  return s === "approved" ? "success" : s === "rejected" ? "danger" : "warn";
}

function fmtDate(ms: number | null): string {
  return ms ? new Date(ms).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" }) : "—";
}
function fmtMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-CA")}`;
}

// Inline watermarked document viewer — same tooling admin has, so a full vetter
// reviews docs in place instead of raw new-tab links (P3-08). `watermark` overlays
// "REP VIEW ONLY" on sensitive docs (ID + the liability-release signature).
const viewer = ref<{ url: string; title: string; watermark: boolean } | null>(null);
const viewerIsPdf = computed(() => viewer.value?.url.toLowerCase().includes(".pdf") ?? false);
function openViewer(url: string | null | undefined, title: string, watermark = false) {
  if (!url) return;
  viewer.value = { url, title, watermark };
}

async function doApprove() {
  busy.value = true;
  try {
    await approveApplication(uid);
    toast.success("Approved", "The tradesperson can now go live.");
    router.replace("/sales/applications");
  } catch (e) {
    toast.error("Couldn't approve", humanizeError(e));
  } finally {
    busy.value = false;
    showApproveConfirm.value = false;
  }
}
async function doRequestInfo() {
  if (!infoNotes.value.trim()) return;
  busy.value = true;
  try {
    await requestApplicationInfo(uid, infoNotes.value.trim());
    toast.success("Sent", "We asked them for more info.");
    router.replace("/sales/applications");
  } catch (e) {
    toast.error("Couldn't send", humanizeError(e));
  } finally {
    busy.value = false;
    showInfo.value = false;
  }
}
async function doReject() {
  if (!rejectReason.value.trim()) return;
  busy.value = true;
  try {
    await rejectApplication(uid, rejectReason.value.trim());
    toast.success("Rejected", "We let them know.");
    router.replace("/sales/applications");
  } catch (e) {
    toast.error("Couldn't reject", humanizeError(e));
  } finally {
    busy.value = false;
    showReject.value = false;
  }
}
</script>

<template>
  <section class="bs-container py-8 max-w-2xl">
    <RouterLink to="/sales/applications" class="text-xs text-[color:var(--bs-muted)]">
      ← Applications
    </RouterLink>

    <LoadingState v-if="loading" class="mt-6" />

    <template v-else-if="detail">
      <header class="mt-2 mb-4">
        <h1 class="text-lg font-semibold">{{ detail.tradie.displayName || "Applicant" }}</h1>
        <p class="text-sm text-[color:var(--bs-muted)] mt-1">
          {{ detail.tradie.trades.map((t) => tradeLabel(t)).filter(Boolean).join(", ") || "—" }}
        </p>
      </header>

      <p v-if="detail.tradie.bio" class="text-sm mb-4">{{ detail.tradie.bio }}</p>

      <!-- Certifications -->
      <h2 class="text-sm font-semibold mb-2">Certifications</h2>
      <div v-if="!detail.certifications.length" class="text-sm text-[color:var(--bs-muted)] mb-4">
        No certifications on file.
      </div>
      <div v-else class="space-y-2 mb-5">
        <div v-for="c in detail.certifications" :key="c.id" class="bs-card p-3">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="text-sm font-medium">{{ tradeLabel(c.trade) || c.trade }}</div>
              <div class="text-xs text-[color:var(--bs-muted)] truncate">
                {{ c.issuingBody || "—" }}<span v-if="c.certNumber"> · #{{ c.certNumber }}</span>
              </div>
            </div>
            <Tag :value="c.status" :severity="statusSeverity(c.status)" />
          </div>

          <!-- Verify-on-registry helper (AB/BC/ON public lookups; Red Seal hub);
               hidden when there's no known registry for the issuing body. -->
          <div
            v-if="registryForIssuingBody(c.issuingBody)"
            class="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="font-medium text-slate-700">
                  Verify with {{ registryForIssuingBody(c.issuingBody)?.province }}
                </div>
                <div class="text-slate-600">{{ registryForIssuingBody(c.issuingBody)?.registryName }}</div>
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
          </div>

          <Button
            v-if="c.documentUrl"
            icon="pi pi-eye"
            label="View document"
            outlined
            size="small"
            class="mt-2"
            @click="openViewer(c.documentUrl, 'Certification — ' + (tradeLabel(c.trade) || c.trade))"
          />
        </div>
      </div>

      <!-- ID -->
      <h2 class="text-sm font-semibold mb-2">Government ID</h2>
      <div v-if="!detail.idVerification" class="text-sm text-[color:var(--bs-muted)] mb-5">
        No ID document on file.
      </div>
      <div v-else class="bs-card p-3 mb-5">
        <div class="flex items-center justify-between gap-2">
          <div class="text-sm font-medium capitalize">
            {{ (detail.idVerification.documentType || "ID").replace(/_/g, " ") }}
          </div>
          <Tag :value="detail.idVerification.status" :severity="statusSeverity(detail.idVerification.status)" />
        </div>
        <Button
          v-if="detail.idVerification.documentUrl"
          icon="pi pi-eye"
          label="View ID document"
          outlined
          size="small"
          class="mt-2"
          @click="openViewer(detail.idVerification.documentUrl, 'Government ID', true)"
        />
      </div>

      <!-- Trust badges (insurance + WSIB): read-only visibility for reps. These
           are optional badges, not gates for approving the application. -->
      <div class="grid sm:grid-cols-2 gap-3 mb-5">
        <div class="bs-card p-3">
          <div class="flex items-center justify-between mb-1">
            <h2 class="text-sm font-semibold">Insurance</h2>
            <Tag
              v-if="detail.insurance"
              :value="detail.insurance.status"
              :severity="statusSeverity(detail.insurance.status)"
            />
          </div>
          <div v-if="!detail.insurance" class="text-xs text-[color:var(--bs-muted)]">
            Not submitted (optional).
          </div>
          <template v-else>
            <dl class="text-xs space-y-0.5">
              <div><dt class="font-medium inline">Insurer:</dt> {{ detail.insurance.insurer }}</div>
              <div><dt class="font-medium inline">Policy:</dt> #{{ detail.insurance.policyNumber }}</div>
              <div><dt class="font-medium inline">Coverage:</dt> {{ fmtMoney(detail.insurance.coverageAmount) }}</div>
              <div><dt class="font-medium inline">Expires:</dt> {{ fmtDate(detail.insurance.expiresAtMs) }}</div>
            </dl>
            <div class="mt-1.5 text-xs">
              <dt class="font-medium inline">Blue Seal on policy:</dt>
              <template v-if="detail.insurance.blueSealAdditionalInsured === null">
                — (not tracked)
              </template>
              <template v-else-if="detail.insurance.blueSealAdditionalInsured">
                declared additional insured<span
                  v-if="detail.insurance.additionalInsuredConfirmedAtMs"
                  class="text-[color:var(--bs-success-text)]"
                > · verified</span>
              </template>
              <template v-else>
                not named — liability release
                <span :class="detail.insurance.liabilityReleaseSignedAtMs ? '' : 'text-[color:var(--bs-danger)]'">
                  {{ detail.insurance.liabilityReleaseSignedAtMs ? "signed" : "NOT signed yet" }}
                </span>
              </template>
            </div>
            <div class="flex flex-wrap gap-2 mt-2">
              <Button
                v-if="detail.insurance.documentUrl"
                icon="pi pi-eye"
                label="View document"
                outlined
                size="small"
                @click="openViewer(detail.insurance.documentUrl, 'Insurance — ' + detail.insurance.insurer)"
              />
              <Button
                v-if="detail.insurance.releaseSignatureUrl"
                icon="pi pi-eye"
                label="Release signature"
                outlined
                size="small"
                @click="openViewer(detail.insurance.releaseSignatureUrl, 'Liability release signature', true)"
              />
            </div>
            <div v-if="detail.insurance.rejectionReason" class="text-xs text-[color:var(--bs-danger)] mt-1">
              {{ detail.insurance.rejectionReason }}
            </div>
          </template>
        </div>

        <div class="bs-card p-3">
          <div class="flex items-center justify-between mb-1">
            <h2 class="text-sm font-semibold">WSIB / workers' comp</h2>
            <Tag v-if="detail.wsib" :value="detail.wsib.status" :severity="statusSeverity(detail.wsib.status)" />
          </div>
          <div v-if="!detail.wsib" class="text-xs text-[color:var(--bs-muted)]">
            Not submitted (optional).
          </div>
          <template v-else>
            <dl class="text-xs space-y-0.5">
              <div><dt class="font-medium inline">Province:</dt> {{ detail.wsib.province }}</div>
              <div><dt class="font-medium inline">Clearance #:</dt> {{ detail.wsib.clearanceNumber }}</div>
              <div><dt class="font-medium inline">Expires:</dt> {{ fmtDate(detail.wsib.expiresAtMs) }}</div>
            </dl>
            <Button
              v-if="detail.wsib.documentUrl"
              icon="pi pi-eye"
              label="View document"
              outlined
              size="small"
              class="mt-2"
              @click="openViewer(detail.wsib.documentUrl, 'WSIB — ' + detail.wsib.province)"
            />
            <div v-if="detail.wsib.rejectionReason" class="text-xs text-[color:var(--bs-danger)] mt-1">
              {{ detail.wsib.rejectionReason }}
            </div>
          </template>
        </div>
      </div>

      <Message severity="info" :closable="false" class="mb-4">
        Approving confirms you have checked this person's certification and ID. You are responsible
        for who you approve.
      </Message>

      <!-- Decisions -->
      <div class="flex flex-wrap gap-2">
        <Button label="Approve" icon="pi pi-check" :loading="busy" @click="showApproveConfirm = true" />
        <Button label="Request info" icon="pi pi-info-circle" outlined :disabled="busy" @click="showInfo = true" />
        <Button label="Reject" icon="pi pi-times" severity="danger" outlined :disabled="busy" @click="showReject = true" />
      </div>
    </template>

    <Dialog v-model:visible="showInfo" modal header="Request more info" class="w-[min(28rem,92vw)]">
      <p class="text-sm text-[color:var(--bs-muted)] mb-2">
        Tell them what to fix or re-upload. They'll get an email and can resubmit.
      </p>
      <Textarea v-model="infoNotes" rows="4" class="w-full" :maxlength="2000" auto-resize />
      <template #footer>
        <Button label="Cancel" text :disabled="busy" @click="showInfo = false" />
        <Button label="Send" :loading="busy" :disabled="!infoNotes.trim()" @click="doRequestInfo" />
      </template>
    </Dialog>

    <Dialog v-model:visible="showReject" modal header="Reject application" class="w-[min(28rem,92vw)]">
      <p class="text-sm text-[color:var(--bs-muted)] mb-2">Give a brief reason. They'll be notified.</p>
      <Textarea v-model="rejectReason" rows="4" class="w-full" :maxlength="2000" auto-resize />
      <template #footer>
        <Button label="Cancel" text :disabled="busy" @click="showReject = false" />
        <Button label="Reject" severity="danger" :loading="busy" :disabled="!rejectReason.trim()" @click="doReject" />
      </template>
    </Dialog>

    <Dialog v-model:visible="showApproveConfirm" modal header="Approve this application?" class="w-[min(28rem,92vw)]">
      <p class="text-sm">
        This approves every certification and ID and takes the tradesperson
        <strong>live</strong> to clients right away.
      </p>
      <Message v-if="hasSelfDeclaredCredential" severity="warn" :closable="false" class="mt-3">
        Heads up: this application includes a <strong>self-declared</strong>
        credential with no document on file. Approving vouches for an unverified
        claim. Make sure you've reviewed their references or work history first.
      </Message>
      <template #footer>
        <Button label="Cancel" text :disabled="busy" @click="showApproveConfirm = false" />
        <Button label="Approve" icon="pi pi-check" :loading="busy" @click="doApprove" />
      </template>
    </Dialog>

    <!-- Inline document viewer (PDF iframe / image) with an optional watermark. -->
    <Dialog
      :visible="viewer !== null"
      modal
      :header="viewer?.title ?? ''"
      :style="{ width: '90vw', maxWidth: '900px' }"
      @update:visible="(v: boolean) => { if (!v) viewer = null; }"
    >
      <div v-if="viewer" class="relative w-full" style="height: 70vh">
        <iframe v-if="viewerIsPdf" :src="viewer.url" class="w-full h-full rounded border" title="Document" />
        <img v-else :src="viewer.url" alt="Document" class="w-full h-full object-contain rounded border" />
        <div
          v-if="viewer.watermark"
          class="absolute inset-0 flex items-center justify-center pointer-events-none text-white/80 text-3xl font-bold rotate-[-20deg]"
          style="text-shadow: 0 0 8px rgba(0,0,0,0.6);"
        >
          REP VIEW ONLY
        </div>
      </div>
      <template #footer>
        <a v-if="viewer" :href="viewer.url" target="_blank" rel="noopener" class="text-sm">
          Open in new tab →
        </a>
      </template>
    </Dialog>
  </section>
</template>
