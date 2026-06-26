<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import { useAuthStore } from "@/stores/auth";
import {
  createProject,
  type CreateProjectResult,
} from "@/firebase/services/projects";
import { subscribeProperties } from "@/firebase/services/properties";
import { uploadPmPhoto } from "@/firebase/services/pmImages";
import { projectSchema } from "@/validation/projects";
import { TRADES } from "@/data/trades";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import type { PropertyDoc, WithId } from "@/firebase/interfaces";

// The create-a-project form. When `propertyId` is passed (the property-scoped flow
// inside a property), the project is fixed to that property and the picker is hidden;
// otherwise it shows a property picker. Emits `created` so the parent can refresh.
const props = defineProps<{ propertyId?: string | null }>();
const emit = defineEmits<{ created: []; cancel: [] }>();

const auth = useAuthStore();
const toast = useToast();

const properties = ref<WithId<PropertyDoc>[]>([]);
let unsubProps: (() => void) | null = null;

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
  if (uid && !scoped.value) unsubProps = subscribeProperties(uid, (next) => (properties.value = next));
});
onUnmounted(() => unsubProps?.());

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
    const res = await createProject(parsed.data);
    lastResult.value = res;
    reset();
    emit("created");
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
  <div class="space-y-3">
    <!-- Invite link to share when the email didn't / can't send. -->
    <div v-if="lastResult" class="bs-card p-3 space-y-2">
      <p class="text-sm font-medium">Share this invite link with your client:</p>
      <div class="flex items-center gap-2 flex-wrap">
        <span
          class="flex-1 min-w-0 truncate text-sm rounded border border-[color:var(--bs-border)] px-2 py-1 bg-[color:var(--bs-surface-alt)]"
        >{{ lastResult.inviteLink }}</span>
        <Button label="Copy" icon="pi pi-copy" size="small" @click="copyInvite" />
        <Button label="Dismiss" text size="small" @click="lastResult = null" />
      </div>
    </div>

    <div class="bs-card p-4 space-y-3">
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
        <div>
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
        <Button label="Create & invite client" :loading="saving || uploading" size="small" @click="save" />
        <Button label="Cancel" text size="small" @click="$emit('cancel')" />
      </div>
    </div>
  </div>
</template>
