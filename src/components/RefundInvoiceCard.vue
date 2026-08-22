<script setup lang="ts">
// Tradesperson-facing refund control on a card-paid invoice.
//
// WHY IT'S PROMINENT: before this, a tradesperson had no way to refund at all —
// it was a Stripe Dashboard job they couldn't reach. A client whose only
// visible option is their bank's dispute button will use it, and even a dispute
// we WIN costs a per-dispute fee and pushes up the dispute ratio card networks
// watch. A refund the tradesperson can issue in two taps is the cheapest
// chargeback protection there is.
//
// Self-subscribing (like ClientInvoiceCard) so the parent tab doesn't need to
// thread payment state through: the card decides for itself whether this
// invoice can be refunded and renders nothing when it can't.
import { computed, onBeforeUnmount, ref, watch } from "vue";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import InputNumber from "primevue/inputnumber";
import Message from "primevue/message";
import RadioButton from "primevue/radiobutton";
import Textarea from "primevue/textarea";
import { subscribeInvoice, refundInvoicePayment } from "@/firebase/services/invoices";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import type { InvoiceDoc, WithId } from "@/firebase/interfaces";

const props = defineProps<{ invoiceId: string }>();

const { money } = useFormatters();
const toast = useToast();

const invoice = ref<WithId<InvoiceDoc> | null>(null);
let unsub: (() => void) | null = null;

watch(
  () => props.invoiceId,
  (id) => {
    unsub?.();
    unsub = id ? subscribeInvoice(id, (inv) => (invoice.value = inv)) : null;
  },
  { immediate: true },
);
onBeforeUnmount(() => unsub?.());

const payment = computed(() => invoice.value?.payment ?? null);

/** What the client actually paid — invoice total plus the Blue Seal fee. */
const chargeTotal = computed(
  () => payment.value?.serviceFee?.chargeTotalCents ?? invoice.value?.total ?? 0,
);
/** What the tradesperson received. */
const baseAmount = computed(
  () => payment.value?.serviceFee?.baseAmountCents ?? invoice.value?.total ?? 0,
);
const refunded = computed(() => payment.value?.refundedAmount ?? 0);
const remaining = computed(() => Math.max(0, chargeTotal.value - refunded.value));
/** A partial refund comes out of the tradesperson's share (ToS § 8.1). */
const partialMax = computed(() => Math.max(0, baseAmount.value - refunded.value));

// Mirrors RESOLVED_DISPUTE_STATUSES in functions/src/payments/refundPlan.ts.
const RESOLVED_DISPUTE_STATUSES = ["won", "lost", "warning_closed"];

/**
 * A LIVE dispute blocks refunding — the bank is deciding, and refunding
 * alongside it can pay the client twice. A RESOLVED one must not block
 * forever: `disputeId` stays set after closure, and a won dispute returns the
 * invoice to `paid` with the tradesperson holding the money.
 */
const disputeLive = computed(() => {
  const p = payment.value;
  if (!p?.disputeId || !p.paymentIntentId) return false;
  return !RESOLVED_DISPUTE_STATUSES.includes(p.disputeStatus ?? "");
});

// Only card payments can be refunded here.
const canRefund = computed(() => {
  const inv = invoice.value;
  if (!inv || !payment.value?.paymentIntentId) return false;
  if (disputeLive.value) return false;
  if (!["paid", "partially_refunded"].includes(inv.status)) return false;
  return remaining.value > 0;
});

// --- Dialog ---------------------------------------------------------------
const open = ref(false);
const mode = ref<"full" | "partial">("full");
const partialDollars = ref<number | null>(null);
const reason = ref("");
const submitting = ref(false);
const error = ref<string | null>(null);

function openDialog() {
  mode.value = "full";
  partialDollars.value = null;
  reason.value = "";
  error.value = null;
  open.value = true;
}

const partialCents = computed(() =>
  partialDollars.value === null ? null : Math.round(partialDollars.value * 100),
);

const submitDisabled = computed(() => {
  if (submitting.value) return true;
  if (mode.value === "partial") {
    const cents = partialCents.value;
    return cents === null || cents <= 0 || cents > partialMax.value;
  }
  return false;
});

async function submit() {
  if (submitDisabled.value || !invoice.value) return;
  submitting.value = true;
  error.value = null;
  try {
    const res = await refundInvoicePayment({
      invoiceId: props.invoiceId,
      ...(mode.value === "partial" && partialCents.value !== null
        ? { amountCents: partialCents.value }
        : {}),
      ...(reason.value.trim() ? { reason: reason.value.trim() } : {}),
    });
    open.value = false;
    toast.success(
      `${money(res.amountCents)} refunded to your client.${
        res.isFull ? " The Blue Seal service fee was returned to them too." : ""
      }`,
    );
  } catch (e) {
    error.value = humanizeError(e);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div v-if="canRefund || disputeLive" class="bs-card p-3">
    <h3 class="font-semibold text-sm mb-1 flex items-center gap-2">
      <i class="pi pi-replay text-[color:var(--bs-muted)]"></i>
      Refund this payment
    </h3>

    <template v-if="disputeLive">
      <p class="text-xs text-[color:var(--bs-muted)]">
        This payment is being disputed through the client's bank. The bank
        decides the outcome, so it can't be refunded from here.
      </p>
    </template>

    <template v-else>
      <p class="text-xs text-[color:var(--bs-muted)] mb-3">
        <template v-if="refunded > 0">
          {{ money(refunded) }} already refunded — {{ money(remaining) }} of this
          payment is left.
        </template>
        <template v-else>
          If something went wrong, refunding your client directly is faster for
          them than going through their bank, and it keeps the job's record
          clean for both of you.
        </template>
      </p>
      <Button
        label="Refund"
        icon="pi pi-replay"
        severity="secondary"
        outlined
        size="small"
        @click="openDialog"
      />
    </template>

    <Dialog
      v-model:visible="open"
      modal
      header="Refund this payment"
      :style="{ width: '92vw', maxWidth: '30rem' }"
    >
      <div class="space-y-4">
        <div class="flex items-start gap-2">
          <RadioButton v-model="mode" input-id="refund-full" value="full" />
          <label for="refund-full" class="text-sm cursor-pointer">
            <span class="font-medium">Refund everything ({{ money(remaining) }})</span>
            <span class="block text-xs text-[color:var(--bs-muted)]">
              Your client also gets the Blue Seal service fee back.
            </span>
          </label>
        </div>

        <div class="flex items-start gap-2">
          <RadioButton
            v-model="mode"
            input-id="refund-partial"
            value="partial"
            :disabled="partialMax <= 0"
          />
          <label for="refund-partial" class="text-sm cursor-pointer">
            <span class="font-medium">Refund part of it</span>
            <span class="block text-xs text-[color:var(--bs-muted)]">
              Comes out of your share, up to {{ money(partialMax) }}. The service
              fee isn't returned on a partial refund.
            </span>
          </label>
        </div>

        <InputNumber
          v-if="mode === 'partial'"
          v-model="partialDollars"
          mode="currency"
          currency="CAD"
          locale="en-CA"
          :min="0"
          :max="partialMax / 100"
          placeholder="Amount to refund"
          class="w-full"
          :disabled="submitting"
        />

        <div>
          <label
            for="refund-reason"
            class="block text-xs text-[color:var(--bs-muted)] mb-1"
          >
            Reason (optional — kept on the job record)
          </label>
          <Textarea
            id="refund-reason"
            v-model="reason"
            rows="2"
            auto-resize
            class="w-full"
            :disabled="submitting"
          />
        </div>

        <Message severity="secondary" :closable="false">
          Refunds land back on your client's original card, usually within
          5–10 business days.
        </Message>

        <Message v-if="error" severity="error" :closable="false">
          {{ error }}
        </Message>
      </div>

      <template #footer>
        <Button
          label="Cancel"
          severity="secondary"
          outlined
          :disabled="submitting"
          @click="open = false"
        />
        <Button
          label="Refund"
          icon="pi pi-replay"
          :loading="submitting"
          :disabled="submitDisabled"
          @click="submit"
        />
      </template>
    </Dialog>
  </div>
</template>
