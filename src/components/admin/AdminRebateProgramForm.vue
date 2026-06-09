<script setup lang="ts">
import { reactive, ref } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import MultiSelect from "primevue/multiselect";
import ToggleSwitch from "primevue/toggleswitch";
import Checkbox from "primevue/checkbox";
import { TRADES } from "@/data/trades";
import { CA_PROVINCES } from "@/data/provinces";
import { rebateProgramSchema } from "@/validation/rebateProgramSchema";
import { saveRebateProgram } from "@/firebase/services/rebatePrograms";
import type { RebateProgramDoc, WithId } from "@/firebase/interfaces";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

// Add/edit form for a single rebate program. Self-contained: validates with the
// shared Zod schema and writes via the service. Emits `saved` so the parent can
// refresh its list.
const props = defineProps<{
  program: WithId<RebateProgramDoc> | null;
}>();
const emit = defineEmits<{ saved: []; cancel: [] }>();

const toast = useToast();
const isEdit = !!props.program;

const tradeOptions = TRADES.map((t) => ({ label: t.label, value: t.key }));
const provinceOptions = CA_PROVINCES.map((p) => ({ label: p.label, value: p.code }));
const levelOptions = ["federal", "provincial", "municipal", "utility"].map((v) => ({
  label: v[0].toUpperCase() + v.slice(1),
  value: v,
}));
const statusOptions = ["active", "closed", "paused"].map((v) => ({
  label: v[0].toUpperCase() + v.slice(1),
  value: v,
}));

const form = reactive({
  slug: props.program?.slug ?? "",
  name: props.program?.name ?? "",
  provider: props.program?.provider ?? "",
  level: props.program?.level ?? "federal",
  national: props.program?.national ?? false,
  provinces: props.program?.provinces ?? [],
  trades: props.program?.trades ?? [],
  summary: props.program?.summary ?? "",
  amountNote: props.program?.amountNote ?? "",
  eligibilityNote: props.program?.eligibilityNote ?? "",
  officialUrl: props.program?.officialUrl ?? "",
  status: props.program?.status ?? "active",
});

// New programs are stamped verified on create; for edits the admin opts in so a
// cosmetic change doesn't falsely refresh the "Verified" date users see.
const markVerified = ref(!isEdit);
const saving = ref(false);

async function submit() {
  const parsed = rebateProgramSchema.safeParse({ ...form });
  if (!parsed.success) {
    toast.warn("Check the form", parsed.error.issues[0]?.message ?? "Some fields are invalid.");
    return;
  }
  saving.value = true;
  try {
    await saveRebateProgram(parsed.data, { markVerified: markVerified.value });
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
        <label class="text-xs font-medium block mb-1">Slug (id)</label>
        <InputText v-model="form.slug" class="w-full" :disabled="isEdit" placeholder="ontario-home-renovation-savings" />
        <p v-if="isEdit" class="text-[11px] text-[color:var(--bs-muted)] mt-1">Slug is the id and can't change.</p>
      </div>
      <div>
        <label class="text-xs font-medium block mb-1">Program name</label>
        <InputText v-model="form.name" class="w-full" />
      </div>
    </div>

    <div class="grid sm:grid-cols-2 gap-3">
      <div>
        <label class="text-xs font-medium block mb-1">Provider</label>
        <InputText v-model="form.provider" class="w-full" placeholder="Natural Resources Canada" />
      </div>
      <div>
        <label class="text-xs font-medium block mb-1">Level</label>
        <Select v-model="form.level" :options="levelOptions" option-label="label" option-value="value" class="w-full" />
      </div>
    </div>

    <div class="grid sm:grid-cols-[auto_1fr] gap-3 items-start">
      <div>
        <label class="text-xs font-medium block mb-1">Canada-wide</label>
        <ToggleSwitch v-model="form.national" />
      </div>
      <div v-if="!form.national">
        <label class="text-xs font-medium block mb-1">Provinces</label>
        <MultiSelect
          v-model="form.provinces"
          :options="provinceOptions"
          option-label="label"
          option-value="value"
          filter
          display="chip"
          placeholder="Select provinces"
          class="w-full"
        />
      </div>
    </div>

    <div>
      <label class="text-xs font-medium block mb-1">Trades</label>
      <MultiSelect
        v-model="form.trades"
        :options="tradeOptions"
        option-label="label"
        option-value="value"
        filter
        display="chip"
        placeholder="Select trades this applies to"
        class="w-full"
      />
    </div>

    <div>
      <label class="text-xs font-medium block mb-1">Summary</label>
      <Textarea v-model="form.summary" rows="2" class="w-full" :maxlength="400" />
    </div>

    <div>
      <label class="text-xs font-medium block mb-1">Amount (qualitative)</label>
      <InputText v-model="form.amountNote" class="w-full" placeholder="Up to $5,000" />
    </div>

    <div>
      <label class="text-xs font-medium block mb-1">Eligibility conditions</label>
      <Textarea v-model="form.eligibilityNote" rows="3" class="w-full" :maxlength="800" />
    </div>

    <div class="grid sm:grid-cols-2 gap-3">
      <div>
        <label class="text-xs font-medium block mb-1">Official URL</label>
        <InputText v-model="form.officialUrl" class="w-full" placeholder="https://…" />
      </div>
      <div>
        <label class="text-xs font-medium block mb-1">Status</label>
        <Select v-model="form.status" :options="statusOptions" option-label="label" option-value="value" class="w-full" />
      </div>
    </div>

    <label class="flex items-center gap-2 text-sm">
      <Checkbox v-model="markVerified" :binary="true" />
      Mark as verified against the official source as of today
    </label>

    <div class="flex justify-end gap-2 pt-1">
      <Button label="Cancel" text :disabled="saving" @click="emit('cancel')" />
      <Button label="Save program" icon="pi pi-save" type="submit" :loading="saving" />
    </div>
  </form>
</template>
