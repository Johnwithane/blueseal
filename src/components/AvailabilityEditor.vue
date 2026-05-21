<script setup lang="ts">
import { computed } from "vue";
import Button from "primevue/button";
import InputMask from "primevue/inputmask";
import type { AvailabilityBlock, WeeklyAvailability } from "@/firebase/interfaces";

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
</script>

<template>
  <div class="space-y-3">
    <div v-for="d in days" :key="d.key" class="bs-card p-3">
      <div class="flex items-center justify-between mb-2">
        <div class="font-semibold text-sm">{{ d.label }}</div>
        <Button text size="small" icon="pi pi-plus" label="Add block" @click="addBlock(d.key)" />
      </div>
      <div v-if="!model[d.key].length" class="text-xs text-[color:var(--bs-muted)]">Off</div>
      <div v-for="(block, idx) in model[d.key]" :key="idx" class="flex items-center gap-2 mt-1">
        <InputMask
          :model-value="block.start"
          mask="99:99"
          placeholder="09:00"
          @update:model-value="(v) => updateBlock(d.key, idx, { start: String(v ?? '') })"
        />
        <span class="text-[color:var(--bs-muted)]">–</span>
        <InputMask
          :model-value="block.end"
          mask="99:99"
          placeholder="17:00"
          @update:model-value="(v) => updateBlock(d.key, idx, { end: String(v ?? '') })"
        />
        <Button text icon="pi pi-times" severity="danger" @click="removeBlock(d.key, idx)" />
      </div>
    </div>
  </div>
</template>
