<script setup lang="ts">
import { storeToRefs } from "pinia";
import Dialog from "primevue/dialog";
import { useInsurancePromptStore } from "@/stores/insurancePrompt";
import { INSURANCE_PARTNER } from "@/data/insurancePartner";

// Global insurance reminder popup. Shown when a tradesperson with no current
// proof of insurance on file tries to bid or quote — a soft nudge to get
// covered that always lets them continue. Mounted once in App.vue; driven
// entirely by the insurancePrompt store. See useInsuranceGate.
//
// Styles are intentionally NOT scoped: PrimeVue teleports the dialog to <body>,
// out of this component's subtree. All classes are `ir-` namespaced.
const insurance = useInsurancePromptStore();
const { visible } = storeToRefs(insurance);

// Open the partner's site in a new tab and leave the dialog open, so a pro who
// goes to buy a policy doesn't lose the bid/quote they're mid-way through —
// they can come back and Continue (or close) when they're done.
function getCovered() {
  window.open(INSURANCE_PARTNER.url, "_blank", "noopener,noreferrer");
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    :closable="false"
    :draggable="false"
    :dismissable-mask="true"
    class="ir-dialog w-[94vw] max-w-sm"
    :pt="{ content: { class: 'ir-content' }, header: { class: 'hidden' } }"
    @hide="insurance.cancel()"
  >
    <div class="ir">
      <div class="ir-head bs-gradient-brand">
        <i class="pi pi-shield ir-shield" aria-hidden="true"></i>
        <span class="ir-kicker">Insurance</span>
        <button
          class="ir-close"
          type="button"
          aria-label="Close"
          @click="insurance.cancel()"
        >
          <i class="pi pi-times" aria-hidden="true"></i>
        </button>
      </div>

      <div class="ir-body">
        <h2 class="ir-title">Are you covered?</h2>
        <p class="ir-sub">
          We don't have proof of general-liability insurance on file for you.
          Insured pros win more work — most clients ask, and a verified
          <strong>Insured</strong> badge sits right on your profile.
        </p>

        <ul class="ir-perks">
          <li>
            <span class="ir-check"><i class="pi pi-verified" aria-hidden="true"></i></span>
            <span>Adds the verified <strong>Insured</strong> badge clients look for</span>
          </li>
          <li>
            <span class="ir-check"><i class="pi pi-bolt" aria-hidden="true"></i></span>
            <span>Quote and buy online in minutes with {{ INSURANCE_PARTNER.name }}</span>
          </li>
          <li>
            <span class="ir-check"><i class="pi pi-bell" aria-hidden="true"></i></span>
            <span>We'll remind you before it's time to renew</span>
          </li>
        </ul>

        <button class="ir-cta" type="button" @click="getCovered">
          <i class="pi pi-shield" aria-hidden="true"></i>
          <span>Get covered in minutes</span>
          <i class="pi pi-external-link ir-cta-ext" aria-hidden="true"></i>
        </button>
        <p class="ir-hint">
          Opens {{ INSURANCE_PARTNER.name }} in a new tab — come back to finish.
        </p>

        <div class="ir-foot">
          <button class="ir-later" type="button" @click="insurance.proceed()">
            Continue without insurance
          </button>
        </div>
      </div>
    </div>
  </Dialog>
</template>

<style>
/* Unscoped on purpose — see the script comment (teleported dialog). */
.ir-dialog {
  border: 0 !important;
  border-radius: 16px !important;
  overflow: hidden !important;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.32) !important;
}
.ir-content {
  padding: 0 !important;
  border-radius: 16px;
}
.ir {
  position: relative;
}

.ir-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.85rem 0.9rem;
}
.ir-shield {
  color: #fff;
  font-size: 1.25rem;
  flex: none;
}
.ir-kicker {
  flex: none;
  color: #fff;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.ir-close {
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
.ir-close:hover {
  background: rgba(255, 255, 255, 0.3);
}

.ir-body {
  padding: 1.1rem 1.3rem 1.3rem;
}
.ir-title {
  margin: 0;
  font-family: var(--bs-font-display);
  font-size: 1.35rem;
  font-weight: 700;
  line-height: 1.15;
  color: var(--bs-blue-dark);
}
.ir-sub {
  margin: 0.35rem 0 0;
  font-size: 0.85rem;
  line-height: 1.4;
  color: var(--bs-muted);
}
.ir-perks {
  list-style: none;
  margin: 1rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}
.ir-perks li {
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  font-size: 0.85rem;
  line-height: 1.35;
  color: var(--bs-text);
}
.ir-check {
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

.ir-cta {
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
.ir-cta:hover {
  background: var(--bs-blue-dark);
}
.ir-cta-ext {
  font-size: 0.78rem;
  opacity: 0.85;
}
.ir-hint {
  margin: 0.45rem 0 0;
  text-align: center;
  font-size: 0.72rem;
  color: var(--bs-muted);
}

.ir-foot {
  margin-top: 0.7rem;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ir-later {
  border: 0;
  background: none;
  padding: 0.25rem;
  font-size: 0.8rem;
  color: var(--bs-muted);
  cursor: pointer;
}
.ir-later:hover {
  color: var(--bs-text);
}

.ir-close:focus-visible,
.ir-cta:focus-visible,
.ir-later:focus-visible {
  outline: 2px solid var(--bs-blue-light);
  outline-offset: 2px;
}
</style>
