<script setup lang="ts">
import { onMounted, ref } from "vue";
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
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
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
          <a
            v-if="c.documentUrl"
            :href="c.documentUrl"
            target="_blank"
            rel="noopener"
            class="text-xs text-[color:var(--bs-blue)] underline mt-1 inline-block"
          >
            View document
          </a>
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
        <a
          v-if="detail.idVerification.documentUrl"
          :href="detail.idVerification.documentUrl"
          target="_blank"
          rel="noopener"
          class="text-xs text-[color:var(--bs-blue)] underline mt-1 inline-block"
        >
          View ID document
        </a>
      </div>

      <Message severity="info" :closable="false" class="mb-4">
        Approving confirms you have checked this person's certification and ID. You are responsible
        for who you approve.
      </Message>

      <!-- Decisions -->
      <div class="flex flex-wrap gap-2">
        <Button label="Approve" icon="pi pi-check" :loading="busy" @click="doApprove" />
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
  </section>
</template>
