<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Tag from "primevue/tag";
import { useAuthStore } from "@/stores/auth";
import {
  subscribeClientProjects,
  respondToProject,
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
const addr = reactive<ProjectAcceptAddress>({ line1: "", city: "", region: "", postalCode: "" });
let unsub: (() => void) | null = null;

const pending = computed(() => rows.value.filter((p) => p.status === "claimed"));
const decided = computed(() => rows.value.filter((p) => p.status !== "claimed"));
const addrValid = computed(
  () =>
    addr.line1.trim().length > 1 &&
    addr.city.trim().length > 1 &&
    addr.region.trim().length > 1 &&
    addr.postalCode.trim().length > 2,
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
  addr.line1 = "";
  addr.city = "";
  addr.region = "";
  addr.postalCode = "";
}

async function confirmAccept(p: WithId<ProjectDoc>) {
  if (!addrValid.value) return;
  busy.value = p.id;
  try {
    await respondToProject(p.id, "accept", { ...addr });
    acceptingId.value = null;
    toast.success("Project accepted", "Your trades will be lined up for quotes.");
  } catch (e) {
    toast.error("Couldn't update", humanizeError(e));
  } finally {
    busy.value = null;
  }
}

async function decline(p: WithId<ProjectDoc>) {
  busy.value = p.id;
  try {
    await respondToProject(p.id, "decline");
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
        <div v-else class="flex gap-2 mt-3">
          <Button label="Accept" icon="pi pi-check" size="small" @click="startAccept(p)" />
          <Button label="Decline" text size="small" :disabled="busy === p.id" @click="decline(p)" />
        </div>
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
