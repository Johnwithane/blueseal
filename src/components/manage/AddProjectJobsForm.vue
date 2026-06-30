<script setup lang="ts">
// Add jobs to an ALREADY-accepted project. Distinct from NewProjectForm (which
// creates/edits the whole bundle pre-accept): here the project + client are fixed,
// so this is just the jobs editor. Each added job goes out as "pendingClient" and
// the client approves it per-job before it dispatches (proposeProjectJobs →
// respondToProjectJob). Kept separate so the proven create/edit form stays simple;
// if a 3rd jobs-editor use appears, extract a shared ProjectJobsEditor.
import { onMounted, onUnmounted, reactive, ref } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import { useAuthStore } from "@/stores/auth";
import { proposeProjectJobs } from "@/firebase/services/projects";
import { subscribeSavedTradieIds, hydrateSavedTradies } from "@/firebase/services/savedTradies";
import { generateProjectJobsWithAi } from "@/firebase/services/aiDrafts";
import JobPhotosField from "@/components/manage/JobPhotosField.vue";
import { addProjectJobsSchema } from "@/validation/projects";
import { TRADES } from "@/data/trades";
import { useToast } from "@/composables/useToast";
import { useFormErrors } from "@/composables/useFormErrors";
import { usePaywallStore } from "@/stores/paywall";
import { useSubscriptionStore } from "@/stores/subscription";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{ projectId: string }>();
const emit = defineEmits<{ added: [count: number]; cancel: [] }>();

const auth = useAuthStore();
const toast = useToast();
const paywall = usePaywallStore();
const subscription = useSubscriptionStore();

const tradeOptions = TRADES.map((t) => ({ label: t.label, value: t.key }));
const form = reactive({ jobs: [{ trade: "", title: "", description: "", photos: [] as string[] }] });
const { errors, clear: clearErrors, setFromZod } = useFormErrors();
const saving = ref(false);

// AI: draft the added jobs from a freeform description (Blue Seal Pro), same as
// NewProjectForm — describe the extra work, get rows back.
const aiPrompt = ref("");
const aiBusy = ref(false);
async function draftWithAi() {
  const text = aiPrompt.value.trim();
  if (!text) return;
  const isAdmin = (auth.roles ?? []).includes("admin");
  if (!subscription.isPro && !isAdmin) {
    paywall.open("Drafting jobs with AI is part of Blue Seal Pro. Start a free trial to use it.");
    return;
  }
  aiBusy.value = true;
  try {
    const jobs = await generateProjectJobsWithAi(
      text,
      TRADES.map((t) => ({ key: t.key, label: t.label })),
    );
    const mapped = jobs.map((j) => ({
      trade: j.trade,
      title: j.title,
      description: j.description,
      photos: [] as string[],
    }));
    const onlyEmpty =
      form.jobs.length === 1 &&
      !form.jobs[0].trade &&
      !form.jobs[0].title &&
      !form.jobs[0].description;
    if (onlyEmpty) form.jobs.splice(0, form.jobs.length, ...mapped);
    else form.jobs.push(...mapped);
    aiPrompt.value = "";
    toast.success("Jobs drafted", "Review and tweak them, then add to the project.");
  } catch (e) {
    if (paywall.fromError(e)) return;
    toast.error("Couldn't draft", humanizeError(e));
  } finally {
    aiBusy.value = false;
  }
}

// Roster coverage: mirror dispatch's matching so the PM sees whether each added job
// will reach a saved trade or fall through to the public board.
const rosterTradeCounts = ref<Record<string, number>>({});
let unsubRoster: (() => void) | null = null;
function matchCount(trade: string): number {
  return trade ? (rosterTradeCounts.value[trade] ?? 0) : 0;
}

onMounted(() => {
  const uid = auth.fbUser?.uid;
  if (!uid) return;
  unsubRoster = subscribeSavedTradieIds(uid, async (ids) => {
    const tradies = await hydrateSavedTradies([...ids]);
    const counts: Record<string, number> = {};
    for (const t of tradies) for (const tr of t.trades ?? []) counts[tr] = (counts[tr] ?? 0) + 1;
    rosterTradeCounts.value = counts;
  });
});
onUnmounted(() => unsubRoster?.());

function addJob() {
  form.jobs.push({ trade: "", title: "", description: "", photos: [] });
}
function removeJob(i: number) {
  if (form.jobs.length > 1) form.jobs.splice(i, 1);
}

async function save() {
  clearErrors();
  const parsed = addProjectJobsSchema.safeParse({ projectId: props.projectId, jobs: form.jobs });
  if (!parsed.success) {
    setFromZod(parsed.error, (path) => path.join("."));
    return;
  }
  saving.value = true;
  try {
    const res = await proposeProjectJobs(props.projectId, parsed.data.jobs);
    toast.success(
      res.added === 1 ? "Job added" : `${res.added} jobs added`,
      "Your client will approve them before they go out to your trades.",
    );
    emit("added", res.added);
  } catch (e) {
    toast.error("Couldn't add jobs", humanizeError(e));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="bs-card p-4 space-y-3">
    <div>
      <p class="font-semibold">Add jobs to this project</p>
      <p class="text-xs text-[color:var(--bs-muted)] mt-0.5">
        Your client approves each added job before it goes out to your trades for quotes.
      </p>
    </div>

    <!-- AI: describe the extra work, get the jobs drafted (Blue Seal Pro). -->
    <div class="rounded-lg border border-dashed border-[color:var(--bs-blue)]/40 bg-[color:var(--bs-blue)]/5 p-3 space-y-2">
      <label class="text-sm font-medium flex items-center gap-1.5">
        <i class="pi pi-sparkles text-[color:var(--bs-blue)]"></i> Draft the jobs with AI
      </label>
      <Textarea
        v-model="aiPrompt"
        class="w-full"
        rows="2"
        placeholder="Describe the extra work in plain words, e.g. add a plumber for the basement sink and a painter for the hallway"
      />
      <Button
        label="Draft jobs"
        icon="pi pi-sparkles"
        size="small"
        :loading="aiBusy"
        :disabled="!aiPrompt.trim()"
        @click="draftWithAi"
      />
    </div>

    <div class="space-y-2">
      <label class="text-sm font-medium">Jobs</label>
      <div v-for="(job, i) in form.jobs" :key="i" class="bs-card p-3 space-y-2">
        <div class="flex items-center gap-2">
          <Select
            v-model="job.trade"
            :options="tradeOptions"
            option-label="label"
            option-value="value"
            filter
            class="flex-1"
            placeholder="Trade"
          />
          <Button
            v-if="form.jobs.length > 1"
            icon="pi pi-trash"
            text
            rounded
            size="small"
            severity="secondary"
            aria-label="Remove job"
            @click="removeJob(i)"
          />
        </div>
        <small v-if="errors[`jobs.${i}.trade`]" class="text-[color:var(--bs-danger)] block">{{ errors[`jobs.${i}.trade`] }}</small>
        <!-- Roster coverage: warn before adding if no saved trade matches. -->
        <p
          v-if="job.trade && matchCount(job.trade) === 0"
          class="text-xs text-[color:var(--bs-warn,#d97706)] flex items-start gap-1"
        >
          <i class="pi pi-exclamation-triangle text-[10px] mt-0.5"></i>
          <span>No saved trade for this — it'll go to the public board. Add one to your roster to keep it in-house.</span>
        </p>
        <p
          v-else-if="job.trade"
          class="text-xs text-[color:var(--bs-success)] flex items-center gap-1"
        >
          <i class="pi pi-check-circle text-[10px]"></i>
          <span>{{ matchCount(job.trade) }} of your trades will be invited to quote.</span>
        </p>
        <InputText v-model="job.title" class="w-full" placeholder="Job title (e.g. Repaint hallway)" />
        <small v-if="errors[`jobs.${i}.title`]" class="text-[color:var(--bs-danger)] block">{{ errors[`jobs.${i}.title`] }}</small>
        <Textarea v-model="job.description" class="w-full" rows="2" placeholder="What needs doing?" />
        <small v-if="errors[`jobs.${i}.description`]" class="text-[color:var(--bs-danger)] block">{{ errors[`jobs.${i}.description`] }}</small>
        <JobPhotosField v-model="job.photos" />
      </div>
      <Button label="Add another job" icon="pi pi-plus" text size="small" @click="addJob" />
      <small v-if="errors.jobs" class="text-[color:var(--bs-danger)] block">{{ errors.jobs }}</small>
    </div>

    <div class="flex gap-2">
      <Button label="Send to client for approval" :loading="saving" size="small" @click="save" />
      <Button label="Cancel" text size="small" :disabled="saving" @click="$emit('cancel')" />
    </div>
  </div>
</template>
