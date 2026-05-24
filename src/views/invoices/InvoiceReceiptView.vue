<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter, RouterLink } from "vue-router";
import Button from "primevue/button";
import { useAuthStore } from "@/stores/auth";
import { subscribeInvoice } from "@/firebase/services/invoices";
import type { InvoiceDoc, WithId } from "@/firebase/interfaces";

// Landing view after Stripe redirects back from the hosted payment flow.
// Stripe appends `?payment_intent=…&redirect_status=…` to return_url; we
// trust the redirect_status as a UI hint only — the Firestore invoice doc
// is the source of truth, refreshed live via the subscription so the page
// flips from "processing" → "paid" the moment the webhook lands.

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const invoiceId = computed(() => String(route.params.id ?? ""));
const invoice = ref<WithId<InvoiceDoc> | null>(null);
const loading = ref(true);

let unsub: (() => void) | null = null;

onMounted(() => {
  if (!invoiceId.value) return;
  unsub = subscribeInvoice(invoiceId.value, (inv) => {
    invoice.value = inv;
    loading.value = false;
  });
});

onBeforeUnmount(() => unsub?.());

// Stripe's hint about what happened. One of: succeeded | processing |
// requires_payment_method (we don't see "failed" — that keeps the user on
// the pay page). Used only to render the right state IMMEDIATELY on
// landing; the invoice subscription overrides this as soon as it settles.
const redirectStatus = computed(() => {
  const s = route.query.redirect_status;
  return typeof s === "string" ? s : null;
});

// Pre-subscription rendering hint: if Stripe says succeeded and the
// invoice doc hasn't caught up, treat as processing so the user sees
// the "waiting for confirmation" state rather than the loading spinner
// forever.
const effectiveStatus = computed<
  "paid" | "processing" | "failed" | "loading"
>(() => {
  const live = invoice.value?.status;
  if (live === "paid" || live === "refunded" || live === "partially_refunded")
    return "paid";
  if (live === "processing") return "processing";
  if (loading.value) return "loading";
  if (redirectStatus.value === "succeeded") return "processing";
  if (redirectStatus.value === "requires_payment_method") return "failed";
  return "loading";
});

function fmtMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
    cents / 100,
  );
}

function backToPay() {
  void router.replace({
    name: "InvoicePay",
    params: { id: invoiceId.value },
  });
}

const isParty = computed(
  () =>
    !!invoice.value &&
    !!auth.fbUser &&
    (invoice.value.clientId === auth.fbUser.uid ||
      invoice.value.tradespersonId === auth.fbUser.uid),
);
</script>

<template>
  <section class="bs-container py-6 max-w-xl">
    <div
      v-if="effectiveStatus === 'loading'"
      class="bs-card p-6"
    >
      <div class="flex items-center gap-2 text-[color:var(--bs-muted)] text-sm">
        <i class="pi pi-spin pi-spinner"></i>
        Loading receipt…
      </div>
    </div>

    <div v-else-if="effectiveStatus === 'failed'" class="bs-card p-6">
      <i class="pi pi-times-circle text-3xl text-[#b91c1c]"></i>
      <h1 class="mt-2 text-xl font-semibold">Payment didn't go through</h1>
      <p class="mt-2 text-sm text-[color:var(--bs-muted)]">
        Stripe couldn't confirm your payment. You can try again with the same
        or a different card.
      </p>
      <Button
        label="Try again"
        icon="pi pi-arrow-left"
        class="mt-4"
        @click="backToPay"
      />
    </div>

    <div v-else-if="effectiveStatus === 'processing'" class="bs-card p-6">
      <i class="pi pi-spin pi-spinner text-3xl text-[color:var(--bs-blue)]"></i>
      <h1 class="mt-2 text-xl font-semibold">Confirming your payment…</h1>
      <p class="mt-2 text-sm text-[color:var(--bs-muted)]">
        Stripe has your payment and is finalizing it. This usually takes a
        few seconds — this page updates automatically when it's confirmed.
      </p>
    </div>

    <div v-else-if="effectiveStatus === 'paid' && invoice" class="bs-card p-6">
      <i class="pi pi-check-circle text-3xl text-[color:var(--bs-blue)]"></i>
      <h1 class="mt-2 text-xl font-semibold">Payment confirmed</h1>
      <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
        Invoice {{ invoice.invoiceNumber }} —
        {{ fmtMoney(invoice.total, invoice.currency) }} paid.
        <span v-if="invoice.status === 'partially_refunded'">
          A partial refund was issued back to your card.
        </span>
        <span v-if="invoice.status === 'refunded'">
          A full refund has been issued back to your card.
        </span>
      </p>

      <div class="mt-4 space-y-2 text-sm">
        <div class="flex justify-between">
          <span class="text-[color:var(--bs-muted)]">Subtotal</span>
          <span class="tabular-nums">
            {{ fmtMoney(invoice.subtotal, invoice.currency) }}
          </span>
        </div>
        <div class="flex justify-between">
          <span class="text-[color:var(--bs-muted)]">Tax</span>
          <span class="tabular-nums">
            {{ fmtMoney(invoice.taxTotal, invoice.currency) }}
          </span>
        </div>
        <div class="flex justify-between font-semibold pt-1 border-t border-[color:var(--bs-border)]">
          <span>Total paid</span>
          <span class="tabular-nums">
            {{ fmtMoney(invoice.total, invoice.currency) }}
          </span>
        </div>
      </div>

      <div class="mt-5 flex flex-wrap gap-2">
        <a
          v-if="invoice.pdfUrl"
          :href="invoice.pdfUrl"
          target="_blank"
          rel="noopener"
        >
          <Button label="Download PDF" icon="pi pi-file-pdf" outlined />
        </a>
        <RouterLink
          v-if="invoice.jobId"
          :to="`/jobs/${invoice.jobId}`"
        >
          <Button label="Back to job" icon="pi pi-arrow-right" icon-pos="right" />
        </RouterLink>
      </div>

      <p
        v-if="!isParty"
        class="mt-4 text-xs text-[color:var(--bs-muted)]"
      >
        Receipt details are only visible when signed in as a party on this
        invoice.
      </p>
    </div>
  </section>
</template>
