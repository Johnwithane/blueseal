<script setup lang="ts">
// Rename a job / correct its brief. Reported twice from the job page: a
// tradesperson who books work over the phone types the title and description
// themselves and had no way to fix either afterwards.
//
// Scope is deliberately split:
//   - TITLE is always editable (under the host's gate). It's a label, and both
//     parties benefit from it being accurate.
//   - DESCRIPTION is only offered while the job has NO joined client
//     (`clientId == null`, i.e. an invite/solo job the tradesperson wrote
//     themselves). Once a client is on the job, the Brief tab calls that text
//     "Original request" and both sides rely on it as the record of what was
//     asked for, so it isn't the tradesperson's to rewrite.
import { computed, reactive, ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import { jobEditSchema } from "@/validation/schemas";
import { updateJobDetails } from "@/firebase/services/jobs";
import { useFormErrors } from "@/composables/useFormErrors";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{
  visible: boolean;
  jobId: string;
  title: string;
  description: string;
  /** False once a client has joined — the brief stops being ours to rewrite. */
  canEditDescription: boolean;
}>();

const emit = defineEmits<{
  "update:visible": [value: boolean];
  saved: [];
}>();

const toast = useToast();
const saving = ref(false);
const { errors, clear: clearErrors, setFromZod } = useFormErrors();

const form = reactive({ title: "", description: "" });

// Re-seed each time it opens so a cancelled edit discards changes.
watch(
  () => props.visible,
  (v) => {
    if (!v) return;
    form.title = props.title;
    form.description = props.description;
    clearErrors();
  },
  { immediate: true },
);

const dirty = computed(
  () =>
    form.title !== props.title ||
    (props.canEditDescription && form.description !== props.description),
);

async function save() {
  clearErrors();
  const parsed = jobEditSchema.safeParse({
    title: form.title,
    // Omit entirely when we're not offering it, so an untouched brief can't be
    // rewritten by a stale form value.
    ...(props.canEditDescription ? { description: form.description } : {}),
  });
  if (!parsed.success) {
    setFromZod(parsed.error);
    return;
  }
  saving.value = true;
  try {
    await updateJobDetails(props.jobId, parsed.data);
    toast.success("Job updated");
    emit("saved");
    emit("update:visible", false);
  } catch (e) {
    toast.error("Couldn't update the job", humanizeError(e));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    header="Edit job"
    :style="{ width: '92vw', maxWidth: '32rem' }"
    :draggable="false"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="space-y-3">
      <div>
        <label for="job-edit-title" class="block text-xs text-[color:var(--bs-muted)] mb-1">
          Job title *
        </label>
        <InputText
          id="job-edit-title"
          v-model="form.title"
          maxlength="140"
          class="w-full"
          placeholder="Relocate hot water tank"
        />
        <p v-if="errors.title" class="text-[11px] text-[color:var(--bs-danger)] mt-1">
          {{ errors.title }}
        </p>
      </div>

      <div v-if="canEditDescription">
        <label for="job-edit-desc" class="block text-xs text-[color:var(--bs-muted)] mb-1">
          What the job is
        </label>
        <Textarea
          id="job-edit-desc"
          v-model="form.description"
          rows="4"
          maxlength="4000"
          class="w-full"
          auto-resize
        />
        <p v-if="errors.description" class="text-[11px] text-[color:var(--bs-danger)] mt-1">
          {{ errors.description }}
        </p>
      </div>
      <p v-else class="text-xs text-[color:var(--bs-muted)]">
        Your client's own description of the job stays as they wrote it. Ask them in the
        chat if it needs changing.
      </p>
    </div>

    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="emit('update:visible', false)" />
      <Button
        label="Save"
        icon="pi pi-check"
        :loading="saving"
        :disabled="saving || !dirty"
        @click="save"
      />
    </template>
  </Dialog>
</template>
