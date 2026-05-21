<script setup lang="ts">
import { computed } from "vue";
import InputText from "primevue/inputtext";
import Textarea from "primevue/textarea";
import InputNumber from "primevue/inputnumber";
import Select from "primevue/select";
import MultiSelect from "primevue/multiselect";
import ToggleSwitch from "primevue/toggleswitch";
import DatePicker from "primevue/datepicker";
import type { IntakeField } from "@/firebase/interfaces";

const props = defineProps<{
  fields: IntakeField[];
  readonly?: boolean;
}>();

const model = defineModel<Record<string, unknown>>({ required: true });

const safe = computed({
  get: () => model.value ?? {},
  set: (v) => (model.value = v),
});

function setVal(key: string, v: unknown) {
  safe.value = { ...safe.value, [key]: v };
}
</script>

<template>
  <div class="bs-form space-y-4">
    <div v-for="f in props.fields" :key="f.key">
      <label class="text-sm font-medium">
        {{ f.label }}
        <span v-if="f.required" class="text-red-600">*</span>
      </label>

      <template v-if="f.type === 'text'">
        <InputText
          :model-value="safe[f.key] as string"
          :disabled="props.readonly"
          class="mt-1 w-full"
          @update:model-value="(v) => setVal(f.key, v)"
        />
      </template>

      <template v-else-if="f.type === 'textarea'">
        <Textarea
          :model-value="safe[f.key] as string"
          :disabled="props.readonly"
          rows="3"
          class="mt-1"
          @update:model-value="(v) => setVal(f.key, v)"
        />
      </template>

      <template v-else-if="f.type === 'number'">
        <InputNumber
          :model-value="safe[f.key] as number"
          :disabled="props.readonly"
          class="mt-1 w-full"
          show-buttons
          @update:model-value="(v) => setVal(f.key, v)"
        />
      </template>

      <template v-else-if="f.type === 'select'">
        <Select
          :model-value="safe[f.key]"
          :options="f.options"
          option-label="label"
          option-value="value"
          :disabled="props.readonly"
          class="mt-1 w-full"
          @update:model-value="(v) => setVal(f.key, v)"
        />
      </template>

      <template v-else-if="f.type === 'multiselect'">
        <MultiSelect
          :model-value="(safe[f.key] as string[]) ?? []"
          :options="f.options"
          option-label="label"
          option-value="value"
          :disabled="props.readonly"
          class="mt-1 w-full"
          @update:model-value="(v) => setVal(f.key, v)"
        />
      </template>

      <template v-else-if="f.type === 'boolean'">
        <div class="mt-1">
          <ToggleSwitch
            :model-value="!!safe[f.key]"
            :disabled="props.readonly"
            @update:model-value="(v) => setVal(f.key, v)"
          />
        </div>
      </template>

      <template v-else-if="f.type === 'date'">
        <DatePicker
          :model-value="(safe[f.key] as Date | null) ?? null"
          :disabled="props.readonly"
          show-icon
          class="mt-1 w-full"
          @update:model-value="(v) => setVal(f.key, v)"
        />
      </template>

      <small v-if="f.helpText" class="text-[color:var(--bs-muted)]">{{ f.helpText }}</small>
    </div>
  </div>
</template>
