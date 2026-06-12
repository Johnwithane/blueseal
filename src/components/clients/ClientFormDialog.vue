<script setup lang="ts">
// Add or edit a client-book contact. One dialog for both (an optional `client`
// prop flips it to edit) so the form lives in one place — ClientsPanel opens it
// to add, ClientDetailView to edit. Validates with clientDraftSchema at the
// boundary; the service writes the server-managed fields.
import { computed, nextTick, reactive, ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import { clientDraftSchema } from "@/validation/clients";
import { createClient, updateClient } from "@/firebase/services/clientsService";
import { useGoogleMaps } from "@/composables/useGoogleMaps";
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
    else attachedEl = null; // dialog body unmounts on close — re-attach next open
  },
);

// Google Places autocomplete on the street line — same widget the rest of the
// app uses (CreateJobView / PostJobView). Picking a suggestion fills
// line1/city/region/postal. We store text only (geo stays null in the client
// book), so there's no geocode fallback to wire up. autocomplete tokens on the
// fields are left ON (not "off") so the browser can also autofill naturally.
const addressEl = ref<HTMLInputElement | null>(null);
let attachedEl: HTMLInputElement | null = null;

async function initAddressAutocomplete() {
  await nextTick();
  const el = addressEl.value;
  if (!el || el === attachedEl) return;
  try {
    await useGoogleMaps().load();
    const ac = new google.maps.places.Autocomplete(el, {
      fields: ["address_components", "formatted_address"],
      types: ["geocode"],
      componentRestrictions: { country: "ca" },
    });
    attachedEl = el;
    ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      if (!place?.address_components) return;
      const comp = (type: string) =>
        place.address_components?.find((c) => c.types.includes(type))?.long_name ?? "";
      const short = (type: string) =>
        place.address_components?.find((c) => c.types.includes(type))?.short_name ?? "";
      form.line1 =
        [comp("street_number"), comp("route")].filter(Boolean).join(" ").trim() ||
        place.formatted_address?.split(",")[0] ||
        "";
      form.city = comp("locality") || comp("sublocality") || "";
      form.region = short("administrative_area_level_1") || "";
      form.postalCode = comp("postal_code") || "";
    });
  } catch {
    /* maps failed to load — manual entry still works */
  }
}

// The address inputs live inside a v-if and the dialog only mounts its body
// when open, so attach once both are true.
watch(
  () => props.visible && showAddress.value,
  (on) => {
    if (on) void initAddressAutocomplete();
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
        <!-- Raw input (not InputText) so the Places autocomplete can attach to
             a real HTMLInputElement. autocomplete tokens are real (not "off")
             so the browser can autofill too. -->
        <div class="sm:col-span-2">
          <input
            ref="addressEl"
            v-model="form.line1"
            type="text"
            class="p-inputtext p-component w-full"
            placeholder="Start typing the address…"
            maxlength="200"
            autocomplete="address-line1"
          />
        </div>
        <InputText
          v-model="form.city"
          maxlength="100"
          class="w-full"
          placeholder="City"
          autocomplete="address-level2"
        />
        <InputText
          v-model="form.region"
          maxlength="100"
          class="w-full"
          placeholder="Province"
          autocomplete="address-level1"
        />
        <InputText
          v-model="form.postalCode"
          maxlength="12"
          class="w-full"
          placeholder="Postal code"
          autocomplete="postal-code"
        />
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
