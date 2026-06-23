<script setup lang="ts">
// Free-text "services offered" editor — a controlled chip list shared by the
// three places a services list is edited: the tradesperson onboarding wizard,
// the account dashboard, and the admin prospect editor. Type a service and press
// Enter (or comma) to add; click × (or Backspace on an empty input) to remove.
// All bounds + de-duplication live in src/utils/services.ts so every surface
// behaves identically and the stored value is always clean.
import { ref, computed } from "vue";
import InputText from "primevue/inputtext";
import Button from "primevue/button";
import { SERVICES_MAX, SERVICE_NAME_MAX, normalizeServices } from "@/utils/services";

const props = withDefaults(
  defineProps<{
    modelValue: string[];
    max?: number;
    placeholder?: string;
  }>(),
  { max: SERVICES_MAX, placeholder: "e.g. Boiler installation" },
);
const emit = defineEmits<{ "update:modelValue": [string[]] }>();

const draft = ref("");
const atMax = computed(() => props.modelValue.length >= props.max);

function commit(next: string[]) {
  emit("update:modelValue", normalizeServices(next).slice(0, props.max));
}

function addFromDraft() {
  if (!draft.value.trim()) return;
  // A pasted "a, b, c" splits into separate chips; normalizeServices dedupes.
  commit([...props.modelValue, ...draft.value.split(",")]);
  draft.value = "";
}

function remove(i: number) {
  const next = props.modelValue.slice();
  next.splice(i, 1);
  commit(next);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    addFromDraft();
  } else if (e.key === "Backspace" && !draft.value && props.modelValue.length) {
    remove(props.modelValue.length - 1);
  }
}
</script>

<template>
  <div>
    <div v-if="modelValue.length" class="services-chips">
      <span v-for="(s, i) in modelValue" :key="`${s}-${i}`" class="services-chip">
        <span class="truncate">{{ s }}</span>
        <button
          type="button"
          class="services-chip__x"
          :aria-label="`Remove ${s}`"
          @click="remove(i)"
        >
          <i class="pi pi-times" aria-hidden="true" />
        </button>
      </span>
    </div>
    <div class="mt-2 flex gap-2">
      <InputText
        v-model="draft"
        :placeholder="atMax ? `Up to ${max} services added` : placeholder"
        :maxlength="SERVICE_NAME_MAX"
        :disabled="atMax"
        class="flex-1"
        @keydown="onKeydown"
      />
      <Button
        type="button"
        label="Add"
        icon="pi pi-plus"
        severity="secondary"
        outlined
        :disabled="atMax || !draft.trim()"
        @click="addFromDraft"
      />
    </div>
    <p class="mt-1 text-xs text-[color:var(--bs-muted)]">
      Press Enter to add each service. {{ modelValue.length }}/{{ max }}
    </p>
  </div>
</template>

<style scoped>
.services-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.services-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  max-width: 100%;
  padding: 0.25rem 0.35rem 0.25rem 0.7rem;
  border-radius: 999px;
  background: var(--bs-surface-alt);
  border: 1px solid var(--bs-border);
  font-size: 0.8125rem;
  font-weight: 600;
  color: var(--bs-text);
}
.services-chip__x {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.15rem;
  height: 1.15rem;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--bs-muted);
  cursor: pointer;
}
.services-chip__x:hover {
  background: var(--bs-border);
  color: var(--bs-text);
}
.services-chip__x .pi {
  font-size: 0.7rem;
}
</style>
