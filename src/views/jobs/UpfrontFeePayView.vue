<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import Button from "primevue/button";
import Message from "primevue/message";
import { loadStripe, type Stripe, type StripeElements } from "@stripe/stripe-js";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";
import { createUpfrontFeePaymentIntent } from "@/firebase/services/jobs";
import { STRIPE_PUBLISHABLE_KEY } from "@/firebase/config";

// Pay a job's upfront fee (deposit) by card. Symmetric to InvoicePayView but on
// the job's upfrontFee.payment. On success Stripe redirects back to the job,
// where the webhook will have flipped status to in_progress.
const route = useRoute();
const toast = useToast();

const jobId = computed(() => String(route.params.id ?? ""));

const loading = ref(true);
const submitting = ref(false);
const initError = ref<string | null>(null);
const submitError = ref<string | null>(null);
const serviceFee = ref<{ totalFeeCents: number; chargeTotalCents: number; baseAmountCents: number } | null>(null);
const clientSecret = ref<string | null>(null);

let stripe: Stripe | null = null;
let elements: StripeElements | null = null;
let elementMounted = false;
const paymentElementRef = ref<HTMLDivElement | null>(null);

onMounted(async () => {
  if (!jobId.value) {
    initError.value = "Missing job id in URL.";
    loading.value = false;
    return;
  }
  try {
    const res = await createUpfrontFeePaymentIntent(jobId.value);
    serviceFee.value = res.serviceFee;
    clientSecret.value = res.clientSecret;
    await tryMountElement();
  } catch (err) {
    initError.value = humanizeError(err);
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  try {
    elements?.getElement("payment")?.unmount();
  } catch {
    /* no-op */
  }
});

watch([paymentElementRef, clientSecret], () => {
  if (!elementMounted) void tryMountElement();
});

async function tryMountElement() {
  if (elementMounted || !clientSecret.value || !STRIPE_PUBLISHABLE_KEY) return;
  await nextTick();
  if (!paymentElementRef.value) return;
  try {
    if (!stripe) stripe = await loadStripe(STRIPE_PUBLISHABLE_KEY);
    if (!stripe) throw new Error("Failed to initialize Stripe.js.");
    elements = stripe.elements({ clientSecret: clientSecret.value, appearance: { theme: "stripe" } });
    elements.create("payment").mount(paymentElementRef.value);
    elementMounted = true;
  } catch (err) {
    initError.value = humanizeError(err);
  }
}

async function submit() {
  if (!stripe || !elements) return;
  submitting.value = true;
  submitError.value = null;
  try {
    const returnUrl = new URL(`/jobs/${jobId.value}`, window.location.origin).toString();
    const { error } = await stripe.confirmPayment({ elements, confirmParams: { return_url: returnUrl } });
    if (error) {
      submitError.value = error.message ?? "Your payment couldn't be confirmed.";
      toast.error("Payment failed", submitError.value);
    }
  } catch (err) {
    submitError.value = humanizeError(err);
    toast.error("Payment failed", submitError.value);
  } finally {
    submitting.value = false;
  }
}

function fmtMoney(cents: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}
</script>

<template>
  <section class="bs-container py-6 max-w-xl">
    <div v-if="loading" class="bs-card p-6">
      <div class="flex items-center gap-2 text-[color:var(--bs-muted)] text-sm">
        <i class="pi pi-spin pi-spinner"></i> Preparing payment…
      </div>
    </div>

    <template v-else>
      <h1 class="text-2xl font-bold mb-1">Pay the upfront fee</h1>
      <p class="text-sm text-[color:var(--bs-muted)] mb-4">
        This deposit is credited against your final invoice — it counts toward,
        not on top of, the total.
      </p>

      <Message v-if="initError" severity="error" :closable="false" class="mb-3">
        {{ initError }}
      </Message>

      <div v-if="serviceFee" class="bs-card mb-4 p-5 text-sm space-y-1">
        <div class="flex justify-between">
          <span>Upfront fee</span>
          <span class="tabular-nums">{{ fmtMoney(serviceFee.baseAmountCents) }}</span>
        </div>
        <div class="flex justify-between">
          <span>Blue Seal service fee</span>
          <span class="tabular-nums">{{ fmtMoney(serviceFee.totalFeeCents) }}</span>
        </div>
        <div class="flex justify-between font-semibold text-base pt-1 border-t border-[color:var(--bs-border)]">
          <span>Total to pay</span>
          <span class="tabular-nums">{{ fmtMoney(serviceFee.chargeTotalCents) }}</span>
        </div>
      </div>

      <Message severity="secondary" :closable="false" class="mb-4">
        Prefer e-transfer or cash? That's <strong>fee-free</strong> — arrange it
        with your tradesperson and let them know on the
        <RouterLink :to="`/jobs/${jobId}`" class="font-medium underline">job page</RouterLink>.
      </Message>

      <div v-if="!initError" class="bs-card p-5">
        <div ref="paymentElementRef" class="min-h-[12rem]"></div>
        <Message v-if="submitError" severity="error" :closable="false" class="mt-3">
          {{ submitError }}
        </Message>
        <Button
          label="Pay now"
          icon="pi pi-lock"
          class="mt-4 w-full"
          :loading="submitting"
          @click="submit"
        />
        <p class="mt-2 text-xs text-[color:var(--bs-muted)] text-center">
          Payments are processed by Stripe. Blue Seal never sees your card details.
        </p>
      </div>
    </template>
  </section>
</template>
