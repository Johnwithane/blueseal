<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import SelectButton from "primevue/selectbutton";
import { storeToRefs } from "pinia";
import { useAuthStore } from "@/stores/auth";
import { useSubscriptionStore } from "@/stores/subscription";
import { listTradieInvoicesInRange } from "@/firebase/services/invoices";
import { listMyExpensesInRange } from "@/firebase/services/expenses";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import { centsToDollars, downloadCsv, toCsv } from "@/utils/csv";
import { useSeo } from "@/composables/useSeo";
import type { InvoiceDoc, ExpenseDoc, WithId } from "@/firebase/interfaces";

useSeo({ title: "Reports — Blue Seal", noindex: true });

const auth = useAuthStore();
const store = useSubscriptionStore();
const { isPro, loaded: subLoaded } = storeToRefs(store);
const { money } = useFormatters();
const toast = useToast();

const isAdmin = computed(() => (auth.roles ?? []).includes("admin"));
const gated = computed(() => subLoaded.value && !isPro.value && !isAdmin.value);

type Period = "month" | "quarter" | "year" | "lastYear";
const period = ref<Period>("month");
const periodOptions = [
  { label: "This month", value: "month" as const },
  { label: "This quarter", value: "quarter" as const },
  { label: "This year", value: "year" as const },
  { label: "Last year", value: "lastYear" as const },
];

function range(p: Period): { from: Date; to: Date } {
  const now = new Date();
  const y = now.getFullYear();
  if (p === "month") return { from: new Date(y, now.getMonth(), 1), to: new Date(y, now.getMonth() + 1, 0, 23, 59, 59) };
  if (p === "quarter") {
    const q = Math.floor(now.getMonth() / 3);
    return { from: new Date(y, q * 3, 1), to: new Date(y, q * 3 + 3, 0, 23, 59, 59) };
  }
  if (p === "lastYear") return { from: new Date(y - 1, 0, 1), to: new Date(y - 1, 11, 31, 23, 59, 59) };
  return { from: new Date(y, 0, 1), to: new Date(y, 11, 31, 23, 59, 59) };
}

const loading = ref(false);
const invoices = ref<WithId<InvoiceDoc>[]>([]);
const expenses = ref<Array<WithId<ExpenseDoc> & { jobId: string }>>([]);

const paidInvoices = computed(() => invoices.value.filter((i) => i.status === "paid"));
const revenueCents = computed(() => paidInvoices.value.reduce((s, i) => s + (i.total ?? 0), 0));
const taxCents = computed(() => paidInvoices.value.reduce((s, i) => s + (i.taxTotal ?? 0), 0));
const expenseCostCents = computed(() => expenses.value.reduce((s, e) => s + (e.totalCost ?? 0), 0));
const netCents = computed(() => revenueCents.value - expenseCostCents.value);

// Revenue by month (paid invoices), most recent first.
const byMonth = computed(() => {
  const map = new Map<string, number>();
  for (const inv of paidInvoices.value) {
    const ms = inv.issuedAt?.toMillis?.();
    if (ms == null) continue;
    const d = new Date(ms);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    map.set(key, (map.get(key) ?? 0) + (inv.total ?? 0));
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
});

async function load() {
  if (!auth.fbUser || gated.value) return;
  loading.value = true;
  try {
    const { from, to } = range(period.value);
    const [inv, exp] = await Promise.all([
      listTradieInvoicesInRange(auth.fbUser.uid, from, to),
      listMyExpensesInRange(auth.fbUser.uid, from, to),
    ]);
    invoices.value = inv;
    expenses.value = exp;
  } catch (e) {
    toast.error("Couldn't load reports", humanizeError(e));
  } finally {
    loading.value = false;
  }
}

onMounted(load);

function isoDate(ms: number | null | undefined): string {
  if (ms == null) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

function exportInvoices() {
  const rows = invoices.value.map((i) => [
    i.invoiceNumber,
    i.status,
    isoDate(i.issuedAt?.toMillis?.()),
    isoDate(i.paidAt?.toMillis?.()),
    i.jobId,
    i.currency,
    centsToDollars(i.subtotal ?? 0),
    centsToDollars(i.discountAmount ?? 0),
    centsToDollars(i.taxTotal ?? 0),
    centsToDollars(i.total ?? 0),
  ]);
  const csv = toCsv(
    ["Invoice", "Status", "Issued", "Paid", "Job", "Currency", "Subtotal", "Discount", "Tax", "Total"],
    rows,
  );
  downloadCsv(`blue-seal-invoices-${period.value}.csv`, csv);
}

function exportExpenses() {
  const rows = expenses.value.map((e) => [
    isoDate(e.spentAt?.toMillis?.() ?? e.createdAt?.toMillis?.()),
    e.vendor ?? "",
    e.category ?? "",
    e.description,
    centsToDollars(e.totalCost ?? 0),
    centsToDollars(e.billedAmount ?? 0),
    e.jobId,
  ]);
  const csv = toCsv(
    ["Date", "Vendor", "Category", "Description", "Cost", "Billed", "Job"],
    rows,
  );
  downloadCsv(`blue-seal-expenses-${period.value}.csv`, csv);
}
</script>

<template>
  <section class="bs-container py-6 max-w-2xl">
    <h1 class="text-2xl font-bold mb-1">Business reports</h1>
    <p class="text-sm text-[color:var(--bs-muted)] mb-5">
      Revenue, tax collected, and an accountant-ready CSV export.
    </p>

    <!-- Pro gate -->
    <div v-if="gated" class="bs-card p-6 text-center">
      <i class="pi pi-lock text-3xl text-[color:var(--bs-blue)]"></i>
      <h2 class="mt-3 text-lg font-semibold">Reports are part of Blue Seal Pro</h2>
      <p class="mt-2 text-sm text-[color:var(--bs-muted)] max-w-sm mx-auto">
        See your revenue and tax at a glance and export an accountant-ready CSV of
        your invoices and expenses.
      </p>
      <RouterLink to="/pricing" class="inline-block mt-5">
        <Button label="Start 30-day free trial" icon="pi pi-star" />
      </RouterLink>
    </div>

    <template v-else>
      <SelectButton
        v-model="period"
        :options="periodOptions"
        option-label="label"
        option-value="value"
        :allow-empty="false"
        class="text-sm mb-4"
        @change="load"
      />

      <div v-if="loading" class="bs-card p-6 text-sm text-[color:var(--bs-muted)]">
        <i class="pi pi-spin pi-spinner mr-2"></i> Loading…
      </div>

      <template v-else>
        <!-- Summary -->
        <div class="grid grid-cols-2 gap-3 mb-4">
          <div class="bs-card p-4">
            <div class="text-xs text-[color:var(--bs-muted)]">Revenue (paid)</div>
            <div class="text-xl font-bold tabular-nums">{{ money(revenueCents) }}</div>
          </div>
          <div class="bs-card p-4">
            <div class="text-xs text-[color:var(--bs-muted)]">Tax collected</div>
            <div class="text-xl font-bold tabular-nums">{{ money(taxCents) }}</div>
          </div>
          <div class="bs-card p-4">
            <div class="text-xs text-[color:var(--bs-muted)]">Expenses (cost)</div>
            <div class="text-xl font-bold tabular-nums">{{ money(expenseCostCents) }}</div>
          </div>
          <div class="bs-card p-4">
            <div class="text-xs text-[color:var(--bs-muted)]">Net</div>
            <div class="text-xl font-bold tabular-nums">{{ money(netCents) }}</div>
          </div>
        </div>

        <!-- Revenue by month -->
        <div v-if="byMonth.length" class="bs-card p-4 mb-4">
          <h3 class="text-sm font-semibold mb-2">Revenue by month</h3>
          <ul class="divide-y divide-[color:var(--bs-border)] text-sm">
            <li v-for="[m, cents] in byMonth" :key="m" class="flex justify-between py-2">
              <span>{{ m }}</span>
              <span class="tabular-nums">{{ money(cents) }}</span>
            </li>
          </ul>
        </div>
        <p v-else class="text-sm text-[color:var(--bs-muted)] mb-4">
          No paid invoices in this period yet.
        </p>

        <!-- Exports -->
        <div class="flex flex-wrap gap-2">
          <Button
            label="Export invoices (CSV)"
            icon="pi pi-download"
            outlined
            size="small"
            :disabled="!invoices.length"
            @click="exportInvoices"
          />
          <Button
            label="Export expenses (CSV)"
            icon="pi pi-download"
            outlined
            size="small"
            :disabled="!expenses.length"
            @click="exportExpenses"
          />
        </div>
        <p class="mt-3 text-xs text-[color:var(--bs-muted)]">
          "Tax collected" sums the tax on your paid invoices. Confirm against your
          own records before filing — Blue Seal isn't a substitute for an accountant.
        </p>
      </template>
    </template>
  </section>
</template>
