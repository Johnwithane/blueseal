<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import { useAuthStore } from "@/stores/auth";
import {
  createProject,
  updateProject,
  type CreateProjectResult,
} from "@/firebase/services/projects";
import { subscribeProperties } from "@/firebase/services/properties";
import { subscribeSavedTradieIds, hydrateSavedTradies } from "@/firebase/services/savedTradies";
import { generateProjectJobsWithAi } from "@/firebase/services/aiDrafts";
import { uploadPmPhoto } from "@/firebase/services/pmImages";
import { projectSchema } from "@/validation/projects";
import { TRADES } from "@/data/trades";
import { useToast } from "@/composables/useToast";
import { usePaywallStore } from "@/stores/paywall";
import { useSubscriptionStore } from "@/stores/subscription";
import { humanizeError } from "@/utils/errors";
import type { ProjectDoc, PropertyDoc, WithId } from "@/firebase/interfaces";

// The create-a-project form. When `propertyId` is passed (the property-scoped flow
// inside a property), the project is fixed to that property and the picker is hidden;
// otherwise it shows a property picker. Emits `created` so the parent can refresh.
//
// EDIT MODE: pass `editProject` (a project the client hasn't accepted yet) to reuse
// the same job editor for edits — it prefills, hides the client-email field (email
// changes go through Resend invite), and saves via updateProject, emitting `updated`.
const props = defineProps<{
  propertyId?: string | null;
  editProject?: WithId<ProjectDoc> | null;
}>();
const emit = defineEmits<{ created: []; updated: []; cancel: [] }>();

const isEdit = computed(() => !!props.editProject);

const auth = useAuthStore();
const toast = useToast();
const paywall = usePaywallStore();
const subscription = useSubscriptionStore();

// AI: draft the project's jobs from a freeform description (Blue Seal Pro).
const aiPrompt = ref("");
const aiBusy = ref(false);
async function draftWithAi() {
  const text = aiPrompt.value.trim();
  if (!text) return;
  const isAdmin = (auth.roles ?? []).includes("admin");
  // Pre-flight the paywall so a non-Pro PM doesn't burn a server round-trip.
  if (!subscription.isPro && !isAdmin) {
    paywall.open(
      "Drafting a project with AI is part of Blue Seal Pro. Start a free trial to use it.",
    );
    return;
  }
  aiBusy.value = true;
  try {
    const jobs = await generateProjectJobsWithAi(
      text,
      TRADES.map((t) => ({ key: t.key, label: t.label })),
    );
    const mapped = jobs.map((j) => ({ trade: j.trade, title: j.title, description: j.description }));
    // Replace the lone empty starter row; otherwise append to what's there.
    const onlyEmpty =
      form.jobs.length === 1 && !form.jobs[0].trade && !form.jobs[0].title && !form.jobs[0].description;
    if (onlyEmpty) form.jobs.splice(0, form.jobs.length, ...mapped);
    else form.jobs.push(...mapped);
    aiPrompt.value = "";
    toast.success("Jobs drafted", "Review and tweak them, then create the project.");
  } catch (e) {
    if (paywall.fromError(e)) return;
    toast.error("Couldn't draft", humanizeError(e));
  } finally {
    aiBusy.value = false;
  }
}

const properties = ref<WithId<PropertyDoc>[]>([]);
let unsubProps: (() => void) | null = null;

// Roster coverage preview: mirror dispatch's matching (a saved+visible tradie whose
// `trades[]` includes the job's trade) so the PM sees BEFORE inviting the client
// whether each job will reach their trades — or fall through to the public board.
const rosterTradeCounts = ref<Record<string, number>>({});
let unsubRoster: (() => void) | null = null;
function matchCount(trade: string): number {
  return trade ? (rosterTradeCounts.value[trade] ?? 0) : 0;
}

const tradeOptions = TRADES.map((t) => ({ label: t.label, value: t.key }));
const propertyOptions = computed(() => [
  { label: "No property", value: null as string | null },
  ...properties.value.map((p) => ({ label: p.label, value: p.id as string | null })),
]);
// Fixed to a property when the parent passes one in.
const scoped = computed(() => props.propertyId != null);

const saving = ref(false);
const uploading = ref(false);
const form = reactive({
  label: "",
  clientName: "",
  clientEmail: "",
  propertyId: null as string | null,
  photoUrl: "" as string,
  jobs: [{ trade: "", title: "", description: "" }],
});
const fieldErrors = ref<Record<string, string>>({});
const lastResult = ref<CreateProjectResult | null>(null);

onMounted(() => {
  const uid = auth.fbUser?.uid;
  if (!uid) return;
  // Edit mode: prefill from the project. clientEmail is kept (hidden) so the
  // shared projectSchema still validates; updateProject ignores it.
  if (props.editProject) {
    const p = props.editProject;
    form.label = p.label;
    form.clientName = p.clientName;
    form.clientEmail = p.projectInvite?.emailLower ?? "noreply@example.com";
    form.propertyId = p.propertyId ?? null;
    form.photoUrl = p.photoUrl ?? "";
    form.jobs = p.jobSpecs.map((j) => ({ ...j }));
  }
  if (!scoped.value) unsubProps = subscribeProperties(uid, (next) => (properties.value = next));
  // Recompute trade coverage whenever the roster changes. Roster size is small
  // (dozens at most), so re-hydrating on each change is cheap.
  unsubRoster = subscribeSavedTradieIds(uid, async (ids) => {
    const tradies = await hydrateSavedTradies([...ids]);
    const counts: Record<string, number> = {};
    for (const t of tradies) for (const tr of t.trades ?? []) counts[tr] = (counts[tr] ?? 0) + 1;
    rosterTradeCounts.value = counts;
  });
});
onUnmounted(() => {
  unsubProps?.();
  unsubRoster?.();
});

function reset() {
  form.label = "";
  form.clientName = "";
  form.clientEmail = "";
  form.propertyId = null;
  form.photoUrl = "";
  form.jobs = [{ trade: "", title: "", description: "" }];
  fieldErrors.value = {};
}

async function onPickPhoto(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  const uid = auth.fbUser?.uid;
  if (!file || !uid) return;
  uploading.value = true;
  try {
    form.photoUrl = await uploadPmPhoto(uid, file);
  } catch (err) {
    toast.error("Upload failed", humanizeError(err));
  } finally {
    uploading.value = false;
    (e.target as HTMLInputElement).value = "";
  }
}

function addJob() {
  form.jobs.push({ trade: "", title: "", description: "" });
}
function removeJob(i: number) {
  if (form.jobs.length > 1) form.jobs.splice(i, 1);
}

async function save() {
  fieldErrors.value = {};
  const parsed = projectSchema.safeParse({
    ...form,
    propertyId: scoped.value ? props.propertyId : form.propertyId,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      fieldErrors.value[issue.path.join(".")] = issue.message;
    }
    return;
  }
  saving.value = true;
  try {
    if (props.editProject) {
      await updateProject({
        projectId: props.editProject.id,
        label: parsed.data.label,
        clientName: parsed.data.clientName,
        propertyId: parsed.data.propertyId,
        photoUrl: parsed.data.photoUrl,
        jobs: parsed.data.jobs,
      });
      emit("updated");
      toast.success("Project updated", "Your changes are saved.");
      return;
    }
    const res = await createProject(parsed.data);
    lastResult.value = res;
    reset();
    emit("created");
    toast.success(
      "Project created",
      res.emailed ? "We emailed your client a sign-in link." : "Copy the invite link to share it.",
    );
  } catch (e) {
    toast.error(isEdit.value ? "Couldn't save" : "Couldn't create", humanizeError(e));
  } finally {
    saving.value = false;
  }
}

async function copyInvite() {
  if (!lastResult.value) return;
  try {
    await navigator.clipboard.writeText(lastResult.value.inviteLink);
    toast.success("Copied", "Invite link copied.");
  } catch {
    toast.warn("Copy failed", "Copy the link manually.");
  }
}
</script>

<template>
  <div class="space-y-3">
    <!-- Success state: the project was created. The sign-in link to share lives
         HERE and persists (the parent no longer unmounts the form on created), so
         the PM can always copy it — the only recovery when the email doesn't send. -->
    <div v-if="lastResult" class="bs-card p-4 space-y-3">
      <div class="flex items-center gap-2">
        <i class="pi pi-check-circle text-xl text-[color:var(--bs-success)]"></i>
        <p class="font-semibold">Project created</p>
      </div>
      <p class="text-sm text-[color:var(--bs-muted)]">
        {{
          lastResult.emailed
            ? "We emailed your client a sign-in link. You can also share this link with them:"
            : "Share this sign-in link with your client — pressing it signs them in to manage the jobs:"
        }}
      </p>
      <div class="flex items-center gap-2 flex-wrap">
        <span
          class="flex-1 min-w-0 truncate text-sm rounded border border-[color:var(--bs-border)] px-2 py-1 bg-[color:var(--bs-surface-alt)]"
        >{{ lastResult.inviteLink }}</span>
        <Button label="Copy" icon="pi pi-copy" size="small" @click="copyInvite" />
      </div>
      <div class="flex gap-2 pt-1">
        <Button label="Create another" icon="pi pi-plus" text size="small" @click="lastResult = null" />
        <Button label="Done" size="small" @click="$emit('cancel')" />
      </div>
    </div>

    <div v-else class="bs-card p-4 space-y-3">
      <div>
        <label class="text-sm font-medium">Project name</label>
        <InputText v-model="form.label" class="mt-1 w-full" placeholder="e.g. Spring turnover" />
        <small v-if="fieldErrors.label" class="text-[color:var(--bs-danger)]">{{ fieldErrors.label }}</small>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="text-sm font-medium">Client name</label>
          <InputText v-model="form.clientName" class="mt-1 w-full" placeholder="Their name" />
          <small v-if="fieldErrors.clientName" class="text-[color:var(--bs-danger)]">{{ fieldErrors.clientName }}</small>
        </div>
        <div v-if="!isEdit">
          <label class="text-sm font-medium">Client email</label>
          <InputText v-model="form.clientEmail" type="email" class="mt-1 w-full" placeholder="them@example.com" />
          <small v-if="fieldErrors.clientEmail" class="text-[color:var(--bs-danger)]">{{ fieldErrors.clientEmail }}</small>
        </div>
      </div>
      <div v-if="!scoped">
        <label class="text-sm font-medium">
          Property <span class="text-[color:var(--bs-muted)] font-normal">(optional)</span>
        </label>
        <Select
          v-model="form.propertyId"
          :options="propertyOptions"
          option-label="label"
          option-value="value"
          class="mt-1 w-full"
          placeholder="No property"
        />
      </div>

      <div>
        <label class="text-sm font-medium">
          Photo <span class="text-[color:var(--bs-muted)] font-normal">(optional)</span>
        </label>
        <div class="flex items-center gap-3 mt-1">
          <img v-if="form.photoUrl" :src="form.photoUrl" alt="Project photo" class="h-14 w-14 rounded object-cover" />
          <input type="file" accept="image/*" :disabled="uploading" @change="onPickPhoto" />
          <button v-if="form.photoUrl" type="button" class="text-xs text-[color:var(--bs-muted)] underline" @click="form.photoUrl = ''">Remove</button>
        </div>
      </div>

      <!-- AI: describe the work, get the jobs drafted (Blue Seal Pro). -->
      <div class="rounded-lg border border-dashed border-[color:var(--bs-blue)]/40 bg-[color:var(--bs-blue)]/5 p-3 space-y-2">
        <label class="text-sm font-medium flex items-center gap-1.5">
          <i class="pi pi-sparkles text-[color:var(--bs-blue)]"></i> Draft the jobs with AI
        </label>
        <Textarea
          v-model="aiPrompt"
          class="w-full"
          rows="2"
          placeholder="Describe the work in plain words, e.g. Kitchen reno — new outlets, under-cabinet lighting, a plumber for the sink, repaint the cabinets"
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
          <small v-if="fieldErrors[`jobs.${i}.trade`]" class="text-[color:var(--bs-danger)] block">{{ fieldErrors[`jobs.${i}.trade`] }}</small>
          <!-- Roster coverage: warn before the client accepts if no saved trade matches. -->
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
          <InputText v-model="job.title" class="w-full" placeholder="Job title (e.g. Repaint unit)" />
          <small v-if="fieldErrors[`jobs.${i}.title`]" class="text-[color:var(--bs-danger)] block">{{ fieldErrors[`jobs.${i}.title`] }}</small>
          <Textarea v-model="job.description" class="w-full" rows="2" placeholder="What needs doing?" />
          <small v-if="fieldErrors[`jobs.${i}.description`]" class="text-[color:var(--bs-danger)] block">{{ fieldErrors[`jobs.${i}.description`] }}</small>
        </div>
        <Button label="Add another job" icon="pi pi-plus" text size="small" @click="addJob" />
        <small v-if="fieldErrors.jobs" class="text-[color:var(--bs-danger)] block">{{ fieldErrors.jobs }}</small>
      </div>

      <div class="flex gap-2">
        <Button
          :label="isEdit ? 'Save changes' : 'Create & invite client'"
          :loading="saving || uploading"
          size="small"
          @click="save"
        />
        <Button label="Cancel" text size="small" @click="$emit('cancel')" />
      </div>
    </div>
  </div>
</template>
