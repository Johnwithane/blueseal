<script setup lang="ts">
// Admin editor to enrich a seeded prospect's profile (the crawl only gets us
// part way) and to add/fix the contact email + phone. Writes straight to
// Firestore (admins have write on prospects + the private contact subdoc).
// Adding an email updates emailHash too, so claim-by-email still matches.
import { reactive, ref, watch } from "vue";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import InputNumber from "primevue/inputnumber";
import MultiSelect from "primevue/multiselect";
import Select from "primevue/select";
import Button from "primevue/button";
import type { ProspectDoc, WithId } from "@/firebase/interfaces";
import {
  getProspectContact,
  setProspectContact,
  updateProspectProfile,
  type ProspectProfileEdit,
} from "@/firebase/services/prospects";
import { TRADES } from "@/data/trades";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{ prospect: WithId<ProspectDoc> | null; visible: boolean }>();
const emit = defineEmits<{ "update:visible": [boolean]; saved: [] }>();

const toast = useToast();
const saving = ref(false);
const tradeOptions = TRADES.map((t) => ({ label: t.label, value: t.key }));
const pricingOptions = [
  { label: "By quote", value: "quote" },
  { label: "Hourly", value: "hourly" },
  { label: "Both", value: "both" },
];

const form = reactive({
  displayName: "",
  companyName: "",
  bio: "",
  trades: [] as string[],
  pricingModel: "quote" as ProspectDoc["pricingModel"],
  hourlyRateDollars: null as number | null,
  serviceRadiusKm: 25,
  languagesText: "",
  website: "",
  locationLabel: "",
  photoURL: "",
  yearsPrimary: null as number | null,
  email: "",
  phone: "",
});
let initialEmail = "";
let initialPhone = "";

async function initFor(p: WithId<ProspectDoc>) {
  form.displayName = p.displayName ?? "";
  form.companyName = p.companyName ?? "";
  form.bio = p.bio ?? "";
  form.trades = [...(p.trades ?? [])];
  form.pricingModel = p.pricingModel ?? "quote";
  form.hourlyRateDollars = typeof p.hourlyRate === "number" ? p.hourlyRate / 100 : null;
  form.serviceRadiusKm = p.serviceRadiusKm ?? 25;
  form.languagesText = (p.languages ?? []).join(", ");
  form.website = p.website ?? "";
  form.locationLabel = p.locationLabel ?? "";
  form.photoURL = p.photoURL ?? "";
  form.yearsPrimary = p.trades?.[0] ? (p.yearsExperience?.[p.trades[0]] ?? null) : null;
  form.email = "";
  form.phone = "";
  initialEmail = "";
  initialPhone = "";
  try {
    const c = await getProspectContact(p.id);
    form.email = c?.prospectEmail ?? "";
    form.phone = c?.prospectPhone ?? "";
    initialEmail = form.email;
    initialPhone = form.phone;
  } catch {
    /* contact load is best-effort */
  }
}

watch(
  () => [props.visible, props.prospect?.id] as const,
  ([vis]) => {
    if (vis && props.prospect) void initFor(props.prospect);
  },
  { immediate: true },
);

async function save() {
  const p = props.prospect;
  if (!p) return;
  saving.value = true;
  try {
    const primary = form.trades[0];
    const edit: ProspectProfileEdit = {
      displayName: form.displayName.trim(),
      companyName: form.companyName.trim() || null,
      bio: form.bio.trim(),
      trades: form.trades,
      pricingModel: form.pricingModel,
      hourlyRate: form.hourlyRateDollars != null ? Math.round(form.hourlyRateDollars * 100) : null,
      serviceRadiusKm: form.serviceRadiusKm,
      languages: form.languagesText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      website: form.website.trim() || null,
      locationLabel: form.locationLabel.trim() || null,
      photoURL: form.photoURL.trim() || null,
      yearsExperience: primary && form.yearsPrimary != null ? { [primary]: form.yearsPrimary } : {},
    };
    await updateProspectProfile(p.id, edit);

    // Only touch contact when something actually changed (so we never blank a
    // good emailHash by writing an empty email).
    const contactPatch: { email?: string; phone?: string | null } = {};
    if (form.email.trim() && form.email.trim().toLowerCase() !== initialEmail.toLowerCase()) {
      contactPatch.email = form.email.trim();
    }
    if (form.phone.trim() !== initialPhone.trim()) {
      contactPatch.phone = form.phone.trim() || null;
    }
    if (Object.keys(contactPatch).length) await setProspectContact(p.id, contactPatch);

    toast.success("Profile saved.");
    emit("saved");
    emit("update:visible", false);
  } catch (e) {
    toast.error("Couldn't save", humanizeError(e));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :style="{ width: '42rem', maxWidth: '95vw' }"
    :header="prospect ? `Edit ${prospect.displayName}` : 'Edit prospect'"
    @update:visible="emit('update:visible', $event)"
  >
    <div v-if="prospect" class="space-y-3">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium text-[color:var(--bs-muted)] mb-1">Name</label>
          <InputText v-model="form.displayName" class="w-full" />
        </div>
        <div>
          <label class="block text-xs font-medium text-[color:var(--bs-muted)] mb-1">Company</label>
          <InputText v-model="form.companyName" class="w-full" />
        </div>
      </div>

      <div>
        <label class="block text-xs font-medium text-[color:var(--bs-muted)] mb-1">Trades (first one is primary)</label>
        <MultiSelect
          v-model="form.trades"
          :options="tradeOptions"
          option-label="label"
          option-value="value"
          filter
          placeholder="Select trades"
          class="w-full"
        />
      </div>

      <div>
        <label class="block text-xs font-medium text-[color:var(--bs-muted)] mb-1">Bio</label>
        <Textarea v-model="form.bio" class="w-full" :rows="3" auto-resize />
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label class="block text-xs font-medium text-[color:var(--bs-muted)] mb-1">Pricing</label>
          <Select
            v-model="form.pricingModel"
            :options="pricingOptions"
            option-label="label"
            option-value="value"
            class="w-full"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-[color:var(--bs-muted)] mb-1">Hourly ($)</label>
          <InputNumber v-model="form.hourlyRateDollars" :min="0" :max="100000" class="w-full" />
        </div>
        <div>
          <label class="block text-xs font-medium text-[color:var(--bs-muted)] mb-1">Years (primary)</label>
          <InputNumber v-model="form.yearsPrimary" :min="0" :max="80" class="w-full" />
        </div>
        <div>
          <label class="block text-xs font-medium text-[color:var(--bs-muted)] mb-1">Radius (km)</label>
          <InputNumber v-model="form.serviceRadiusKm" :min="1" :max="200" class="w-full" />
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium text-[color:var(--bs-muted)] mb-1">Town label</label>
          <InputText v-model="form.locationLabel" class="w-full" placeholder="Kelowna, BC" />
        </div>
        <div>
          <label class="block text-xs font-medium text-[color:var(--bs-muted)] mb-1">Languages (comma separated)</label>
          <InputText v-model="form.languagesText" class="w-full" placeholder="English, French" />
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium text-[color:var(--bs-muted)] mb-1">Website</label>
          <InputText v-model="form.website" class="w-full" />
        </div>
        <div>
          <label class="block text-xs font-medium text-[color:var(--bs-muted)] mb-1">Photo / logo URL</label>
          <InputText v-model="form.photoURL" class="w-full" />
        </div>
      </div>

      <div class="border-t border-[color:var(--bs-border)] pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium text-[color:var(--bs-muted)] mb-1">Contact email</label>
          <InputText v-model="form.email" class="w-full" placeholder="name@business.ca" />
          <p class="text-xs text-[color:var(--bs-muted)] mt-1">
            Use the email publicly posted on their site or listing.
          </p>
        </div>
        <div>
          <label class="block text-xs font-medium text-[color:var(--bs-muted)] mb-1">Phone</label>
          <InputText v-model="form.phone" class="w-full" />
        </div>
      </div>
    </div>

    <template #footer>
      <Button label="Cancel" text @click="emit('update:visible', false)" />
      <Button label="Save profile" icon="pi pi-check" :loading="saving" @click="save" />
    </template>
  </Dialog>
</template>
