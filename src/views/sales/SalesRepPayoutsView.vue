<script setup lang="ts">
import { ref, watch } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { useToast } from "@/composables/useToast";
import { useFormatters } from "@/composables/useFormatters";
import RepPayoutsPanel from "@/components/sales/RepPayoutsPanel.vue";
import { useRepEarnings } from "@/composables/useRepEarnings";
import { MIN_PAYOUT_CENTS } from "@/utils/repEarnings";
import { getTradesperson } from "@/firebase/services/tradespeople";

// /sales/payouts — Stripe Connect onboarding + the rep's earnings + payout
// history. /return + /refresh mirror Stripe's hosted-form redirect targets
// (mount the same view, toast, then rewrite the URL), exactly like the
// tradesperson PayoutsOnboardingView.
const route = useRoute();
const router = useRouter();
const toast = useToast();
const { date } = useFormatters();

const { summary, payouts, loading } = useRepEarnings();

watch(
  () => route.name,
  (name) => {
    if (name === "SalesPayoutsReturn") {
      toast.success("Stripe says your details are submitted. Give it a few seconds to confirm.");
      void router.replace({ name: "SalesPayouts" });
    } else if (name === "SalesPayoutsRefresh") {
      toast.info("Your onboarding link expired. Click 'Continue Stripe setup' to generate a new one.");
      void router.replace({ name: "SalesPayouts" });
    }
  },
  { immediate: true },
);

function fmtMoney(cents: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}

// Resolve tradesperson display names for the per-tradesperson breakdown (P3-09).
// The ledger only carries tradespersonIds; names come from the public profile
// doc (readable while the tradie is visible). Cached; falls back to a short id.
const tradieNames = ref<Record<string, string>>({});
function tradieLabel(uid: string): string {
  return tradieNames.value[uid] ?? `Tradesperson ${uid.slice(0, 6)}`;
}
watch(
  () => summary.value.byTradie.map((t) => t.tradespersonId),
  async (ids) => {
    const missing = ids.filter((id) => !(id in tradieNames.value));
    if (missing.length === 0) return;
    await Promise.all(
      missing.map(async (id) => {
        try {
          const doc = await getTradesperson(id);
          if (doc?.displayName) tradieNames.value[id] = doc.displayName;
        } catch {
          /* not readable (unvisible tradie) — keep the id fallback */
        }
      }),
    );
  },
  { immediate: true },
);

function batchStatus(s: string): { label: string; cls: string } {
  switch (s) {
    case "paid":
      return { label: "Paid", cls: "bg-[color:var(--bs-success-tint)] text-[color:var(--bs-success-text)]" };
    case "pending":
      return { label: "Processing", cls: "bg-[color:var(--bs-info-tint)] text-[color:var(--bs-info-text)]" };
    case "failed":
      return { label: "Failed", cls: "bg-[color:var(--bs-danger-tint)] text-[color:var(--bs-danger-text)]" };
    default:
      return { label: s, cls: "bg-[color:var(--bs-info-tint)] text-[color:var(--bs-info-text)]" };
  }
}

// Newest payout batch first (queries skip orderBy to avoid a composite index).
const sortedPayouts = () =>
  [...payouts.value].sort((a, b) => (b.periodEnd?.toMillis?.() ?? 0) - (a.periodEnd?.toMillis?.() ?? 0));
</script>

<template>
  <section class="bs-container py-6 max-w-2xl">
    <div class="mb-4">
      <RouterLink to="/sales" class="text-sm text-[color:var(--bs-muted)] hover:underline">
        <i class="pi pi-arrow-left text-xs"></i>
        Back to sales
      </RouterLink>
    </div>

    <h1 class="text-lg font-semibold mb-4">Earnings &amp; payouts</h1>

    <!-- Earnings summary -->
    <div v-if="!loading" class="grid grid-cols-2 gap-3 mb-4">
      <div class="bs-card p-4">
        <div class="text-xs text-[color:var(--bs-muted)]">Unpaid balance</div>
        <div class="text-xl font-semibold tabular-nums mt-1">{{ fmtMoney(summary.unpaidCents) }}</div>
        <div class="text-[11px] text-[color:var(--bs-muted)] mt-1">
          <template v-if="summary.meetsMinimum">Pays out on the 1st</template>
          <template v-else>Pays out once it reaches {{ fmtMoney(MIN_PAYOUT_CENTS) }}</template>
        </div>
      </div>
      <div class="bs-card p-4">
        <div class="text-xs text-[color:var(--bs-muted)]">Paid to date</div>
        <div class="text-xl font-semibold tabular-nums mt-1">{{ fmtMoney(summary.lifetimePaidCents) }}</div>
        <div class="text-[11px] text-[color:var(--bs-muted)] mt-1">
          {{ summary.earnerCount }} earning {{ summary.earnerCount === 1 ? "tradesperson" : "tradespeople" }}
        </div>
      </div>
    </div>

    <!-- Connect onboarding -->
    <RepPayoutsPanel class="mb-4" />

    <!-- How rep payouts work -->
    <div class="bs-card p-5 mb-4">
      <h3 class="text-base font-semibold">How your payouts work</h3>
      <ul class="mt-2 list-disc pl-5 text-sm text-[color:var(--bs-text)]/85 space-y-1">
        <li>You earn <strong>10%</strong> of the Blue Seal revenue your tradespeople generate (their Pro subscription plus the platform portion of each job's service fee).</li>
        <li>On the 1st of each month, your balance pays out to your connected bank account, as long as it has reached {{ fmtMoney(MIN_PAYOUT_CENTS) }}. A smaller balance rolls over.</li>
        <li>Refunds and chargebacks are netted out of your balance.</li>
      </ul>
    </div>

    <!-- Per-tradesperson earnings breakdown (P3-09) -->
    <div v-if="!loading && summary.byTradie.length > 0" class="bs-card p-5 mb-4">
      <h3 class="text-base font-semibold">Earnings by tradesperson</h3>
      <p class="text-xs text-[color:var(--bs-muted)] mt-0.5">
        Lifetime net commission per tradesperson (refunds netted out).
      </p>
      <ul class="mt-3 divide-y divide-[color:var(--bs-border)]">
        <li
          v-for="t in summary.byTradie"
          :key="t.tradespersonId"
          class="flex items-center justify-between gap-3 py-2.5"
        >
          <span class="min-w-0 flex-1 truncate text-sm">{{ tradieLabel(t.tradespersonId) }}</span>
          <span
            class="text-sm font-medium tabular-nums"
            :class="t.netCents < 0 ? 'text-[color:var(--bs-danger-text)]' : ''"
          >
            {{ fmtMoney(t.netCents) }}
          </span>
        </li>
      </ul>
    </div>

    <!-- Payout history -->
    <div v-if="payouts.length > 0" class="bs-card p-5">
      <h3 class="text-base font-semibold">Payout history</h3>
      <ul class="mt-3 divide-y divide-[color:var(--bs-border)]">
        <li
          v-for="p in sortedPayouts()"
          :key="p.id"
          class="flex items-center justify-between gap-3 py-3"
        >
          <div class="min-w-0 flex-1">
            <div class="font-medium tabular-nums">{{ fmtMoney(p.amountCents) }}</div>
            <div class="text-xs text-[color:var(--bs-muted)]">
              <span v-if="p.periodEnd?.toDate">{{ date(p.periodEnd.toDate()) }}</span>
              · {{ p.commissionIds.length }} entries
            </div>
          </div>
          <span :class="['text-xs font-medium rounded-full px-2 py-0.5', batchStatus(p.status).cls]">
            {{ batchStatus(p.status).label }}
          </span>
        </li>
      </ul>
    </div>
  </section>
</template>
