<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import Select from "primevue/select";
import { CA_PROVINCES } from "@/data/provinces";
import { regionSchema } from "@/validation/regionSchema";
import { saveRegion } from "@/firebase/services/regions";
import { normalizePostal } from "@/utils/regionMatch";
import type { RegionDoc, WithId } from "@/firebase/interfaces";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

// Add/edit form for a single sales region. Validates with the shared Zod schema
// and writes via the adminUpsertRegion callable. Emits `saved` so the parent
// refreshes its list. FSA prefixes are typed free-form (comma/space separated)
// and normalized into the chip preview shown below the field.
const props = defineProps<{ region: WithId<RegionDoc> | null }>();
const emit = defineEmits<{ saved: []; cancel: [] }>();

const toast = useToast();

const provinceOptions = CA_PROVINCES.map((p) => ({ label: p.label, value: p.code }));
const statusOptions = ["active", "paused"].map((v) => ({
  label: v[0].toUpperCase() + v.slice(1),
  value: v,
}));

const form = reactive({
  name: props.region?.name ?? "",
  province: props.region?.province ?? "BC",
  prefixesText: (props.region?.fsaPrefixes ?? []).join(", "),
  repId: props.region?.repId ?? "",
  status: props.region?.status ?? "active",
  thresholdActive: props.region?.marketing?.thresholdActive ?? 40,
});

// Normalized, de-duped prefixes parsed from the free-form field.
const parsedPrefixes = computed(() => [
  ...new Set(form.prefixesText.split(/[\s,]+/).map(normalizePostal).filter(Boolean)),
]);

const saving = ref(false);

async function submit() {
  const parsed = regionSchema.safeParse({
    id: props.region?.id,
    name: form.name,
    province: form.province,
    fsaPrefixes: parsedPrefixes.value,
    repId: form.repId.trim() ? form.repId.trim() : null,
    status: form.status,
    thresholdActive: form.thresholdActive,
  });
  if (!parsed.success) {
    toast.warn("Check the form", parsed.error.issues[0]?.message ?? "Some fields are invalid.");
    return;
  }
  saving.value = true;
  try {
    await saveRegion(parsed.data);
    toast.success("Saved", `${parsed.data.name} was saved.`);
    emit("saved");
  } catch (e) {
    toast.error("Couldn't save", humanizeError(e));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form class="bs-card p-4 space-y-3" @submit.prevent="submit">
    <div class="grid sm:grid-cols-2 gap-3">
      <div>
        <label class="text-xs font-medium block mb-1">Region name</label>
        <InputText v-model="form.name" class="w-full" placeholder="Northern BC" />
      </div>
      <div>
        <label class="text-xs font-medium block mb-1">Province</label>
        <Select
          v-model="form.province"
          :options="provinceOptions"
          option-label="label"
          option-value="value"
          class="w-full"
        />
      </div>
    </div>

    <div>
      <label class="text-xs font-medium block mb-1">Postal (FSA) prefixes</label>
      <InputText v-model="form.prefixesText" class="w-full" placeholder="V8, V9, V2N" />
      <div class="flex flex-wrap gap-1 mt-1.5">
        <span
          v-for="p in parsedPrefixes"
          :key="p"
          class="text-[11px] px-2 py-0.5 rounded-full"
          style="background-color: var(--bs-surface-alt); color: var(--bs-blue)"
        >
          {{ p }}
        </span>
        <span v-if="!parsedPrefixes.length" class="text-[11px] text-[color:var(--bs-muted)]">
          Type the first 1-3 characters of the postal codes this region covers.
        </span>
      </div>
    </div>

    <div class="grid sm:grid-cols-2 gap-3">
      <div>
        <label class="text-xs font-medium block mb-1">Assigned rep (user id)</label>
        <InputText v-model="form.repId" class="w-full" placeholder="Optional — leave blank if unassigned" />
        <p class="text-[11px] text-[color:var(--bs-muted)] mt-1">
          The rep still needs the sales role granted in the Users console to see their dashboard.
        </p>
      </div>
      <div>
        <label class="text-xs font-medium block mb-1">Status</label>
        <Select
          v-model="form.status"
          :options="statusOptions"
          option-label="label"
          option-value="value"
          class="w-full"
        />
      </div>
    </div>

    <div>
      <label class="text-xs font-medium block mb-1">Active tradespeople to unlock a marketing budget</label>
      <InputNumber v-model="form.thresholdActive" :min="1" :max="100000" class="w-full" show-buttons />
    </div>

    <div class="flex justify-end gap-2 pt-1">
      <Button label="Cancel" text :disabled="saving" @click="emit('cancel')" />
      <Button label="Save region" icon="pi pi-save" type="submit" :loading="saving" />
    </div>
  </form>
</template>
