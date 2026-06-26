<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import Button from "primevue/button";
import Tag from "primevue/tag";
import { useAuthStore } from "@/stores/auth";
import { subscribeClientProjects, respondToProject } from "@/firebase/services/projects";
import { tradeLabel } from "@/data/trades";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import type { ProjectDoc, WithId } from "@/firebase/interfaces";

// A client's projects, set up FOR them by a project manager. Renders nothing
// until they've claimed at least one (no surface for the vast majority of clients
// who have none). Claimed-but-undecided projects get Accept / Decline; once
// accepted, the jobs get sent to trades for quotes (P3b-2).
const auth = useAuthStore();
const toast = useToast();

const rows = ref<WithId<ProjectDoc>[]>([]);
const busy = ref<string | null>(null);
let unsub: (() => void) | null = null;

const pending = computed(() => rows.value.filter((p) => p.status === "claimed"));
const decided = computed(() => rows.value.filter((p) => p.status !== "claimed"));

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

async function respond(p: WithId<ProjectDoc>, response: "accept" | "decline") {
  busy.value = p.id;
  try {
    await respondToProject(p.id, response);
    toast.success(
      response === "accept" ? "Project accepted" : "Project declined",
      response === "accept"
        ? "Your trades will be lined up for quotes."
        : "We let your project manager know.",
    );
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
        <div class="flex gap-2 mt-3">
          <Button
            label="Accept"
            icon="pi pi-check"
            size="small"
            :loading="busy === p.id"
            @click="respond(p, 'accept')"
          />
          <Button
            label="Decline"
            text
            size="small"
            :disabled="busy === p.id"
            @click="respond(p, 'decline')"
          />
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
