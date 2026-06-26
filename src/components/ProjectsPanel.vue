<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import Tag from "primevue/tag";
import { useAuthStore } from "@/stores/auth";
import {
  subscribeProjectsForPm,
  createProject,
  type CreateProjectResult,
} from "@/firebase/services/projects";
import { subscribeProperties } from "@/firebase/services/properties";
import { projectSchema } from "@/validation/projects";
import { TRADES, tradeLabel } from "@/data/trades";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import type { ProjectDoc, PropertyDoc, WithId } from "@/firebase/interfaces";

// The PM's projects: a bundle of trade jobs set up for one client and sent by
// magic-link invite. The client claims + accepts; accept dispatches to the PM's
// preferred contractors (P3b-2). Mirrors PropertiesPanel, with a dynamic job list.
const auth = useAuthStore();
const toast = useToast();

const loading = ref(true);
const rows = ref<WithId<ProjectDoc>[]>([]);
const properties = ref<WithId<PropertyDoc>[]>([]);
let unsub: (() => void) | null = null;
let unsubProps: (() => void) | null = null;

const tradeOptions = TRADES.map((t) => ({ label: t.label, value: t.key }));
const propertyOptions = computed(() => [
  { label: "No property", value: null as string | null },
  ...properties.value.map((p) => ({ label: p.label, value: p.id as string | null })),
]);

const formOpen = ref(false);
const saving = ref(false);
const form = reactive({
  label: "",
  clientName: "",
  clientEmail: "",
  propertyId: null as string | null,
  jobs: [{ trade: "", title: "", description: "" }],
});
const fieldErrors = ref<Record<string, string>>({});
const lastResult = ref<CreateProjectResult | null>(null);

const statusSeverity: Record<ProjectDoc["status"], "info" | "warn" | "success" | "secondary"> = {
  invited: "info",
  claimed: "warn",
  accepted: "success",
  declined: "secondary",
  cancelled: "secondary",
};
const statusLabel: Record<ProjectDoc["status"], string> = {
  invited: "Invite sent",
  claimed: "Client joined",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
};

onMounted(() => {
  const uid = auth.fbUser?.uid;
  if (!uid) {
    loading.value = false;
    return;
  }
  unsub = subscribeProjectsForPm(uid, (next) => {
    rows.value = next;
    loading.value = false;
  });
  unsubProps = subscribeProperties(uid, (next) => (properties.value = next));
});
onUnmounted(() => {
  unsub?.();
  unsubProps?.();
});

function openAdd() {
  form.label = "";
  form.clientName = "";
  form.clientEmail = "";
  form.propertyId = null;
  form.jobs = [{ trade: "", title: "", description: "" }];
  fieldErrors.value = {};
  lastResult.value = null;
  formOpen.value = true;
}

function addJob() {
  form.jobs.push({ trade: "", title: "", description: "" });
}
function removeJob(i: number) {
  if (form.jobs.length > 1) form.jobs.splice(i, 1);
}

async function save() {
  fieldErrors.value = {};
  const parsed = projectSchema.safeParse(form);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      fieldErrors.value[issue.path.join(".")] = issue.message;
    }
    return;
  }
  saving.value = true;
  try {
    const res = await createProject(parsed.data);
    lastResult.value = res;
    formOpen.value = false;
    toast.success(
      "Project created",
      res.emailed ? "We emailed your client a sign-in link." : "Copy the invite link to share it.",
    );
  } catch (e) {
    toast.error("Couldn't create", humanizeError(e));
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
  <div>
    <div v-if="!formOpen" class="mb-3">
      <Button label="New project" icon="pi pi-plus" size="small" outlined @click="openAdd" />
    </div>

    <!-- Invite link to share when the email didn't / can't send. -->
    <div v-if="lastResult && !formOpen" class="bs-card p-3 mb-3 space-y-2">
      <p class="text-sm font-medium">Share this invite link with your client:</p>
      <div class="flex items-center gap-2 flex-wrap">
        <span
          class="flex-1 min-w-0 truncate text-sm rounded border border-[color:var(--bs-border)] px-2 py-1 bg-[color:var(--bs-surface-alt)]"
        >{{ lastResult.inviteLink }}</span>
        <Button label="Copy" icon="pi pi-copy" size="small" @click="copyInvite" />
        <Button label="Dismiss" text size="small" @click="lastResult = null" />
      </div>
    </div>

    <div v-if="formOpen" class="bs-card p-4 mb-3 space-y-3">
      <div>
        <label class="text-sm font-medium">Project name</label>
        <InputText v-model="form.label" class="mt-1 w-full" placeholder="e.g. Spring turnover - 14 Elm" />
        <small v-if="fieldErrors.label" class="text-[color:var(--bs-danger)]">{{ fieldErrors.label }}</small>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="text-sm font-medium">Client name</label>
          <InputText v-model="form.clientName" class="mt-1 w-full" placeholder="Their name" />
          <small v-if="fieldErrors.clientName" class="text-[color:var(--bs-danger)]">{{ fieldErrors.clientName }}</small>
        </div>
        <div>
          <label class="text-sm font-medium">Client email</label>
          <InputText v-model="form.clientEmail" type="email" class="mt-1 w-full" placeholder="them@example.com" />
          <small v-if="fieldErrors.clientEmail" class="text-[color:var(--bs-danger)]">{{ fieldErrors.clientEmail }}</small>
        </div>
      </div>
      <div>
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
          <InputText v-model="job.title" class="w-full" placeholder="Job title (e.g. Repaint unit)" />
          <small v-if="fieldErrors[`jobs.${i}.title`]" class="text-[color:var(--bs-danger)] block">{{ fieldErrors[`jobs.${i}.title`] }}</small>
          <Textarea v-model="job.description" class="w-full" rows="2" placeholder="What needs doing?" />
          <small v-if="fieldErrors[`jobs.${i}.description`]" class="text-[color:var(--bs-danger)] block">{{ fieldErrors[`jobs.${i}.description`] }}</small>
        </div>
        <Button label="Add another job" icon="pi pi-plus" text size="small" @click="addJob" />
        <small v-if="fieldErrors.jobs" class="text-[color:var(--bs-danger)] block">{{ fieldErrors.jobs }}</small>
      </div>

      <div class="flex gap-2">
        <Button label="Create & invite client" :loading="saving" size="small" @click="save" />
        <Button label="Cancel" text size="small" @click="formOpen = false" />
      </div>
    </div>

    <div v-if="loading" class="text-sm text-[color:var(--bs-muted)] py-4 text-center">Loading…</div>
    <div v-else-if="rows.length === 0 && !formOpen" class="bs-card p-6 text-center">
      <i class="pi pi-folder-open text-2xl text-[color:var(--bs-muted)]"></i>
      <p class="mt-2 font-medium">No projects yet</p>
      <p class="text-sm text-[color:var(--bs-muted)]">
        Set up a bundle of jobs for a client and invite them to choose their trades.
      </p>
    </div>
    <ul v-else-if="rows.length" class="grid grid-cols-1 gap-2">
      <li v-for="p in rows" :key="p.id">
        <RouterLink
          :to="{ name: 'ProjectDetail', params: { projectId: p.id } }"
          class="bs-card p-3 flex items-start gap-3 no-underline text-inherit hover:shadow-md transition-shadow"
        >
          <i class="pi pi-folder-open text-[color:var(--bs-blue)] mt-1"></i>
          <div class="min-w-0 flex-1">
            <p class="font-medium truncate">{{ p.label }}</p>
            <p class="text-xs text-[color:var(--bs-muted)] truncate">
              {{ p.clientName }} ·
              {{ p.jobSpecs.length }} {{ p.jobSpecs.length === 1 ? "job" : "jobs" }}
              <template v-if="p.jobSpecs.length">
                ({{ p.jobSpecs.map((j) => tradeLabel(j.trade)).join(", ") }})
              </template>
            </p>
          </div>
          <Tag :value="statusLabel[p.status]" :severity="statusSeverity[p.status]" />
          <i class="pi pi-chevron-right text-xs text-[color:var(--bs-muted)] mt-1"></i>
        </RouterLink>
      </li>
    </ul>
  </div>
</template>
