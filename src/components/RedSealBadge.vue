<script setup lang="ts">
// The Red Seal badge — a solid red "stamp" pill with our own centred maple-leaf
// seal (NOT the official, trademarked Red Seal logo). Surfaced wherever a
// tradesperson appears (profile header, search card, applicant card) when they
// hold a verified Red Seal credential. Tapping opens a popover explaining what
// the Red Seal is + the standard "request current proof" disclaimer, matching
// VerifiedBadge.vue.
import { ref } from "vue";
import { RouterLink } from "vue-router";
import Popover from "primevue/popover";

withDefaults(
  defineProps<{
    // Optional trade suffix on the full ("tag") variant, e.g. "Red Seal · Plumber".
    // Omit on compact card pills where space is tight.
    label?: string | null;
    variant?: "pill" | "tag";
  }>(),
  { label: null, variant: "pill" },
);

const popover = ref<InstanceType<typeof Popover> | null>(null);

function toggle(e: MouseEvent) {
  // Stop the click from navigating a parent <RouterLink> (TradieCard wraps the
  // whole card in a link).
  e.preventDefault();
  e.stopPropagation();
  popover.value?.toggle(e);
}
</script>

<template>
  <span class="inline-flex">
    <button
      type="button"
      class="bs-redseal-btn"
      :aria-label="label ? `Red Seal — ${label}, tap for details` : 'Red Seal verified — tap for details'"
      @click="toggle"
    >
      <span class="bs-redseal" :class="variant === 'tag' ? 'bs-redseal--tag' : 'bs-redseal--pill'">
        <svg class="bs-redseal-seal" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="11" fill="#fff" opacity="0.16" />
          <path
            fill="#fff"
            d="M12 4.5L13.76 9.57 19.13 9.68 14.85 12.93 16.41 18.07 12 15 7.59 18.07 9.15 12.93 4.87 9.68 10.24 9.57Z"
          />
        </svg>
        <span>Red Seal<template v-if="label"> · {{ label }}</template></span>
      </span>
    </button>

    <Popover ref="popover">
      <div class="bs-redseal-popover">
        <div class="font-semibold text-sm">About the Red Seal badge</div>
        <p class="text-sm mt-2">
          The Red Seal is Canada's interprovincial standard of trade
          qualification. This tradesperson uploaded a Red Seal certificate that
          Blue Seal's admin team reviewed before they went live. It is not a
          guarantee the credential is currently in force or that it covers your
          specific job.
        </p>
        <p class="text-sm mt-3 font-medium">
          Always request current proof directly from the tradesperson before
          work begins.
        </p>
        <RouterLink to="/terms" class="text-xs text-[color:var(--bs-blue)] mt-3 inline-block">
          Learn more in our Terms of Service →
        </RouterLink>
      </div>
    </Popover>
  </span>
</template>

<style scoped>
.bs-redseal-btn {
  background: none;
  border: 0;
  padding: 0;
  margin: 0;
  cursor: pointer;
  line-height: 1;
}
.bs-redseal-btn:focus-visible {
  outline: 2px solid var(--bs-blue);
  outline-offset: 2px;
  border-radius: 9999px;
}
.bs-redseal {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  /* Deep-red stamp: --bs-red top → a darkened red bottom for a pressed-seal feel. */
  background: linear-gradient(180deg, var(--bs-red), #8e2a30);
  color: #fff;
  font-weight: 700;
  border-radius: 9999px;
  line-height: 1;
  box-shadow: 0 1px 2px rgba(142, 42, 48, 0.35);
}
.bs-redseal--pill {
  font-size: 11px;
  padding: 0.2rem 0.5rem 0.2rem 0.34rem;
}
.bs-redseal--tag {
  font-size: 12px;
  padding: 0.26rem 0.6rem 0.26rem 0.42rem;
}
.bs-redseal-seal {
  flex: 0 0 auto;
}
.bs-redseal--pill .bs-redseal-seal {
  width: 15px;
  height: 15px;
}
.bs-redseal--tag .bs-redseal-seal {
  width: 17px;
  height: 17px;
}
.bs-redseal-popover {
  max-width: 280px;
  padding: 0.25rem;
}
</style>
