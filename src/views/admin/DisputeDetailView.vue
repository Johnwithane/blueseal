<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Message from "primevue/message";
import { subscribeDispute } from "@/firebase/services/disputes";
import { useFormatters } from "@/composables/useFormatters";
import type { DisputeDoc, WithId } from "@/firebase/interfaces";

// Admin-facing single-dispute view. Live-subscribed so a `dispute.closed`
// event arriving while admin is on the page flips the outcome immediately.
// Evidence submission itself happens in the Stripe Dashboard — the
// "Open in Stripe" deep link below is the action.

const route = useRoute();
const { relativeTime } = useFormatters();

const disputeId = computed(() => String(route.params.id ?? ""));
const dispute = ref<WithId<DisputeDoc> | null>(null);
const loading = ref(true);
let unsub: (() => void) | null = null;

onMounted(() => {
  if (!disputeId.value) return;
  unsub = subscribeDispute(disputeId.value, (d) => {
    dispute.value = d;
    loading.value = false;
  });
});

onBeforeUnmount(() => unsub?.());

function fmtMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
    cents / 100,
  );
}

const stripeUrl = computed(() =>
  dispute.value
    ? `https://dashboard.stripe.com/disputes/${dispute.value.id}`
    : null,
);

const isClosed = computed(() => dispute.value?.outcome !== null);

function outcomeSeverity(outcome: string): "success" | "danger" | "secondary" {
  if (outcome === "won") return "success";
  if (outcome === "lost") return "danger";
  return "secondary";
}

// Reason copy. Falls back to a humanized version of the raw Stripe code
// for anything we haven't mapped; the raw code is still readable.
function reasonExplanation(reason: string): string {
  const map: Record<string, string> = {
    fraudulent:
      "Cardholder claims they didn't authorize the charge. Evidence required: proof of cardholder authorization (signed quote, chat transcripts, IP / device records of the booking flow).",
    duplicate:
      "Cardholder claims they were charged twice for the same service. Evidence required: receipts for each charge clearly showing distinct services / dates.",
    product_not_received:
      "Cardholder claims the service wasn't delivered. Evidence required: completion photos, signed sign-off, chat log of the job, timestamps from clock-in/out.",
    product_unacceptable:
      "Cardholder claims the service was unacceptable. Evidence required: spec sheets, before/after photos, communications about the agreed scope.",
    credit_not_processed:
      "Cardholder says a promised refund was never issued. Evidence required: refund records or explanation of why no refund was promised.",
    unrecognized:
      "Cardholder doesn't recognize the charge on their statement. Evidence required: invoice + tradesperson contact details + service description that match what the cardholder would expect to see.",
    customer_initiated:
      "Initiated by the bank's standard process — usually an inquiry rather than a fraud claim. Often resolves quickly with a clear receipt.",
    general:
      "No specific reason given. Provide the full transaction context — invoice, communications, completion evidence.",
  };
  return map[reason] ?? `Raw Stripe reason: ${reason.replace(/_/g, " ")}.`;
}
</script>

<template>
  <section class="bs-container py-6 max-w-3xl">
    <div class="mb-4">
      <RouterLink
        to="/admin/disputes"
        class="text-xs text-[color:var(--bs-muted)]"
        >← Back to disputes</RouterLink
      >
      <h1 class="text-2xl font-bold mt-1">Dispute</h1>
    </div>

    <div v-if="loading" class="bs-card p-6">
      <div class="flex items-center gap-2 text-[color:var(--bs-muted)] text-sm">
        <i class="pi pi-spin pi-spinner"></i>
        Loading…
      </div>
    </div>

    <div v-else-if="!dispute" class="bs-card p-6">
      <h2 class="text-lg font-semibold">Dispute not found</h2>
      <p class="mt-2 text-sm text-[color:var(--bs-muted)]">
        No dispute with id <code>{{ disputeId }}</code>.
      </p>
    </div>

    <template v-else>
      <div class="bs-card p-5 space-y-3">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-xs uppercase tracking-wide text-[color:var(--bs-muted)]">
              Amount
            </div>
            <div class="text-2xl font-bold tabular-nums">
              {{ fmtMoney(dispute.amount, dispute.currency) }}
            </div>
          </div>
          <Tag
            v-if="isClosed"
            :severity="outcomeSeverity(dispute.outcome!)"
            :value="dispute.outcome!"
          />
          <Tag
            v-else
            severity="warn"
            :value="dispute.status"
          />
        </div>

        <div>
          <div class="text-xs uppercase tracking-wide text-[color:var(--bs-muted)]">
            Reason
          </div>
          <div class="capitalize font-medium">
            {{ dispute.reason.replace(/_/g, " ") }}
          </div>
          <p class="mt-1 text-sm text-[color:var(--bs-text)]/85">
            {{ reasonExplanation(dispute.reason) }}
          </p>
        </div>

        <div v-if="dispute.evidenceDueBy && !isClosed">
          <div class="text-xs uppercase tracking-wide text-[color:var(--bs-muted)]">
            Evidence due
          </div>
          <div class="font-medium">
            {{ relativeTime(dispute.evidenceDueBy) }}
          </div>
        </div>
      </div>

      <div class="bs-card p-5 mt-4 space-y-2 text-sm">
        <h2 class="text-base font-semibold mb-1">Linked records</h2>
        <div>
          <span class="text-[color:var(--bs-muted)]">Invoice:</span>
          <code class="ml-2 text-xs">{{ dispute.invoiceId ?? "—" }}</code>
        </div>
        <div v-if="dispute.jobId">
          <span class="text-[color:var(--bs-muted)]">Job:</span>
          <RouterLink
            :to="`/jobs/${dispute.jobId}`"
            class="ml-2 text-xs underline"
          >
            {{ dispute.jobId }}
          </RouterLink>
        </div>
        <div>
          <span class="text-[color:var(--bs-muted)]">Tradesperson:</span>
          <code class="ml-2 text-xs">{{ dispute.tradespersonId ?? "—" }}</code>
        </div>
        <div>
          <span class="text-[color:var(--bs-muted)]">Client:</span>
          <code class="ml-2 text-xs">{{ dispute.clientId ?? "—" }}</code>
        </div>
        <div>
          <span class="text-[color:var(--bs-muted)]">Stripe charge:</span>
          <code class="ml-2 text-xs">{{ dispute.chargeId }}</code>
        </div>
        <div>
          <span class="text-[color:var(--bs-muted)]">Dispute id:</span>
          <code class="ml-2 text-xs">{{ dispute.id }}</code>
        </div>
      </div>

      <Message
        v-if="!isClosed"
        severity="info"
        :closable="false"
        class="mt-4"
      >
        Evidence is submitted in the Stripe Dashboard, not here. Use the link
        below to open this dispute in Stripe; gather supporting docs (chat
        transcripts, photos, sign-off) from the linked job above.
      </Message>

      <div class="mt-4 flex flex-wrap gap-2">
        <a
          v-if="stripeUrl"
          :href="stripeUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button
            label="Open in Stripe"
            icon="pi pi-external-link"
          />
        </a>
        <RouterLink to="/admin/disputes">
          <Button label="Back to queue" icon="pi pi-arrow-left" outlined />
        </RouterLink>
      </div>
    </template>
  </section>
</template>
