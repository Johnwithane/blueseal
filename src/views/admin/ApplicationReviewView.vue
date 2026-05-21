<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Textarea from "primevue/textarea";
import Dialog from "primevue/dialog";
import { getTradesperson } from "@/firebase/services/tradespeople";
import { listCertsFor, approveCertification, rejectCertification } from "@/firebase/services/certifications";
import { getIdVerification, approveId, rejectId } from "@/firebase/services/idVerifications";
import {
  approveApplication,
  requestApplicationInfo,
  rejectApplication,
} from "@/firebase/services/admin";
import type {
  CertificationDoc,
  IdVerificationDoc,
  TradespersonDoc,
  WithId,
} from "@/firebase/interfaces";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { tradeLabel } from "@/data/trades";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toast = useToast();

const uid = route.params.uid as string;
const tradie = ref<WithId<TradespersonDoc> | null>(null);
const certs = ref<WithId<CertificationDoc>[]>([]);
const idDoc = ref<WithId<IdVerificationDoc> | null>(null);
const loading = ref(true);

const showRequestInfo = ref(false);
const showReject = ref(false);
const notesInput = ref("");

// Per-cert and ID rejection live in modals (no native prompt()).
const showRejectCert = ref(false);
const showRejectId = ref(false);
const rejectCertId = ref<string | null>(null);
const rejectReason = ref("");

async function load() {
  loading.value = true;
  tradie.value = await getTradesperson(uid);
  certs.value = await listCertsFor(uid);
  idDoc.value = await getIdVerification(uid);
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

async function approveAll() {
  // Per design.md: callable handles email + sets isVisible/verifiedTrades via downstream triggers.
  await approveApplication({ tradieUid: uid });
  toast.success("Application approved", "Welcome email queued.");
  router.replace({ name: "AdminVetting" });
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
            <a :href="c.fileUrl" target="_blank" rel="noopener" class="text-sm block mt-1">
              View document →
            </a>
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
            <div class="relative inline-block">
              <a :href="idDoc.fileUrl" target="_blank" rel="noopener">
                <img :src="idDoc.fileUrl" alt="ID" class="max-w-full max-h-64 rounded border" />
              </a>
              <div class="absolute inset-0 flex items-center justify-center pointer-events-none text-white/80 text-xl font-bold rotate-[-20deg]">
                ADMIN VIEW ONLY
              </div>
            </div>
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

      <!-- Decision bar -->
      <footer class="bs-card p-4 mt-6 flex flex-wrap gap-2 items-center justify-between">
        <div class="text-sm text-[color:var(--bs-muted)]">
          Approving will set their profile <strong>live</strong> and email them.
        </div>
        <div class="flex gap-2">
          <Button label="Request info" icon="pi pi-question-circle" outlined @click="showRequestInfo = true; notesInput = ''" />
          <Button label="Reject" icon="pi pi-ban" severity="danger" outlined @click="showReject = true; notesInput = ''" />
          <Button label="Approve all" icon="pi pi-check" severity="success" @click="approveAll" />
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
  </section>
</template>
