<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "primevue/button";
import Message from "primevue/message";
import { loadStripe, type Stripe, type StripeElements } from "@stripe/stripe-js";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import {
  markInvoiceViewed,
  subscribeInvoice,
} from "@/firebase/services/invoices";
import { STRIPE_PUBLISHABLE_KEY } from "@/firebase/config";
import type { InvoiceDoc, WithId } from "@/firebase/interfaces";

// Single-page Stripe Elements checkout for a Blue Seal invoice. Loads the
// invoice live so the moment the webhook flips status to `paid` (or the
// tradesperson voids / refunds while the page is open) the UI reacts
// without a reload. The PaymentElement itself is vanilla Stripe.js —
// Stripe doesn't ship an official Vue wrapper, so the mount/unmount is
// hand-rolled. Submit calls `stripe.confirmPayment` with a `return_url`
// pointing at the receipt view; on success Stripe redirects there with
// `?payment_intent=…&redirect_status=…` query params the receipt view
// uses to render the right state immediately (before the webhook lands).

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toast = useToast();

const invoiceId = computed(() => String(route.params.id ?? ""));

const invoice = ref<WithId<InvoiceDoc> | null>(null);
const loading = ref(true);
const submitting = ref(false);
const initError = ref<string | null>(null);
const submitError = ref<string | null>(null);

let unsub: (() => void) | null = null;
let stripe: Stripe | null = null;
let elements: StripeElements | null = null;
let elementMounted = false;

const paymentElementRef = ref<HTMLDivElement | null>(null);

onMounted(async () => {
  if (!invoiceId.value) {
    initError.value = "Missing invoice id in URL.";
    loading.value = false;
    return;
  }

  // Bump viewed timestamp the first time the client lands here. Idempotent
  // (the service no-ops if status isn't `sent`). Fire-and-forget — a
  // failure here doesn't block the payment flow.
  void markInvoiceViewed(invoiceId.value).catch(() => undefined);

  unsub = subscribeInvoice(invoiceId.value, async (inv) => {
    invoice.value = inv;
    loading.value = false;

    // Already paid → go straight to receipt. Same for processing — the
    // user already submitted, the receipt view handles that state.
    if (inv?.status === "paid" || inv?.status === "processing") {
      void router.replace({
        name: "InvoiceReceipt",
        params: { id: invoiceId.value },
      });
      return;
    }

    // First time we have the clientSecret, mount the Element. The watch
    // below also handles late arrivals (e.g. sendInvoice ran during the
    // session).
    if (!elementMounted) {
      await tryMountElement();
    }
  });
});

onBeforeUnmount(() => {
  unsub?.();
  // Stripe Elements clean themselves up on DOM removal, but explicit
  // unmount avoids leaked references if the page transition is fast.
  try {
    elements?.getElement("payment")?.unmount();
  } catch {
    /* no-op */
  }
});

// Catch the case where the invoice loads BEFORE the DOM ref is ready —
// the first subscribe callback may fire before Vue's nextTick paints the
// payment element container. This re-tries mounting on every state change
// that could newly enable it.
watch([invoice, paymentElementRef], () => {
  if (!elementMounted) void tryMountElement();
});

async function tryMountElement() {
  if (elementMounted) return;
  const inv = invoice.value;
  if (!inv) return;
  const clientSecret = inv.payment?.clientSecret ?? null;
  if (!clientSecret) {
    initError.value =
      "This invoice isn't ready for online payment. Ask the tradesperson to re-send it from their dashboard.";
    return;
  }
  if (!STRIPE_PUBLISHABLE_KEY) {
    initError.value =
      "Online payments aren't configured for this environment. Try again later.";
    return;
  }
  // Wait for the DOM target to render before asking Stripe to mount.
  await nextTick();
  if (!paymentElementRef.value) return;

  try {
    if (!stripe) {
      stripe = await loadStripe(STRIPE_PUBLISHABLE_KEY);
    }
    if (!stripe) {
      throw new Error("Failed to initialize Stripe.js.");
    }
    elements = stripe.elements({
      clientSecret,
      appearance: { theme: "stripe" },
    });
    const paymentElement = elements.create("payment");
    paymentElement.mount(paymentElementRef.value);
    elementMounted = true;
  } catch (err) {
    initError.value = humanizeError(err);
  }
}

async function submit() {
  if (!stripe || !elements || !invoice.value) return;
  submitting.value = true;
  submitError.value = null;
  try {
    const returnUrl = new URL(
      `/invoices/${invoiceId.value}/receipt`,
      window.location.origin,
    ).toString();
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
    });
    // `confirmPayment` only returns here when the payment FAILED to even
    // dispatch (validation, network, declined-without-auth). On success
    // Stripe redirects to `return_url` and this code never runs.
    if (error) {
      submitError.value =
        error.message ??
        "Your payment couldn't be confirmed. Check your card details and try again.";
      toast.error("Payment failed", submitError.value);
    }
  } catch (err) {
    submitError.value = humanizeError(err);
    toast.error("Payment failed", submitError.value);
  } finally {
    submitting.value = false;
  }
}

function fmtMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
    cents / 100,
  );
}

const isParty = computed(
  () =>
    !!invoice.value &&
    !!auth.fbUser &&
    (invoice.value.clientId === auth.fbUser.uid ||
      invoice.value.tradespersonId === auth.fbUser.uid),
);

const lastFailureMessage = computed(
  () => (invoice.value?.payment as { lastFailureMessage?: string } | null | undefined)?.lastFailureMessage ?? null,
);
</script>

<template>
  <section class="bs-container py-6 max-w-xl">
    <div v-if="loading" class="bs-card p-6">
      <div class="flex items-center gap-2 text-[color:var(--bs-muted)] text-sm">
        <i class="pi pi-spin pi-spinner"></i>
        Loading invoice…
      </div>
    </div>

    <div v-else-if="!invoice" class="bs-card p-6">
      <h1 class="text-xl font-semibold">Invoice not found</h1>
      <p class="mt-2 text-sm text-[color:var(--bs-muted)]">
        We couldn't load this invoice. It may have been deleted, or you may
        not be signed in as the client who received it.
      </p>
    </div>

    <div v-else-if="!isParty" class="bs-card p-6">
      <h1 class="text-xl font-semibold">Not your invoice</h1>
      <p class="mt-2 text-sm text-[color:var(--bs-muted)]">
        Only the client who received this invoice can pay it. Sign in with
        the account it was sent to.
      </p>
    </div>

    <template v-else>
      <div class="mb-4">
        <h1 class="text-2xl font-bold">
          Pay invoice {{ invoice.invoiceNumber }}
        </h1>
        <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
          {{ fmtMoney(invoice.total, invoice.currency) }} due
        </p>
      </div>

      <div class="bs-card mb-4 p-5">
        <h2 class="text-sm font-semibold uppercase tracking-wide text-[color:var(--bs-muted)]">
          Summary
        </h2>
        <ul class="mt-2 divide-y divide-[color:var(--bs-border)] text-sm">
          <li
            v-for="(li, idx) in invoice.lineItems"
            :key="idx"
            class="flex items-start justify-between py-2 gap-3"
          >
            <span class="flex-1 min-w-0">
              {{ li.description }}
              <span class="block text-xs text-[color:var(--bs-muted)]">
                {{ li.quantity }} × {{ fmtMoney(li.unitPrice, invoice.currency) }}
              </span>
            </span>
            <span class="font-medium tabular-nums">
              {{ fmtMoney(li.quantity * li.unitPrice, invoice.currency) }}
            </span>
          </li>
        </ul>
        <div class="mt-3 border-t border-[color:var(--bs-border)] pt-3 text-sm space-y-1">
          <div class="flex justify-between">
            <span>Subtotal</span>
            <span class="tabular-nums">{{ fmtMoney(invoice.subtotal, invoice.currency) }}</span>
          </div>
          <div class="flex justify-between">
            <span>Tax</span>
            <span class="tabular-nums">{{ fmtMoney(invoice.taxTotal, invoice.currency) }}</span>
          </div>
          <div class="flex justify-between font-semibold text-base pt-1">
            <span>Total</span>
            <span class="tabular-nums">{{ fmtMoney(invoice.total, invoice.currency) }}</span>
          </div>
        </div>
      </div>

      <Message
        v-if="lastFailureMessage"
        severity="warn"
        :closable="false"
        class="mb-3"
      >
        Last attempt failed: {{ lastFailureMessage }}. Try a different card or
        check your details.
      </Message>

      <Message
        v-if="initError"
        severity="error"
        :closable="false"
        class="mb-3"
      >
        {{ initError }}
      </Message>

      <div class="bs-card p-5">
        <!-- Stripe PaymentElement mounts inside this div. Stripe controls the
             form fields, validation, and 3DS challenge UI; we only own the
             surrounding chrome + the submit button. -->
        <div ref="paymentElementRef" class="min-h-[12rem]"></div>

        <Message
          v-if="submitError"
          severity="error"
          :closable="false"
          class="mt-3"
        >
          {{ submitError }}
        </Message>

        <Button
          label="Pay now"
          icon="pi pi-lock"
          class="mt-4 w-full"
          :loading="submitting"
          :disabled="!!initError || loading"
          @click="submit"
        />
        <p class="mt-2 text-xs text-[color:var(--bs-muted)] text-center">
          Payments are processed by Stripe. Blue Seal never sees your card
          details.
        </p>
      </div>
    </template>
  </section>
</template>
