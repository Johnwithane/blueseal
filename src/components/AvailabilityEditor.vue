<script setup lang="ts">
import { computed } from "vue";
import Button from "primevue/button";
import InputMask from "primevue/inputmask";
import type { AvailabilityBlock, WeeklyAvailability } from "@/firebase/interfaces";
import { formatTimeOfDay } from "@/composables/useFormatters";

const model = defineModel<WeeklyAvailability>({ required: true });

const days = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
] as const;

type DayKey = (typeof days)[number]["key"];

const safe = computed<WeeklyAvailability>({
  get: () => model.value,
  set: (v) => (model.value = v),
});

function addBlock(day: DayKey) {
  safe.value[day] = [...safe.value[day], { start: "09:00", end: "17:00" }];
}

function removeBlock(day: DayKey, idx: number) {
  safe.value[day] = safe.value[day].filter((_, i) => i !== idx);
}

function updateBlock(day: DayKey, idx: number, patch: Partial<AvailabilityBlock>) {
  safe.value[day] = safe.value[day].map((b, i) => (i === idx ? { ...b, ...patch } : b));
}

// The stored wire format is "HH:mm" and the InputMask edits it directly — a
// 12-hour mask with an am/pm toggle would be a much bigger change for a field
// you fill once. So the fields stay 24-hour and each row carries a live
// 12-hour read-back, which is what issue #17 was actually about: never having
// to work out what 17:00 means. Blank while a value is half-typed.
function blockLabel(block: AvailabilityBlock): string {
  const start = formatTimeOfDay(block.start);
  const end = formatTimeOfDay(block.end);
  return start && end ? `${start} – ${end}` : "";
}
</script>

<template>
  <div class="space-y-3">
    <div v-for="d in days" :key="d.key" class="bs-card p-3">
      <div class="flex items-center justify-between mb-2">
        <div class="font-semibold text-sm">{{ d.label }}</div>
        <Button text size="small" icon="pi pi-plus" label="Add block" @click="addBlock(d.key)" />
      </div>
      <div v-if="!model[d.key].length" class="text-xs text-[color:var(--bs-muted)]">Off</div>
      <div v-for="(block, idx) in model[d.key]" :key="idx" class="mt-1">
        <div class="flex items-center gap-2">
          <InputMask
            :model-value="block.start"
            mask="99:99"
            placeholder="09:00"
            class="w-24 min-w-0"
            @update:model-value="(v) => updateBlock(d.key, idx, { start: String(v ?? '') })"
          />
          <span class="text-[color:var(--bs-muted)]">–</span>
          <InputMask
            :model-value="block.end"
            mask="99:99"
            placeholder="17:00"
            class="w-24 min-w-0"
            @update:model-value="(v) => updateBlock(d.key, idx, { end: String(v ?? '') })"
          />
          <Button
            text
            icon="pi pi-times"
            severity="danger"
            class="shrink-0"
            aria-label="Remove this block"
            @click="removeBlock(d.key, idx)"
          />
        </div>
        <p v-if="blockLabel(block)" class="mt-0.5 text-xs text-[color:var(--bs-muted)]">
          {{ blockLabel(block) }}
        </p>
      </div>
    </div>
  </div>
</template>
