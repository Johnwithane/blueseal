<script setup lang="ts">
// Add or edit a client-book contact. One dialog for both (an optional `client`
// prop flips it to edit) so the form lives in one place — ClientsPanel opens it
// to add, ClientDetailView to edit. Validates with clientDraftSchema at the
// boundary; the service writes the server-managed fields.
import { computed, reactive, ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import { clientDraftSchema } from "@/validation/clients";
import { createClient, updateClient } from "@/firebase/services/clientsService";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import type { ClientDoc, WithId } from "@/firebase/interfaces";

const props = defineProps<{
  visible: boolean;
  client?: WithId<ClientDoc> | null;
}>();
const emit = defineEmits<{
  "update:visible": [value: boolean];
  saved: [id: string];
}>();

const toast = useToast();
const saving = ref(false);
const errors = ref<Record<string, string>>({});
const showAddress = ref(false);
const isEdit = computed(() => !!props.client);

const form = reactive({
  displayName: "",
  email: "",
  phone: "",
  company: "",
  notes: "",
  line1: "",
  city: "",
  region: "",
  postalCode: "",
});

function reset() {
  const c = props.client;
  form.displayName = c?.displayName ?? "";
  form.email = c?.emailLower ?? "";
  form.phone = c?.phone ?? "";
  form.company = c?.company ?? "";
  form.notes = c?.notes ?? "";
  form.line1 = c?.address?.line1 ?? "";
  form.city = c?.address?.city ?? "";
  form.region = c?.address?.region ?? "";
  form.postalCode = c?.address?.postalCode ?? "";
  showAddress.value = !!c?.address;
  errors.value = {};
}

// Re-seed each time the dialog opens so a cancelled edit discards changes.
watch(
  () => props.visible,
  (v) => {
    if (v) reset();
  },
);

async function save() {
  errors.value = {};
  const parsed = clientDraftSchema.safeParse({
    displayName: form.displayName,
    email: form.email,
    phone: form.phone,
    company: form.company,
    notes: form.notes,
    address: {
      line1: form.line1,
      city: form.city,
      region: form.region,
      postalCode: form.postalCode,
    },
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!errors.value[key]) errors.value[key] = issue.message;
    }
    return;
  }
  saving.value = true;
  try {
    let id: string;
    if (props.client) {
      await updateClient(props.client.id, parsed.data);
      id = props.client.id;
    } else {
      id = await createClient(parsed.data);
    }
    toast.success(props.client ? "Client updated" : "Client added");
    emit("saved", id);
    emit("update:visible", false);
  } catch (e) {
    toast.error(humanizeError(e));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="isEdit ? 'Edit client' : 'Add client'"
    :style="{ width: '92vw', maxWidth: '32rem' }"
    :draggable="false"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="space-y-3">
      <div>
        <label class="block text-xs text-[color:var(--bs-muted)] mb-1">Name *</label>
        <InputText
          v-model="form.displayName"
          maxlength="120"
          class="w-full"
          placeholder="Jane Doe / Jane's Pool Co."
        />
        <p v-if="errors.displayName" class="text-[11px] text-[color:var(--bs-danger)] mt-1">
          {{ errors.displayName }}
        </p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-xs text-[color:var(--bs-muted)] mb-1">Email</label>
          <InputText v-model="form.email" maxlength="200" class="w-full" />
          <p v-if="errors.email" class="text-[11px] text-[color:var(--bs-danger)] mt-1">
            {{ errors.email }}
          </p>
        </div>
        <div>
          <label class="block text-xs text-[color:var(--bs-muted)] mb-1">Phone</label>
          <InputText v-model="form.phone" maxlength="20" class="w-full" />
          <p v-if="errors.phone" class="text-[11px] text-[color:var(--bs-danger)] mt-1">
            {{ errors.phone }}
          </p>
        </div>
      </div>

      <div>
        <label class="block text-xs text-[color:var(--bs-muted)] mb-1">Company</label>
        <InputText v-model="form.company" maxlength="120" class="w-full" />
      </div>

      <button
        type="button"
        class="text-xs text-[color:var(--bs-blue-dark)] underline"
        @click="showAddress = !showAddress"
      >
        {{ showAddress ? "Hide address" : "Add address (optional)" }}
      </button>
      <div v-if="showAddress" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="sm:col-span-2">
          <InputText v-model="form.line1" maxlength="200" class="w-full" placeholder="Street address" />
        </div>
        <InputText v-model="form.city" maxlength="100" class="w-full" placeholder="City" />
        <InputText v-model="form.region" maxlength="100" class="w-full" placeholder="Province" />
        <InputText v-model="form.postalCode" maxlength="12" class="w-full" placeholder="Postal code" />
      </div>

      <div>
        <label class="block text-xs text-[color:var(--bs-muted)] mb-1">Notes</label>
        <Textarea v-model="form.notes" rows="3" maxlength="2000" class="w-full" auto-resize />
      </div>
    </div>

    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="emit('update:visible', false)" />
      <Button
        :label="isEdit ? 'Save' : 'Add client'"
        icon="pi pi-check"
        :loading="saving"
        @click="save"
      />
    </template>
  </Dialog>
</template>
