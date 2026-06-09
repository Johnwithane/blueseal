<script setup lang="ts">
import { computed } from "vue";
import Button from "primevue/button";
import type { RebateProgramDoc, RebateLevel, WithId } from "@/firebase/interfaces";
import { CA_PROVINCES } from "@/data/provinces";

// One rebate/grant program. Shown in the post-a-job panel and the admin list.
// Deliberately frames everything as "may apply": criteria are shown, never an
// eligibility verdict, and the only call-to-action sends the user to the
// official source to confirm and apply.
const props = defineProps<{
  program: WithId<RebateProgramDoc>;
}>();

const LEVEL_LABEL: Record<RebateLevel, string> = {
  federal: "Federal",
  provincial: "Provincial",
  municipal: "Municipal",
  utility: "Utility",
};

const levelLabel = computed(() => LEVEL_LABEL[props.program.level]);

// "Federal · Canada-wide" or "Provincial · ON, BC" — keeps coverage explicit.
const coverage = computed(() => {
  if (props.program.national) return "Canada-wide";
  const codes = props.program.provinces;
  const names = codes
    .map((c) => CA_PROVINCES.find((p) => p.code === c)?.code ?? c)
    .join(", ");
  return names || "—";
});

const verified = computed(() => {
  const d = props.program.lastVerifiedAt?.toDate?.();
  if (!d) return "";
  return d.toLocaleDateString("en-CA", { month: "short", year: "numeric" });
});

const isActive = computed(() => props.program.status === "active");
</script>

<template>
  <article class="bs-card p-4">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h4 class="font-semibold text-sm leading-snug">{{ program.name }}</h4>
        <p class="text-xs text-[color:var(--bs-muted)] mt-0.5">{{ program.provider }}</p>
      </div>
      <span
        v-if="!isActive"
        class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize bg-slate-100 text-slate-600"
      >
        {{ program.status }}
      </span>
    </div>

    <div class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
      <span class="rounded-full bg-[color:var(--bs-blue)]/10 text-[color:var(--bs-blue)] px-2 py-0.5 font-medium">
        {{ levelLabel }}
      </span>
      <span class="rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">{{ coverage }}</span>
    </div>

    <p class="mt-2 text-sm">{{ program.summary }}</p>

    <p v-if="program.amountNote" class="mt-2 text-sm font-medium">
      {{ program.amountNote }}
    </p>

    <div class="mt-2">
      <p class="text-xs font-medium text-[color:var(--bs-muted)]">Who may qualify</p>
      <p class="text-xs text-[color:var(--bs-muted)]">{{ program.eligibilityNote }}</p>
    </div>

    <div class="mt-3 flex items-center justify-between gap-2">
      <span v-if="verified" class="text-[11px] text-[color:var(--bs-muted)]">
        <i class="pi pi-check-circle text-[10px] mr-0.5"></i>Verified {{ verified }}
      </span>
      <a :href="program.officialUrl" target="_blank" rel="noopener noreferrer" class="ml-auto">
        <Button label="Check eligibility & apply" icon="pi pi-external-link" icon-pos="right" size="small" text />
      </a>
    </div>
  </article>
</template>
