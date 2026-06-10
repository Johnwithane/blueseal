<script setup lang="ts">
import { ref } from "vue";
import { RouterLink } from "vue-router";
import Tag from "primevue/tag";
import Popover from "primevue/popover";
import type { Timestamp } from "firebase/firestore";
import { useFormatters } from "@/composables/useFormatters";

type Kind = "insurance" | "wsib" | "id" | "cert";
type Variant = "tag" | "pill";

withDefaults(
  defineProps<{
    kind: Kind;
    expiresAt?: Timestamp | null;
    variant?: Variant;
  }>(),
  { variant: "tag", expiresAt: null },
);

const { date } = useFormatters();
const popover = ref<InstanceType<typeof Popover> | null>(null);

const meta = {
  id: {
    label: "ID",
    icon: "pi pi-id-card",
    pillClass: "bg-[color:var(--bs-success-tint)] text-[color:var(--bs-success-text)]",
    title: "About the ID badge",
    body:
      "The tradesperson's government photo ID was uploaded and checked against their profile name by Blue Seal's admin team before they were allowed to go live.",
  },
  cert: {
    label: "Cert",
    icon: "pi pi-verified",
    pillClass: "bg-[color:var(--bs-info-tint)] text-[color:var(--bs-info-text)]",
    title: "About the Cert badge",
    body:
      "A trade certification or licence was uploaded by the tradesperson and reviewed by Blue Seal's admin team. It is not a guarantee the credential is currently in force or covers your specific job.",
  },
  insurance: {
    label: "Insured",
    icon: "pi pi-verified",
    pillClass: "bg-[color:var(--bs-surface-alt)] text-[color:var(--bs-text)]",
    title: "About the Insured badge",
    body:
      "A liability-insurance document was uploaded by the tradesperson and reviewed by Blue Seal's admin team. It is not a guarantee that the policy is currently in force, has not been cancelled, or covers your specific job.",
  },
  wsib: {
    label: "WSIB verified",
    icon: "pi pi-shield",
    pillClass: "bg-[color:var(--bs-warning-tint)] text-[color:var(--bs-warning-text)]",
    title: "About the WSIB / WCB badge",
    body:
      "A workers'-compensation clearance certificate was uploaded by the tradesperson and reviewed by Blue Seal's admin team. It is not a guarantee that the clearance is currently in force, has not been cancelled, or covers your specific job.",
  },
} as const;

function toggle(e: MouseEvent) {
  // Stop the click from navigating any parent <RouterLink> (e.g. TradieCard
  // wraps the whole card in a link).
  e.preventDefault();
  e.stopPropagation();
  popover.value?.toggle(e);
}
</script>

<template>
  <span class="inline-flex">
    <button
      type="button"
      class="bs-verified-badge"
      :aria-label="`${meta[kind].label} — tap for details`"
      @click="toggle"
    >
      <Tag
        v-if="variant === 'tag'"
        :value="meta[kind].label"
        severity="info"
        :icon="meta[kind].icon"
      />
      <span
        v-else
        :class="['bs-verified-pill', meta[kind].pillClass]"
      >
        <i :class="`${meta[kind].icon} text-[10px]`" />{{ meta[kind].label }}
      </span>
    </button>

    <Popover ref="popover">
      <div class="bs-verified-popover">
        <div class="font-semibold text-sm">{{ meta[kind].title }}</div>
        <p class="text-sm mt-2">{{ meta[kind].body }}</p>
        <p v-if="expiresAt" class="text-xs text-[color:var(--bs-muted)] mt-2">
          Recorded expiry: {{ date(expiresAt) }}
        </p>
        <p class="text-sm mt-3 font-medium">
          Always request current proof directly from the tradesperson before
          work begins.
        </p>
        <RouterLink
          to="/terms"
          class="text-xs text-[color:var(--bs-blue)] mt-3 inline-block"
        >
          Learn more in our Terms of Service →
        </RouterLink>
      </div>
    </Popover>
  </span>
</template>

<style scoped>
.bs-verified-badge {
  background: none;
  border: 0;
  padding: 0;
  margin: 0;
  cursor: pointer;
  line-height: 1;
}
.bs-verified-badge:focus-visible {
  outline: 2px solid var(--bs-blue);
  outline-offset: 2px;
  border-radius: 4px;
}
.bs-verified-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 10px;
  font-weight: 500;
  border-radius: 9999px;
  padding: 0.125rem 0.375rem;
}
.bs-verified-popover {
  max-width: 280px;
  padding: 0.25rem;
}
</style>
