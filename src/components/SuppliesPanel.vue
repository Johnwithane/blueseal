<script setup lang="ts">
// Supplies panel — tradesperson-only, Work Order tab, above the Expenses card.
// A genuine job-prep + cost-tracking tool: search a vetted Canadian supplier
// for what the job needs, then log what you bought as a job expense in one tap
// (the dialog opens pre-filled — you just type the amount). We earn affiliate
// commission on the click-throughs; clients never see this.
import { computed, ref } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import type { JobDoc, WithId } from "@/firebase/interfaces";
import type { ExpensePrefill } from "@/firebase/services/expenses";
import { tradeLabel } from "@/data/trades";
import {
  SUPPLY_CATEGORY_LABELS,
  SUPPLY_CATEGORY_ORDER,
  buildSearchUrl,
  defaultSearchPartner,
  partnersForCategory,
  partnersForTrade,
  type SupplyCategory,
  type SupplyPartner,
} from "@/data/supplyPartners";
import { track } from "@/utils/analytics";

const props = defineProps<{
  job: WithId<JobDoc>;
}>();

const emit = defineEmits<{
  // Open the Add-expense dialog pre-filled (handled by the parent → ExpensesCard).
  "log-expense": [prefill: ExpensePrefill];
}>();

// ----- search -----
const query = ref("");
const searchableMaterials = partnersForCategory("materials").filter((p) => p.searchUrlTemplate);
const searchPartner = ref<SupplyPartner>(defaultSearchPartner());

function openExternal(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function trackClick(partner: SupplyPartner, source: string) {
  void track("supply_partner_click", {
    partnerId: partner.id,
    category: partner.category,
    trade: props.job.trade,
    jobId: props.job.id,
    source,
  });
}

function runSearch() {
  const q = query.value.trim();
  if (!q) return;
  trackClick(searchPartner.value, "search");
  openExternal(buildSearchUrl(searchPartner.value, q));
}

// ----- category-filtered tiles -----
const activeCategory = ref<SupplyCategory>("materials");
// Partners relevant to this trade (all, until a partner declares a trade filter).
const relevantPartners = computed(() => partnersForTrade(props.job.trade));
const tiles = computed(() =>
  relevantPartners.value.filter((p) => p.category === activeCategory.value),
);

// Logging a purchase only makes sense for job-attributable spend (materials /
// job-specific rental) — not workwear or a software subscription.
function canLog(category: SupplyCategory): boolean {
  return category === "materials" || category === "rental";
}

function shopPartner(partner: SupplyPartner) {
  trackClick(partner, "tile");
  openExternal(partner.url);
}

function logFromPartner(partner: SupplyPartner) {
  void track("supply_expense_prefill", {
    partnerId: partner.id,
    category: partner.category,
    trade: props.job.trade,
    jobId: props.job.id,
  });
  emit("log-expense", { vendor: partner.name, category: "materials" });
}

function logFromSearch() {
  const q = query.value.trim();
  void track("supply_expense_prefill", {
    partnerId: searchPartner.value.id,
    category: "materials",
    trade: props.job.trade,
    jobId: props.job.id,
  });
  emit("log-expense", { vendor: searchPartner.value.name, description: q, category: "materials" });
}
</script>

<template>
  <div class="bs-card p-3">
    <header class="mb-2">
      <h3 class="font-semibold text-sm">Supplies for this job</h3>
      <p class="text-xs text-[color:var(--bs-muted)] mt-0.5">
        Find what you need for your {{ tradeLabel(job.trade) }} job and log it as an expense.
      </p>
    </header>

    <!-- Search a supplier for the part/material/tool this job needs. -->
    <div class="flex gap-2">
      <InputText
        v-model="query"
        placeholder="e.g. 1/2&quot; copper pipe"
        class="flex-1 min-w-0 text-sm"
        @keyup.enter="runSearch"
      />
      <Button
        icon="pi pi-search"
        aria-label="Search supplier"
        :disabled="!query.trim()"
        @click="runSearch"
      />
    </div>
    <div class="mt-2 flex items-center gap-2">
      <Select
        v-model="searchPartner"
        :options="searchableMaterials"
        option-label="name"
        data-key="id"
        class="flex-1 text-sm"
      />
      <Button
        label="Log it"
        icon="pi pi-plus"
        text
        size="small"
        :disabled="!query.trim()"
        @click="logFromSearch"
      />
    </div>

    <!-- Category chips -->
    <div class="mt-3 flex flex-wrap gap-1.5">
      <button
        v-for="cat in SUPPLY_CATEGORY_ORDER"
        :key="cat"
        type="button"
        class="rounded-full border px-3 py-1 text-xs transition-colors"
        :class="
          activeCategory === cat
            ? 'border-[color:var(--bs-blue)] bg-[color:var(--bs-blue)] text-white'
            : 'border-[color:var(--bs-border)] text-[color:var(--bs-muted)]'
        "
        @click="activeCategory = cat"
      >
        {{ SUPPLY_CATEGORY_LABELS[cat] }}
      </button>
    </div>

    <!-- Partner tiles for the active category -->
    <ul class="mt-3 space-y-2">
      <li
        v-for="p in tiles"
        :key="p.id"
        class="rounded-lg border border-[color:var(--bs-border)] p-3"
      >
        <div class="flex items-start gap-2">
          <i :class="[p.icon, 'mt-0.5 text-[color:var(--bs-muted)]']"></i>
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium">{{ p.name }}</div>
            <div class="text-xs text-[color:var(--bs-muted)] leading-snug">{{ p.blurb }}</div>
          </div>
        </div>
        <div class="mt-2 flex items-center gap-2">
          <Button
            label="Shop"
            icon="pi pi-external-link"
            size="small"
            outlined
            class="flex-1"
            @click="shopPartner(p)"
          />
          <Button
            v-if="canLog(p.category)"
            label="Log expense"
            icon="pi pi-plus"
            size="small"
            text
            @click="logFromPartner(p)"
          />
        </div>
      </li>
    </ul>

    <p class="mt-3 text-[11px] leading-snug text-[color:var(--bs-muted)]">
      Shopping through these links helps fund Blue Seal — we may earn a commission at no extra
      cost to you. We only list suppliers we'd use ourselves.
    </p>
  </div>
</template>
