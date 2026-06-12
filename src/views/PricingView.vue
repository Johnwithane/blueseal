<script setup lang="ts">
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import Button from "primevue/button";
import SelectButton from "primevue/selectbutton";
import { storeToRefs } from "pinia";
import { useAuthStore } from "@/stores/auth";
import { useSubscriptionStore } from "@/stores/subscription";
import { useProCheckout } from "@/composables/useProCheckout";
import { useSeo } from "@/composables/useSeo";
import type { SubscriptionPlan } from "@/firebase/interfaces";

// Public pricing page. Core app is free for everyone; Blue Seal Pro is the
// tradesperson upgrade. Role-aware CTA: a signed-in non-Pro tradesperson goes
// straight to checkout; anyone else is routed to sign up as a tradesperson.
useSeo({
  title: "Pricing — Blue Seal",
  description:
    "Blue Seal is free for clients and tradespeople. Blue Seal Pro ($29 CAD/mo or $290/yr) adds an AI assistant, waives your clients' service fee, and more — 30-day free trial.",
});

const auth = useAuthStore();
const store = useSubscriptionStore();
const { isPro } = storeToRefs(store);
const { busy, startPro } = useProCheckout();

const plan = ref<SubscriptionPlan>("annual");
const planOptions = [
  { label: "Monthly", value: "monthly" as const },
  { label: "Annual (2 months free)", value: "annual" as const },
];

const priceLine = computed(() =>
  plan.value === "monthly" ? "$29 CAD / month" : "$290 CAD / year",
);

const isTradie = computed(() => auth.hasTradieRole);

function onProCta() {
  void startPro(plan.value);
}

const proCtaLabel = computed(() => {
  if (isPro.value) return "Manage your subscription";
  if (isTradie.value) return "Start 30-day free trial";
  return "Sign up as a tradesperson";
});
</script>

<template>
  <section class="bs-container py-8 max-w-3xl">
    <header class="text-center mb-8">
      <h1 class="text-3xl font-bold">Simple, honest pricing</h1>
      <p class="mt-2 text-[color:var(--bs-muted)]">
        Blue Seal is free to use. Tradespeople can go further with Blue Seal Pro.
      </p>
    </header>

    <div class="grid gap-4 sm:grid-cols-2">
      <!-- Free -->
      <div class="bs-card p-6 flex flex-col">
        <h2 class="text-lg font-semibold">Blue Seal</h2>
        <p class="mt-1 text-2xl font-bold">Free</p>
        <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
          For every client and verified tradesperson.
        </p>
        <ul class="mt-4 space-y-2 text-sm flex-1">
          <li class="flex gap-2"><i class="pi pi-check text-[color:var(--bs-blue)]"></i> Search, quote, and hire verified pros</li>
          <li class="flex gap-2"><i class="pi pi-check text-[color:var(--bs-blue)]"></i> Per-job chat, scheduling, and the job board</li>
          <li class="flex gap-2"><i class="pi pi-check text-[color:var(--bs-blue)]"></i> Quotes, invoices, time tracking &amp; receipts</li>
          <li class="flex gap-2"><i class="pi pi-check text-[color:var(--bs-blue)]"></i> Receipt scanning (AI), free forever</li>
        </ul>
        <RouterLink to="/search" class="mt-5 block">
          <Button label="Get started" outlined class="w-full" />
        </RouterLink>
      </div>

      <!-- Pro -->
      <div class="bs-card p-6 flex flex-col border-2 border-[color:var(--bs-blue)]">
        <div class="flex items-center gap-2">
          <h2 class="text-lg font-semibold">Blue Seal Pro</h2>
          <span class="text-[10px] font-semibold uppercase tracking-wide rounded-full bg-[color:var(--bs-blue)] text-white px-2 py-0.5">
            Founding rate
          </span>
        </div>
        <div class="mt-3">
          <SelectButton
            v-model="plan"
            :options="planOptions"
            option-label="label"
            option-value="value"
            :allow-empty="false"
            class="text-xs"
          />
        </div>
        <p class="mt-3 text-2xl font-bold">{{ priceLine }}</p>
        <p class="mt-1 text-sm text-[color:var(--bs-muted)]">
          30-day free trial. Cancel anytime.
        </p>
        <ul class="mt-4 space-y-2 text-sm flex-1">
          <li class="flex gap-2"><i class="pi pi-star-fill text-[color:var(--bs-blue)]"></i> <span><strong>AI assistant</strong> — diagnose, draft quotes &amp; invoices, summarize jobs</span></li>
          <li class="flex gap-2"><i class="pi pi-star-fill text-[color:var(--bs-blue)]"></i> <span><strong>Your clients pay no service fee</strong> on card payments — you're cheaper to hire</span></li>
          <li class="flex gap-2"><i class="pi pi-star-fill text-[color:var(--bs-blue)]"></i> <span><strong>Featured placement</strong> on clients' job posts</span></li>
          <li class="flex gap-2"><i class="pi pi-star-fill text-[color:var(--bs-blue)]"></i> <span><strong>Business reports + CSV export</strong> for tax time</span></li>
        </ul>
        <Button
          :label="proCtaLabel"
          icon="pi pi-star"
          class="mt-5 w-full"
          :loading="busy"
          @click="onProCta"
        />
        <p class="mt-2 text-center text-xs text-[color:var(--bs-muted)]">
          You keep every dollar you quote — clients cover card processing.
        </p>
      </div>
    </div>

    <p class="mt-6 text-center text-xs text-[color:var(--bs-muted)]">
      Prices in Canadian dollars. Applicable taxes may apply.
    </p>
  </section>
</template>
