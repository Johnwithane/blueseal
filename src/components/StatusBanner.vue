<script setup lang="ts">
import { computed } from "vue";

// Shared "status + next step" banner. The job-detail flow had this exact
// shell — `bs-card p-4 border-l-4 border-l-{accent}` + icon + title + body +
// actions — hand-repeated across ClientApprovalBanner, ClientQuoteApproval-
// Banner, UpfrontFeePaymentBanner and TradieChangesRequestedBanner, each
// re-specifying the accent colour inline (UI_UX_AUDIT.md R5). This primitive
// owns the shell so those components only supply content.
//
// Severity drives the left-border + icon colour:
//   action  — amber: the viewer has something to do
//   waiting — slate: ball is in the other court (passive)
//   info    — brand blue: neutral context
//   success / danger — terminal / error states
type Severity = "action" | "waiting" | "info" | "success" | "danger";

const props = withDefaults(
  defineProps<{
    severity?: Severity;
    /** PrimeIcons name without the "pi " prefix, e.g. "pi-check-circle". */
    icon?: string;
    /** Title text. Omit and use the #title slot for dynamic titles. */
    title?: string;
  }>(),
  { severity: "action", icon: "", title: "" },
);

// Full literal class strings (not interpolated) so Tailwind's scanner keeps
// them in the build.
const ACCENT: Record<Severity, { border: string; icon: string }> = {
  action: { border: "border-l-amber-500", icon: "text-amber-600" },
  waiting: { border: "border-l-slate-400", icon: "text-slate-500" },
  info: { border: "border-l-[color:var(--bs-blue)]", icon: "text-[color:var(--bs-blue)]" },
  success: { border: "border-l-emerald-500", icon: "text-emerald-600" },
  danger: { border: "border-l-red-500", icon: "text-red-600" },
};

const accent = computed(() => ACCENT[props.severity]);
</script>

<template>
  <div class="bs-card p-4 border-l-4" :class="accent.border">
    <div class="flex items-start gap-3">
      <i
        v-if="icon"
        :class="['pi', icon, 'text-xl mt-0.5', accent.icon]"
        aria-hidden="true"
      ></i>
      <div class="min-w-0 flex-1">
        <div class="font-semibold text-base">
          <slot name="title">{{ title }}</slot>
        </div>
        <slot name="body" />
      </div>
    </div>

    <div v-if="$slots.actions" class="mt-4">
      <slot name="actions" />
    </div>
  </div>
</template>
