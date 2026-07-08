<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Tag from "primevue/tag";
import { useAuthStore } from "@/stores/auth";
import {
  subscribeClientProjects,
  respondToProject,
  respondToProjectJob,
  redispatchProject,
  type ProjectAcceptAddress,
} from "@/firebase/services/projects";
import { tradeLabel } from "@/data/trades";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import type { ProjectDoc, WithId } from "@/firebase/interfaces";

// A client's projects, set up FOR them by a project manager. Renders nothing
// until they've claimed at least one (no surface for the vast majority of clients
// who have none). Claimed-but-undecided projects get Accept / Decline; accepting
// confirms the job address, which fans each job out to trades for quotes (P3b-2).
const auth = useAuthStore();
const toast = useToast();

const rows = ref<WithId<ProjectDoc>[]>([]);
const busy = ref<string | null>(null);
// Which project is showing the accept address form (null = none).
const acceptingId = ref<string | null>(null);
// Which project is showing the "Decline — are you sure?" confirm (null = none).
const confirmingDecline = ref<string | null>(null);
const addr = reactive<ProjectAcceptAddress>({ line1: "", city: "", region: "", postalCode: "" });
let unsub: (() => void) | null = null;

const hasPosts = (p: WithId<ProjectDoc>) => Array.isArray(p.jobPostIds) && p.jobPostIds.length > 0;
const pending = computed(() => rows.value.filter((p) => p.status === "claimed"));
// Jobs the PM added AFTER this client accepted the project — each needs a per-job
// approve/decline (respondToProjectJob). Grouped by project. The work address was
// captured at the original accept, so approving just lines up quotes.
const jobApprovals = computed(() =>
  rows.value
    .filter((p) => p.status === "accepted")
    .map((p) => ({
      project: p,
      specs: (p.jobSpecs ?? []).filter((s) => s.status === "pendingClient"),
    }))
    .filter((g) => g.specs.length > 0),
);
// Per-job action state, keyed by spec id (independent of the per-project `busy`).
const busyJob = ref<string | null>(null);
const confirmingDeclineJob = ref<string | null>(null);
// Accepted but never dispatched (dispatch failed) — recoverable.
const needsDispatch = computed(() =>
  rows.value.filter((p) => p.status === "accepted" && !hasPosts(p)),
);
const decided = computed(() =>
  rows.value.filter((p) => p.status === "declined" || (p.status === "accepted" && hasPosts(p))),
);
// Canadian postal code (A1A 1A1) — target market is Canada.
const POSTAL_RE = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;
const addrValid = computed(
  () =>
    addr.line1.trim().length > 1 &&
    addr.city.trim().length > 1 &&
    addr.region.trim().length > 1 &&
    POSTAL_RE.test(addr.postalCode.trim()),
);

const statusSeverity: Record<string, "info" | "success" | "secondary"> = {
  accepted: "success",
  declined: "secondary",
};
const statusLabel: Record<string, string> = {
  accepted: "Accepted",
  declined: "Declined",
};

onMounted(() => {
  const uid = auth.fbUser?.uid;
  if (!uid) return;
  unsub = subscribeClientProjects(uid, (next) => (rows.value = next));
});
onUnmounted(() => unsub?.());

function startAccept(p: WithId<ProjectDoc>) {
  acceptingId.value = p.id;
  // Prefill the street line from the PM's property address so the client
  // confirms rather than retypes; they complete/adjust city/region/postal
  // (the property only carries free-text) (P2-21).
  addr.line1 = p.propertyAddressText?.trim() ?? "";
  addr.city = "";
  addr.region = "";
  addr.postalCode = "";
}

async function confirmAccept(p: WithId<ProjectDoc>) {
  if (!addrValid.value) return;
  busy.value = p.id;
  try {
    const res = await respondToProject(p.id, "accept", { ...addr });
    acceptingId.value = null;
    if (res.dispatched === false) {
      toast.error("Almost there", "We couldn't send your jobs out. Tap Re-send to try again.");
    } else if (res.unmatchedTrades && res.unmatchedTrades.length) {
      toast.success(
        "Project accepted",
        "Some jobs had no preferred trade saved — open those to all trades nearby from the job.",
      );
    } else {
      toast.success("Project accepted", "Your trades will be lined up for quotes.");
    }
  } catch (e) {
    toast.error("Couldn't update", humanizeError(e));
  } finally {
    busy.value = null;
  }
}

async function retryDispatch(p: WithId<ProjectDoc>) {
  busy.value = p.id;
  try {
    await redispatchProject(p.id);
    toast.success("Sent", "Your jobs are out for quotes.");
  } catch (e) {
    toast.error("Couldn't send", humanizeError(e));
  } finally {
    busy.value = null;
  }
}

async function approveJob(projectId: string, specId: string) {
  busyJob.value = specId;
  try {
    const res = await respondToProjectJob(projectId, specId, "accept");
    if (res.status === "accepted" && res.unmatched) {
      toast.success(
        "Job approved",
        "No preferred trade was saved for this one — open it to all trades nearby from the job.",
      );
    } else {
      toast.success("Job approved", "Your trades will be lined up for quotes.");
    }
  } catch (e) {
    toast.error("Couldn't approve", humanizeError(e));
  } finally {
    busyJob.value = null;
  }
}

async function declineJob(projectId: string, specId: string) {
  busyJob.value = specId;
  try {
    await respondToProjectJob(projectId, specId, "decline");
    confirmingDeclineJob.value = null;
    toast.success("Job declined", "We let your project manager know.");
  } catch (e) {
    toast.error("Couldn't update", humanizeError(e));
  } finally {
    busyJob.value = null;
  }
}

async function decline(p: WithId<ProjectDoc>) {
  busy.value = p.id;
  try {
    await respondToProject(p.id, "decline");
    confirmingDecline.value = null;
    toast.success("Project declined", "We let your project manager know.");
  } catch (e) {
    toast.error("Couldn't update", humanizeError(e));
  } finally {
    busy.value = null;
  }
}
</script>

<template>
  <div v-if="rows.length" class="mb-4">
    <h2 class="font-semibold flex items-center gap-2 mb-2">
      <i class="pi pi-folder-open text-[color:var(--bs-blue)]"></i> Projects set up for you
    </h2>

    <!-- Needs a decision -->
    <ul v-if="pending.length" class="grid grid-cols-1 gap-3">
      <li v-for="p in pending" :key="p.id" class="bs-card p-4">
        <p class="font-semibold">{{ p.label }}</p>
        <p class="text-xs text-[color:var(--bs-muted)] mt-0.5">
          A project manager set this up. Accept to line up quotes from trusted trades.
        </p>
        <ul class="mt-2 space-y-1">
          <li v-for="(job, i) in p.jobSpecs" :key="i" class="text-sm flex items-start gap-2">
            <i class="pi pi-wrench text-[color:var(--bs-muted)] text-xs mt-1"></i>
            <span><strong>{{ tradeLabel(job.trade) }}</strong> · {{ job.title }}</span>
          </li>
        </ul>
        <!-- Accept asks for the job address (where the work is). -->
        <div v-if="acceptingId === p.id" class="mt-3 space-y-2 border-t border-[color:var(--bs-border)] pt-3">
          <p class="text-xs text-[color:var(--bs-muted)]">
            Where is the work? We'll share this with the trades you're getting quotes from.
          </p>
          <InputText v-model="addr.line1" class="w-full" placeholder="Street address" />
          <div class="grid grid-cols-2 gap-2">
            <InputText v-model="addr.city" placeholder="City" />
            <InputText v-model="addr.region" placeholder="Province" />
          </div>
          <InputText v-model="addr.postalCode" class="w-full" placeholder="Postal code" />
          <div class="flex gap-2">
            <Button
              label="Confirm & accept"
              icon="pi pi-check"
              size="small"
              :loading="busy === p.id"
              :disabled="!addrValid"
              @click="confirmAccept(p)"
            />
            <Button label="Cancel" text size="small" :disabled="busy === p.id" @click="acceptingId = null" />
          </div>
        </div>
        <div v-else-if="confirmingDecline === p.id" class="flex flex-wrap items-center gap-2 mt-3">
          <span class="text-sm font-medium">Decline this project? This can't be undone.</span>
          <Button
            label="Yes, decline"
            severity="danger"
            size="small"
            :loading="busy === p.id"
            @click="decline(p)"
          />
          <Button label="Keep it" text size="small" :disabled="busy === p.id" @click="confirmingDecline = null" />
        </div>
        <div v-else class="flex gap-2 mt-3">
          <Button label="Accept" icon="pi pi-check" size="small" @click="startAccept(p)" />
          <Button label="Decline" text size="small" :disabled="busy === p.id" @click="confirmingDecline = p.id" />
        </div>
      </li>
    </ul>

    <!-- Jobs your PM added after you accepted — approve each before it goes out. -->
    <ul v-if="jobApprovals.length" class="grid grid-cols-1 gap-3 mt-2">
      <li v-for="g in jobApprovals" :key="g.project.id" class="bs-card p-4 border-l-4 border-l-[color:var(--bs-blue)]">
        <p class="font-semibold">{{ g.project.label }}</p>
        <p class="text-xs text-[color:var(--bs-muted)] mt-0.5">
          Your project manager added {{ g.specs.length === 1 ? "a new job" : "new jobs" }}. Approve to line up quotes from trusted trades.
        </p>
        <ul class="mt-3 space-y-3">
          <li v-for="spec in g.specs" :key="spec.id" class="border-t border-[color:var(--bs-border)] pt-3 first:border-t-0 first:pt-0">
            <div class="flex items-start gap-2">
              <i class="pi pi-wrench text-[color:var(--bs-muted)] text-xs mt-1"></i>
              <div class="min-w-0 flex-1">
                <p class="text-sm"><strong>{{ tradeLabel(spec.trade) }}</strong> · {{ spec.title }}</p>
                <p v-if="spec.description" class="text-xs text-[color:var(--bs-muted)] mt-0.5">{{ spec.description }}</p>
              </div>
            </div>
            <div v-if="confirmingDeclineJob === spec.id" class="flex flex-wrap items-center gap-2 mt-2">
              <span class="text-sm font-medium">Decline this job?</span>
              <Button
                label="Yes, decline"
                severity="danger"
                size="small"
                :loading="busyJob === spec.id"
                @click="declineJob(g.project.id, spec.id!)"
              />
              <Button label="Keep it" text size="small" :disabled="busyJob === spec.id" @click="confirmingDeclineJob = null" />
            </div>
            <div v-else class="flex gap-2 mt-2">
              <Button
                label="Approve"
                icon="pi pi-check"
                size="small"
                :loading="busyJob === spec.id"
                @click="approveJob(g.project.id, spec.id!)"
              />
              <Button label="Decline" text size="small" :disabled="busyJob === spec.id" @click="confirmingDeclineJob = spec.id ?? null" />
            </div>
          </li>
        </ul>
      </li>
    </ul>

    <!-- Accepted but the jobs didn't go out (dispatch failed) — recoverable. -->
    <ul v-if="needsDispatch.length" class="grid grid-cols-1 gap-3 mt-2">
      <li v-for="p in needsDispatch" :key="p.id" class="bs-card p-4 border-l-4 border-l-[color:var(--bs-warn,#d97706)]">
        <p class="font-semibold">{{ p.label }}</p>
        <p class="text-xs text-[color:var(--bs-muted)] mt-0.5">
          You accepted this, but we couldn't send the jobs out for quotes. Tap Re-send to try again.
        </p>
        <Button
          label="Re-send jobs"
          icon="pi pi-refresh"
          size="small"
          class="mt-2"
          :loading="busy === p.id"
          @click="retryDispatch(p)"
        />
      </li>
    </ul>

    <!-- Already decided -->
    <ul v-if="decided.length" class="grid grid-cols-1 gap-2 mt-2">
      <li v-for="p in decided" :key="p.id" class="bs-card p-3 flex items-center gap-3">
        <i class="pi pi-folder-open text-[color:var(--bs-muted)]"></i>
        <div class="min-w-0 flex-1">
          <p class="font-medium truncate">{{ p.label }}</p>
          <p class="text-xs text-[color:var(--bs-muted)]">
            {{ p.jobSpecs.length }} {{ p.jobSpecs.length === 1 ? "job" : "jobs" }}
          </p>
        </div>
        <Tag :value="statusLabel[p.status] ?? p.status" :severity="statusSeverity[p.status] ?? 'info'" />
      </li>
    </ul>
  </div>
</template>
