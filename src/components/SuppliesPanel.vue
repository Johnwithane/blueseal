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
import { catalogForTrade, type SupplyItem } from "@/data/suppliesCatalog";
import {
  SUPPLY_CATEGORY_LABELS,
  SUPPLY_CATEGORY_ORDER,
  buildSearchUrl,
  defaultSearchPartner,
  getPartner,
  partnerLink,
  partnersForCategory,
  partnersForTrade,
  type SupplyCategory,
  type SupplyPartner,
} from "@/data/supplyPartners";
import { track } from "@/utils/analytics";
import { sendAssistantMessage } from "@/firebase/services/assistant";
import { usePaywallStore } from "@/stores/paywall";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{
  job: WithId<JobDoc>;
}>();

const paywall = usePaywallStore();
const toast = useToast();

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

// ----- per-trade quick-pick catalog -----
interface CatalogGroup {
  name: string;
  items: SupplyItem[];
}
// Items for this job's trade, grouped by section (order preserved). Empty for
// unseeded trades → the block is hidden and the search box carries the panel.
const catalogGroups = computed<CatalogGroup[]>(() => {
  const groups: CatalogGroup[] = [];
  for (const item of catalogForTrade(props.job.trade)) {
    const last = groups[groups.length - 1];
    if (last && last.name === item.group) last.items.push(item);
    else groups.push({ name: item.group, items: [item] });
  }
  return groups;
});
// Catalog quick-picks shop from the supplier the tradie has selected above,
// unless the item names its own preferred partner.
function partnerForItem(item: SupplyItem): SupplyPartner {
  return (item.defaultPartnerId && getPartner(item.defaultPartnerId)) || searchPartner.value;
}
function shopItem(item: SupplyItem) {
  const partner = partnerForItem(item);
  trackClick(partner, "catalog");
  openExternal(buildSearchUrl(partner, item.query));
}
function logItem(item: SupplyItem) {
  const partner = partnerForItem(item);
  void track("supply_expense_prefill", {
    partnerId: partner.id,
    category: "materials",
    trade: props.job.trade,
    jobId: props.job.id,
  });
  emit("log-expense", { vendor: partner.name, description: item.label, category: "materials" });
}

// ----- AI shopping list (Blue Seal Pro) -----
// Reuses the existing Pro-gated assistant (aiChat). Asks for a clean bulleted
// list of buyable materials for this job, parsed into shoppable rows. The
// server runs requireAiEntitlement first, so non-Pro tradies get the paywall
// (no inference spent); the client just funnels the error.
const AI_SHOPPING_PROMPT =
  "List the parts, materials and consumables I should buy for this job. " +
  "Reply with ONLY a simple bulleted list — one item per line starting with " +
  "'- ', each naming the item with a typical size or spec where it matters " +
  "(e.g. '- 1/2\" copper pipe, type L'). Keep it to what's likely needed, not " +
  "exhaustive. No preamble, no headings, no tools-only section. This is " +
  "read-only — do not call any tools or change anything on the job.";

const aiLoading = ref(false);
const aiItems = ref<string[]>([]);
// Reused across refreshes so repeated generations don't spawn new threads.
const aiConversationId = ref<string | undefined>(undefined);

function parseShoppingList(reply: string): string[] {
  return reply
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-*•]\s+/.test(l))
    .map((l) => l.replace(/^[-*•]\s+/, "").replace(/\*\*/g, "").trim())
    .filter((l) => l.length > 0)
    .slice(0, 25);
}

async function generateAiList() {
  aiLoading.value = true;
  try {
    const res = await sendAssistantMessage({
      scope: "job",
      jobId: props.job.id,
      conversationId: aiConversationId.value,
      message: AI_SHOPPING_PROMPT,
      hidden: true,
    });
    aiConversationId.value = res.conversationId;
    aiItems.value = parseShoppingList(res.reply);
    void track("supply_ai_list", {
      trade: props.job.trade,
      jobId: props.job.id,
      count: aiItems.value.length,
    });
    if (!aiItems.value.length) {
      toast.info("Nothing to show", "The assistant didn't return a clear list — try the chat for detail.");
    }
  } catch (e) {
    if (paywall.fromError(e)) return;
    toast.error("Couldn't generate list", humanizeError(e));
  } finally {
    aiLoading.value = false;
  }
}

function shopAiItem(text: string) {
  trackClick(searchPartner.value, "ai");
  openExternal(buildSearchUrl(searchPartner.value, text));
}
function logAiItem(text: string) {
  void track("supply_expense_prefill", {
    partnerId: searchPartner.value.id,
    category: "materials",
    trade: props.job.trade,
    jobId: props.job.id,
  });
  emit("log-expense", { vendor: searchPartner.value.name, description: text, category: "materials" });
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
  openExternal(partnerLink(partner));
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

    <!-- AI shopping list (Blue Seal Pro) — a job-specific list from the brief. -->
    <div class="mt-3">
      <Button
        :label="aiItems.length ? 'Refresh AI list' : 'Ask AI what to bring'"
        icon="pi pi-sparkles"
        size="small"
        outlined
        class="w-full"
        :loading="aiLoading"
        @click="generateAiList"
      />
      <div
        v-if="aiItems.length"
        class="mt-2 rounded-lg border border-[color:var(--bs-border)] p-3"
      >
        <div class="text-[11px] font-medium uppercase tracking-wide text-[color:var(--bs-muted)]">
          AI suggestions for this job
        </div>
        <ul class="mt-1 divide-y divide-[color:var(--bs-border)]">
          <li
            v-for="(item, i) in aiItems"
            :key="i"
            class="flex items-center gap-2 py-1.5"
          >
            <span class="flex-1 min-w-0 text-sm">{{ item }}</span>
            <Button
              label="Shop"
              icon="pi pi-external-link"
              size="small"
              text
              @click="shopAiItem(item)"
            />
            <Button
              icon="pi pi-plus"
              size="small"
              text
              aria-label="Log as expense"
              @click="logAiItem(item)"
            />
          </li>
        </ul>
        <p class="mt-2 text-[11px] text-[color:var(--bs-muted)]">
          AI-generated from the job details — double-check quantities and specs before you buy.
        </p>
      </div>
    </div>

    <!-- Per-trade quick-picks — what this trade usually needs, one tap to shop
         or log. Hidden for trades we haven't seeded; the search box covers them. -->
    <div v-if="catalogGroups.length" class="mt-3">
      <div class="text-[11px] font-medium uppercase tracking-wide text-[color:var(--bs-muted)]">
        Common for {{ tradeLabel(job.trade) }} jobs
      </div>
      <div v-for="g in catalogGroups" :key="g.name" class="mt-2">
        <div class="text-xs font-medium">{{ g.name }}</div>
        <ul class="mt-1 divide-y divide-[color:var(--bs-border)]">
          <li v-for="item in g.items" :key="item.query" class="flex items-center gap-2 py-1.5">
            <span class="flex-1 min-w-0 truncate text-sm">{{ item.label }}</span>
            <Button
              label="Shop"
              icon="pi pi-external-link"
              size="small"
              text
              @click="shopItem(item)"
            />
            <Button
              icon="pi pi-plus"
              size="small"
              text
              aria-label="Log as expense"
              @click="logItem(item)"
            />
          </li>
        </ul>
      </div>
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
