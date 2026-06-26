<script setup lang="ts">
import { onMounted, onUnmounted, reactive, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import { useConfirm } from "primevue/useconfirm";
import { useAuthStore } from "@/stores/auth";
import {
  subscribeProperties,
  createProperty,
  updateProperty,
  setPropertyArchived,
} from "@/firebase/services/properties";
import { propertySchema } from "@/validation/properties";
import { uploadPmPhoto } from "@/firebase/services/pmImages";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import type { PropertyDoc, WithId } from "@/firebase/interfaces";

// The PM's property book: the addresses they manage. Projects + jobs (P3b) are
// organized by property. Mirrors the Clients CRM panel, simplified.
const auth = useAuthStore();
const toast = useToast();
const confirm = useConfirm();

const loading = ref(true);
const rows = ref<WithId<PropertyDoc>[]>([]);
let unsub: (() => void) | null = null;

const formOpen = ref(false);
const editingId = ref<string | null>(null); // null = adding
const saving = ref(false);
const form = reactive({ label: "", addressText: "", notes: "", photoUrl: "" });
const fieldErrors = ref<Record<string, string>>({});
const uploading = ref(false);

onMounted(() => {
  const uid = auth.fbUser?.uid;
  if (!uid) {
    loading.value = false;
    return;
  }
  unsub = subscribeProperties(uid, (next) => {
    rows.value = next;
    loading.value = false;
  });
});
onUnmounted(() => unsub?.());

function openAdd() {
  editingId.value = null;
  form.label = "";
  form.addressText = "";
  form.notes = "";
  form.photoUrl = "";
  fieldErrors.value = {};
  formOpen.value = true;
}

function openEdit(p: WithId<PropertyDoc>) {
  editingId.value = p.id;
  form.label = p.label;
  form.addressText = p.addressText;
  form.notes = p.notes ?? "";
  form.photoUrl = p.photoUrl ?? "";
  fieldErrors.value = {};
  formOpen.value = true;
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

async function save() {
  fieldErrors.value = {};
  const parsed = propertySchema.safeParse({
    label: form.label,
    addressText: form.addressText,
    notes: form.notes,
    photoUrl: form.photoUrl,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      fieldErrors.value[issue.path[0] as string] = issue.message;
    }
    return;
  }
  saving.value = true;
  try {
    if (editingId.value) await updateProperty(editingId.value, parsed.data);
    else await createProperty(parsed.data);
    formOpen.value = false;
    toast.success("Saved", editingId.value ? "Property updated." : "Property added.");
  } catch (e) {
    toast.error("Couldn't save", humanizeError(e));
  } finally {
    saving.value = false;
  }
}

function archive(p: WithId<PropertyDoc>) {
  // One-tap archive used to be silent + irreversible (archived rows drop off the
  // list). Confirm first and toast the result.
  confirm.require({
    header: "Archive property?",
    message: `Archive "${p.label}"? It'll be hidden from your list. Its projects stay intact.`,
    icon: "pi pi-inbox",
    acceptLabel: "Archive",
    rejectLabel: "Cancel",
    accept: async () => {
      try {
        await setPropertyArchived(p.id, true);
        toast.success("Archived", `"${p.label}" was archived.`);
      } catch (e) {
        toast.error("Couldn't archive", humanizeError(e));
      }
    },
  });
}
</script>

<template>
  <div>
    <div v-if="!formOpen" class="mb-3">
      <Button label="Add property" icon="pi pi-plus" size="small" outlined @click="openAdd" />
    </div>

    <div v-else class="bs-card p-4 mb-3 space-y-3">
      <div>
        <label class="text-sm font-medium">Label</label>
        <InputText v-model="form.label" class="mt-1 w-full" placeholder="e.g. Unit 4B - 123 Main St" />
        <small v-if="fieldErrors.label" class="text-[color:var(--bs-danger)]">{{ fieldErrors.label }}</small>
      </div>
      <div>
        <label class="text-sm font-medium">
          Address <span class="text-[color:var(--bs-muted)] font-normal">(optional)</span>
        </label>
        <InputText v-model="form.addressText" class="mt-1 w-full" placeholder="Street, city" />
      </div>
      <div>
        <label class="text-sm font-medium">
          Notes <span class="text-[color:var(--bs-muted)] font-normal">(optional)</span>
        </label>
        <Textarea v-model="form.notes" class="mt-1 w-full" rows="2" />
      </div>
      <div>
        <label class="text-sm font-medium">
          Photo <span class="text-[color:var(--bs-muted)] font-normal">(optional)</span>
        </label>
        <div class="flex items-center gap-3 mt-1">
          <img v-if="form.photoUrl" :src="form.photoUrl" alt="Property photo" class="h-14 w-14 rounded object-cover" />
          <input type="file" accept="image/*" :disabled="uploading" @change="onPickPhoto" />
          <button v-if="form.photoUrl" type="button" class="text-xs text-[color:var(--bs-muted)] underline" @click="form.photoUrl = ''">Remove</button>
        </div>
      </div>
      <div class="flex gap-2">
        <Button label="Save" :loading="saving || uploading" size="small" @click="save" />
        <Button label="Cancel" text size="small" @click="formOpen = false" />
      </div>
    </div>

    <div v-if="loading" class="text-sm text-[color:var(--bs-muted)] py-4 text-center">Loading…</div>
    <div v-else-if="rows.length === 0 && !formOpen" class="bs-card p-6 text-center">
      <i class="pi pi-home text-2xl text-[color:var(--bs-muted)]"></i>
      <p class="mt-2 font-medium">No properties yet</p>
      <p class="text-sm text-[color:var(--bs-muted)]">
        Add the addresses you manage to organize your projects.
      </p>
    </div>
    <ul v-else-if="rows.length" class="grid grid-cols-1 gap-2">
      <li v-for="p in rows" :key="p.id" class="bs-card p-3 flex items-start gap-3">
        <RouterLink
          :to="{ name: 'PmPropertyDetail', params: { propertyId: p.id } }"
          class="flex items-start gap-3 flex-1 min-w-0 no-underline text-inherit"
        >
          <img
            v-if="p.photoUrl"
            :src="p.photoUrl"
            alt=""
            class="h-10 w-10 rounded object-cover shrink-0"
          />
          <i v-else class="pi pi-home text-[color:var(--bs-blue)] mt-1"></i>
          <div class="min-w-0 flex-1">
            <p class="font-medium truncate">{{ p.label }}</p>
            <p v-if="p.addressText" class="text-xs text-[color:var(--bs-muted)] truncate">{{ p.addressText }}</p>
            <p v-if="p.notes" class="text-xs text-[color:var(--bs-muted)] mt-0.5 line-clamp-2">{{ p.notes }}</p>
          </div>
        </RouterLink>
        <Button
          icon="pi pi-pencil"
          text
          rounded
          size="small"
          aria-label="Edit property"
          @click="openEdit(p)"
        />
        <Button
          icon="pi pi-inbox"
          text
          rounded
          size="small"
          severity="secondary"
          aria-label="Archive property"
          @click="archive(p)"
        />
        <RouterLink
          :to="{ name: 'PmPropertyDetail', params: { propertyId: p.id } }"
          class="text-[color:var(--bs-muted)] mt-1 no-underline"
          aria-label="Open property"
        >
          <i class="pi pi-chevron-right text-xs"></i>
        </RouterLink>
      </li>
    </ul>
  </div>
</template>
