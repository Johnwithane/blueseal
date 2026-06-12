<script setup lang="ts">
import { computed, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import Dialog from "primevue/dialog";
import { storeToRefs } from "pinia";
import { usePaywallStore } from "@/stores/paywall";
import { useAuthStore } from "@/stores/auth";
import { useProCheckout } from "@/composables/useProCheckout";

// Global Blue Seal Pro upgrade popup. Shown whenever a gated AI/Pro action hits
// the server's paywall — turns a dead-end error into a one-click free-trial
// prompt. Mounted once in App.vue; driven entirely by the paywall store.
//
// The styles below are intentionally NOT scoped: PrimeVue teleports the dialog
// to <body>, out of this component's subtree, where scoped data-attributes
// wouldn't reach it. All classes are `pw-` namespaced to stay collision-free.
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
    "This is a Blue Seal Pro feature — start your free trial to unlock it, and everything else Pro adds.",
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
    :closable="false"
    :draggable="false"
    :dismissable-mask="true"
    class="pw-dialog w-[94vw] max-w-sm"
    :pt="{ content: { class: 'pw-content' }, header: { class: 'hidden' } }"
  >
    <div class="pw">
      <!-- Header: horizontal Blue Seal logo + PRO, close at the edge. -->
      <div class="pw-head bs-gradient-brand">
        <img
          src="/branding/Horizontal/BlueSeal_Logo_Hor_White.png"
          alt="Blue Seal"
          class="pw-logo"
        />
        <span class="pw-pro">PRO</span>
        <button class="pw-close" type="button" aria-label="Close" @click="paywall.close()">
          <i class="pi pi-times" aria-hidden="true"></i>
        </button>
      </div>

      <!-- Body -->
      <div class="pw-body">
        <h2 class="pw-title">Unlock the full toolkit</h2>
        <p class="pw-sub">{{ body }}</p>

        <ul class="pw-perks">
          <li>
            <span class="pw-check"><i class="pi pi-bolt" aria-hidden="true"></i></span>
            <span><strong>AI assistant</strong> — diagnose, draft quotes &amp; invoices, summarize jobs</span>
          </li>
          <li>
            <span class="pw-check"><i class="pi pi-tag" aria-hidden="true"></i></span>
            <span><strong>Your clients pay no service fee</strong> on card payments</span>
          </li>
          <li>
            <span class="pw-check"><i class="pi pi-star" aria-hidden="true"></i></span>
            <span><strong>Featured placement</strong> on clients' job posts</span>
          </li>
          <li>
            <span class="pw-check"><i class="pi pi-chart-bar" aria-hidden="true"></i></span>
            <span><strong>Business reports</strong> &amp; CSV export for tax time</span>
          </li>
          <li>
            <span class="pw-check"><i class="pi pi-users" aria-hidden="true"></i></span>
            <span><strong>Clients &amp; recurring billing</strong> — a client book + standing charges drafted for you each period</span>
          </li>
        </ul>

        <div class="pw-price">
          <span class="pw-price__badge">30-day free trial</span>
          <span class="pw-price__line">then $290 CAD/yr (or $29/mo) · cancel anytime</span>
        </div>

        <button class="pw-cta" type="button" :disabled="busy" @click="startPro('annual')">
          <i :class="busy ? 'pi pi-spin pi-spinner' : 'pi pi-star-fill'" aria-hidden="true"></i>
          <span>{{ ctaLabel }}</span>
        </button>

        <div class="pw-foot">
          <button class="pw-later" type="button" @click="paywall.close()">Maybe later</button>
          <RouterLink to="/pricing" class="pw-compare" @click="paywall.close()">
            Compare plans &amp; features →
          </RouterLink>
        </div>
      </div>
    </div>
  </Dialog>
</template>

<style>
/* Unscoped on purpose — see the script comment (teleported dialog). */
.pw-dialog {
  border: 0 !important;
  border-radius: 16px !important;
  overflow: hidden !important;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.32) !important;
}
.pw-content {
  padding: 0 !important;
  border-radius: 16px;
}
.pw {
  position: relative;
}

/* Compact header lockup. */
.pw-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.85rem 0.9rem;
}
.pw-logo {
  height: 56px;
  width: auto;
  flex: none;
}
.pw-pro {
  flex: none;
  background: var(--bs-beige);
  color: var(--bs-blue-dark);
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  padding: 0.22rem 0.5rem;
  border-radius: 6px;
}
.pw-close {
  margin-left: auto;
  flex: none;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  color: #fff;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: background 0.15s ease;
}
.pw-close:hover {
  background: rgba(255, 255, 255, 0.3);
}

/* Body. */
.pw-body {
  padding: 1.1rem 1.3rem 1.3rem;
}
.pw-title {
  margin: 0;
  font-family: var(--bs-font-display);
  font-size: 1.35rem;
  font-weight: 700;
  line-height: 1.15;
  color: var(--bs-blue-dark);
}
.pw-sub {
  margin: 0.35rem 0 0;
  font-size: 0.85rem;
  line-height: 1.4;
  color: var(--bs-muted);
}
.pw-perks {
  list-style: none;
  margin: 1rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.pw-perks li {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  font-size: 0.85rem;
  line-height: 1.35;
  color: var(--bs-text);
}
.pw-perks strong {
  font-weight: 700;
}
.pw-check {
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  background: var(--bs-blue);
  color: #fff;
  font-size: 0.72rem;
  margin-top: 1px;
}

/* Price row. */
.pw-price {
  margin-top: 1rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}
.pw-price__badge {
  background: var(--bs-red);
  color: var(--bs-beige);
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  padding: 0.25rem 0.6rem;
  border-radius: 999px;
}
.pw-price__line {
  font-size: 0.72rem;
  color: var(--bs-muted);
}

/* Primary CTA. */
.pw-cta {
  margin-top: 1.1rem;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border: 0;
  border-radius: 12px;
  padding: 0.8rem 1rem;
  cursor: pointer;
  color: #fff;
  font-size: 0.95rem;
  font-weight: 700;
  background: var(--bs-blue);
  box-shadow: 0 6px 16px color-mix(in srgb, var(--bs-blue) 30%, transparent);
  transition: background 0.15s ease;
}
.pw-cta:hover {
  background: var(--bs-blue-dark);
}
.pw-cta:disabled {
  opacity: 0.7;
  cursor: default;
}

/* Footer. */
.pw-foot {
  margin-top: 0.7rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.pw-later {
  border: 0;
  background: none;
  padding: 0.25rem;
  font-size: 0.8rem;
  color: var(--bs-muted);
  cursor: pointer;
}
.pw-later:hover {
  color: var(--bs-text);
}
.pw-compare {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--bs-blue);
}
.pw-compare:hover {
  text-decoration: underline;
}

.pw-close:focus-visible,
.pw-cta:focus-visible,
.pw-later:focus-visible,
.pw-compare:focus-visible {
  outline: 2px solid var(--bs-blue-light);
  outline-offset: 2px;
}
</style>
