<script setup lang="ts">
import { computed, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import { storeToRefs } from "pinia";
import { usePaywallStore } from "@/stores/paywall";
import { useAuthStore } from "@/stores/auth";
import { useProCheckout } from "@/composables/useProCheckout";

// Global Blue Seal Pro upgrade popup. Shown whenever a gated AI/Pro action hits
// the server's paywall — turns a dead-end error into a one-click free-trial
// prompt. Mounted once in App.vue; driven entirely by the paywall store.
const paywall = usePaywallStore();
const { visible, message } = storeToRefs(paywall);
const auth = useAuthStore();
const { busy, startPro } = useProCheckout();
const route = useRoute();

// The server's feature-specific line ("The AI assistant is part of Blue Seal
// Pro…") when present, else generic copy for direct opens.
const body = computed(
  () =>
    message.value ??
    "This is a Blue Seal Pro feature. Start your free trial to unlock it — and everything else Pro adds.",
);

const ctaLabel = computed(() =>
  auth.isAuthenticated ? "Start 30-day free trial" : "Sign up & start free trial",
);

// Navigating away (sign-up / account redirect, or the "compare plans" link)
// must dismiss the modal so it doesn't linger over the next page. The Stripe
// checkout path is a full-page redirect, so no route change fires there — the
// button keeps spinning until the browser leaves.
watch(
  () => route.fullPath,
  () => paywall.close(),
);
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    :dismissable-mask="true"
    class="w-[95vw] max-w-sm"
    :pt="{ header: { class: 'pb-0' } }"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <span
          class="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[color:var(--bs-blue)] text-white"
        >
          <i class="pi pi-star-fill text-base" aria-hidden="true"></i>
        </span>
        <span class="text-lg font-bold">Unlock Blue Seal Pro</span>
      </div>
    </template>

    <p class="text-sm text-[color:var(--bs-text)]">{{ body }}</p>

    <ul class="mt-4 space-y-2 text-sm">
      <li class="flex gap-2">
        <i class="pi pi-check text-[color:var(--bs-blue)]"></i>
        <span><strong>AI assistant</strong> — diagnose, draft quotes &amp; invoices, summarize jobs</span>
      </li>
      <li class="flex gap-2">
        <i class="pi pi-check text-[color:var(--bs-blue)]"></i>
        <span><strong>Your clients pay no service fee</strong> on card payments</span>
      </li>
      <li class="flex gap-2">
        <i class="pi pi-check text-[color:var(--bs-blue)]"></i>
        <span><strong>Featured placement</strong> + business reports &amp; CSV export</span>
      </li>
    </ul>

    <p class="mt-4 text-xs text-[color:var(--bs-muted)]">
      30-day free trial, then $290 CAD/year (or $29/mo). Cancel anytime.
    </p>

    <template #footer>
      <div class="flex w-full flex-col gap-2">
        <Button
          :label="ctaLabel"
          icon="pi pi-star"
          class="w-full"
          :loading="busy"
          @click="startPro('annual')"
        />
        <div class="flex items-center justify-between">
          <Button label="Maybe later" text size="small" @click="paywall.close()" />
          <RouterLink
            to="/pricing"
            class="text-xs font-medium text-[color:var(--bs-blue)] hover:underline"
            @click="paywall.close()"
          >
            Compare plans &amp; features →
          </RouterLink>
        </div>
      </div>
    </template>
  </Dialog>
</template>
