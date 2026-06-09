<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { RebateProgramDoc, WithId } from "@/firebase/interfaces";
import { listRebatePrograms } from "@/firebase/services/rebatePrograms";
import { rebateMatchesJob, REBATE_DISCLAIMER } from "@/data/rebatePrograms";
import { provinceLabel } from "@/data/provinces";
import StatusBanner from "@/components/StatusBanner.vue";
import RebateCard from "@/components/RebateCard.vue";

// Contextual "you may qualify" panel inside the post-a-job flow. Surfaces up to
// a handful of ACTIVE rebate/grant programs that match the chosen trade and
// (once known) province. Renders nothing when there's no match, so it never
// nags on a non-energy job and never implies eligibility.
const props = defineProps<{
  trade: string;
  region: string;
}>();

const MAX = 4;

const programs = ref<WithId<RebateProgramDoc>[]>([]);
const loaded = ref(false);

// Lazy-load once a trade is chosen — avoids a Firestore read for visitors who
// never get that far. The list is tiny, so we filter in memory afterward.
watch(
  () => props.trade,
  async (trade) => {
    if (trade && !loaded.value) {
      loaded.value = true;
      try {
        programs.value = await listRebatePrograms();
      } catch {
        programs.value = [];
      }
    }
  },
  { immediate: true },
);

const matches = computed(() =>
  props.trade
    ? programs.value
        .filter((p) => rebateMatchesJob(p, { trade: props.trade, region: props.region }))
        .slice(0, MAX)
    : [],
);

const locationNote = computed(() => {
  const code = props.region.trim().toUpperCase();
  return code ? `in ${provinceLabel(code)}` : "";
});
</script>

<template>
  <StatusBanner
    v-if="matches.length"
    severity="info"
    icon="pi-lightbulb"
    title="Rebates & grants you may qualify for"
  >
    <template #body>
      <p class="text-sm text-[color:var(--bs-muted)] mt-1">
        This kind of work {{ locationNote ? `${locationNote} ` : "" }}may be eligible for
        government or utility programs. Eligibility and amounts are set by each program —
        we can't confirm them, so check directly.
      </p>

      <div class="mt-3 space-y-3">
        <RebateCard v-for="p in matches" :key="p.id" :program="p" />
      </div>

      <p class="mt-3 text-[11px] text-[color:var(--bs-muted)]">{{ REBATE_DISCLAIMER }}</p>
    </template>
  </StatusBanner>
</template>
