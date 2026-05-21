<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, RouterLink } from "vue-router";
import Button from "primevue/button";
import Tag from "primevue/tag";
import DatePicker from "primevue/datepicker";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import {
  collection,
  getDocs,
  query,
  where,
  limit,
} from "firebase/firestore";
import { db } from "@/firebase/config";

import {
  getJob,
  scheduleJob,
  updateJobStatus,
  updatePrivateNotes,
} from "@/firebase/services/jobs";
import { useAuthStore } from "@/stores/auth";
import type { JobDoc, JobStatus, WithId, InvoiceDoc } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";
import ChatThread from "@/components/ChatThread.vue";
import IntakeFormRenderer from "@/components/IntakeFormRenderer.vue";
import AiToolsPanel from "@/components/AiToolsPanel.vue";
import InvoiceEditor from "@/components/InvoiceEditor.vue";
import ReviewPrompt from "@/components/ReviewPrompt.vue";
import { SEED_INTAKE_SCHEMAS } from "@/data/intakeSchemas";
import { getIntakeSchema } from "@/firebase/services/intakeFormSchemas";
import type { IntakeField } from "@/firebase/interfaces";
import { getUser } from "@/firebase/services/users";
import { tradeLabel } from "@/data/trades";
import { typedConverter } from "@/firebase/converters";

const route = useRoute();
const auth = useAuthStore();
const { date, dateTime } = useFormatters();

const job = ref<WithId<JobDoc> | null>(null);
const intakeFields = ref<IntakeField[]>([]);
const invoiceId = ref<string | null>(null);
const subscriptionOn = ref(false);
const loading = ref(true);

const scheduledStart = ref<Date | null>(null);
const scheduledEnd = ref<Date | null>(null);
const privateNotes = ref("");

const statusOptions: { label: string; value: JobStatus }[] = [
  { label: "Requested", value: "requested" },
  { label: "Quoted", value: "quoted" },
  { label: "Scheduled", value: "scheduled" },
  { label: "In progress", value: "in_progress" },
  { label: "Awaiting payment", value: "awaiting_payment" },
  { label: "Complete", value: "complete" },
  { label: "Cancelled", value: "cancelled" },
];

const isTradie = computed(() => auth.fbUser?.uid === job.value?.tradespersonId);
const isClient = computed(() => auth.fbUser?.uid === job.value?.clientId);
const recipientId = computed(() =>
  isTradie.value ? job.value?.clientId ?? "" : job.value?.tradespersonId ?? "",
);

async function load() {
  loading.value = true;
  const id = route.params.id as string;
  job.value = await getJob(id);
  if (!job.value) {
    loading.value = false;
    return;
  }
  // Intake schema
  const remote = await getIntakeSchema(job.value.trade);
  intakeFields.value = remote?.fields ?? SEED_INTAKE_SCHEMAS[job.value.trade] ?? [];

  // Hydrate local form copies
  scheduledStart.value = job.value.scheduledStart?.toDate() ?? null;
  scheduledEnd.value = job.value.scheduledEnd?.toDate() ?? null;
  privateNotes.value = job.value.privateNotes ?? "";

  // Look up invoice for this job (if any)
  const q = query(
    collection(db, "invoices").withConverter(typedConverter<InvoiceDoc>()),
    where("jobId", "==", id),
    limit(1),
  );
  const snap = await getDocs(q);
  invoiceId.value = snap.empty ? null : snap.docs[0].id;

  // Subscription state from current user doc
  if (isTradie.value && auth.user) {
    subscriptionOn.value = auth.user.hasActiveSubscription;
  } else if (job.value.tradespersonId) {
    const u = await getUser(job.value.tradespersonId);
    subscriptionOn.value = u?.hasActiveSubscription ?? false;
  }

  loading.value = false;
}

onMounted(load);

async function saveSchedule() {
  if (!job.value || !scheduledStart.value || !scheduledEnd.value) return;
  await scheduleJob(job.value.id, scheduledStart.value, scheduledEnd.value);
  await load();
}

async function setStatus(s: JobStatus) {
  if (!job.value) return;
  await updateJobStatus(job.value.id, s);
  await load();
}

async function saveNotes() {
  if (!job.value) return;
  await updatePrivateNotes(job.value.id, privateNotes.value);
}

const statusColor: Record<JobStatus, "info" | "warn" | "success" | "danger" | "secondary"> = {
  requested: "info",
  quoted: "warn",
  scheduled: "success",
  in_progress: "success",
  awaiting_payment: "warn",
  complete: "success",
  reviewed: "secondary",
  cancelled: "danger",
};
</script>

<template>
  <section class="bs-container py-6">
    <RouterLink to="/dashboard" class="text-xs text-[color:var(--bs-muted)]">← Dashboard</RouterLink>

    <div v-if="loading" class="bs-empty mt-4">Loading…</div>
    <template v-else-if="job">
      <header class="flex items-start justify-between gap-3 mt-2 mb-4">
        <div>
          <h1 class="text-xl font-bold">{{ job.title }}</h1>
          <div class="text-xs text-[color:var(--bs-muted)]">
            {{ tradeLabel(job.trade) }} • Created {{ date(job.createdAt) }} •
            {{ job.address.line1 }}, {{ job.address.city }}
          </div>
        </div>
        <Tag :value="job.status" :severity="statusColor[job.status]" />
      </header>

      <div class="grid lg:grid-cols-3 gap-4">
        <div class="lg:col-span-2 space-y-4">
          <ChatThread :chat-id="job.chatId" :recipient-id="recipientId" />

          <div class="bs-card p-4">
            <h3 class="font-semibold text-sm mb-2">Original request</h3>
            <p class="text-sm whitespace-pre-wrap">{{ job.description }}</p>
            <div v-if="job.intakePhotos.length" class="grid grid-cols-4 gap-2 mt-3">
              <a v-for="p in job.intakePhotos" :key="p" :href="p" target="_blank" rel="noopener">
                <img :src="p" class="aspect-square object-cover rounded" alt="" />
              </a>
            </div>
            <div v-if="intakeFields.length" class="mt-4">
              <h4 class="font-medium text-sm mb-2">Trade-specific details</h4>
              <IntakeFormRenderer
                :model-value="job.intakeFormData"
                :fields="intakeFields"
                readonly
                @update:model-value="() => {}"
              />
            </div>
          </div>

          <InvoiceEditor v-if="invoiceId" :invoice-id="invoiceId" :can-edit="isTradie" />
        </div>

        <aside class="space-y-4">
          <div v-if="isTradie" class="bs-card p-3">
            <h3 class="font-semibold text-sm mb-2">Status</h3>
            <Select
              :model-value="job.status"
              :options="statusOptions"
              option-label="label"
              option-value="value"
              class="w-full"
              @update:model-value="(v) => setStatus(v as JobStatus)"
            />
          </div>

          <div class="bs-card p-3">
            <h3 class="font-semibold text-sm mb-2">Schedule</h3>
            <div v-if="job.scheduledStart" class="text-sm">
              {{ dateTime(job.scheduledStart) }} → {{ dateTime(job.scheduledEnd) }}
            </div>
            <template v-if="isTradie">
              <DatePicker v-model="scheduledStart" show-time hour-format="24" class="w-full mt-2" placeholder="Start" />
              <DatePicker v-model="scheduledEnd" show-time hour-format="24" class="w-full mt-2" placeholder="End" />
              <Button label="Save schedule" icon="pi pi-calendar" class="mt-2 w-full" outlined @click="saveSchedule" />
            </template>
          </div>

          <div v-if="isTradie" class="bs-card p-3">
            <h3 class="font-semibold text-sm mb-2">Private notes (tradie only)</h3>
            <Textarea v-model="privateNotes" rows="4" class="w-full" />
            <Button label="Save notes" icon="pi pi-save" outlined size="small" class="mt-2" @click="saveNotes" />
          </div>

          <AiToolsPanel v-if="isTradie" :job-id="job.id" :has-active-subscription="subscriptionOn" />

          <div v-if="job.status === 'complete' || job.status === 'reviewed'" class="bs-card p-3">
            <h3 class="font-semibold text-sm mb-2">Reviews</h3>
            <ReviewPrompt
              :job="job"
              :as-role="isClient ? 'client' : 'tradesperson'"
              @reviewed="load"
            />
          </div>
        </aside>
      </div>
    </template>
  </section>
</template>
