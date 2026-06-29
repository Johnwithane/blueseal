<script setup lang="ts">
import { ref, watch } from "vue";
import Checkbox from "primevue/checkbox";
import { useFormatters } from "@/composables/useFormatters";
import BaseSignatureDialog from "@/components/BaseSignatureDialog.vue";
import {
  CLIENT_UNINSURED_TITLE,
  CLIENT_UNINSURED_CHECKBOX,
  clientUninsuredBody,
} from "@/data/insuranceWaiver";

// Client quote-acceptance signature capture. Pure capture — the parent owns the
// network call and drives the Confirm button's loading via `busy`. Used by both
// accept paths (direct-request banner + job-board accept). The client draws with
// a finger/mouse; on confirm we emit the signature data URL (WebP, PNG fallback)
// that the server decodes + stores as the immutable record of agreement.
//
// When the assigned tradesperson is NOT insured, we also surface a liability
// disclosure here and require an explicit acknowledgment checkbox before the
// signature can be confirmed — the same drawn signature then doubles as the
// client's recorded uninsured-work acknowledgment (the parent passes
// `acknowledgedUninsured: true` to the accept callable, which re-checks server-side).
const props = defineProps<{
  visible: boolean;
  quoteTotal?: number; // cents — echoed for context
  upfrontFeeCents?: number; // cents — echoed if > 0
  busy?: boolean; // parent-owned loading while the accept callable runs
  // Set when the chosen tradesperson has no current liability insurance.
  uninsured?: boolean;
  tradieName?: string;
}>();

const emit = defineEmits<{
  "update:visible": [v: boolean];
  confirm: [dataUrl: string];
}>();

const { money } = useFormatters();

const uninsuredAck = ref(false);

// Reset the acknowledgment each time the dialog opens so a previous tick can't
// carry over into a new acceptance.
watch(
  () => props.visible,
  (v) => {
    if (v) uninsuredAck.value = false;
  },
);

const tradieName = () => props.tradieName?.trim() || "This tradesperson";
</script>

<template>
  <BaseSignatureDialog
    :visible="props.visible"
    :busy="props.busy"
    header="Sign to accept"
    confirm-label="Confirm & accept"
    confirm-severity="success"
    :confirm-disabled="!!props.uninsured && !uninsuredAck"
    @update:visible="(v) => emit('update:visible', v)"
    @confirm="(dataUrl) => emit('confirm', dataUrl)"
  >
    <p class="text-sm text-[color:var(--bs-text)]">
      By signing you accept this quote<template v-if="props.quoteTotal">
        of <span class="font-semibold">{{ money(props.quoteTotal) }}</span></template
      >.
    </p>
    <div
      v-if="props.upfrontFeeCents && props.upfrontFeeCents > 0"
      class="mt-2 rounded-md border border-[color:var(--bs-warning)] bg-[color:var(--bs-warning-tint)] px-3 py-2 text-xs text-[color:var(--bs-warning-text)]"
    >
      <i class="pi pi-wallet text-[color:var(--bs-warning-text)] mr-1"></i>
      A <span class="font-semibold">{{ money(props.upfrontFeeCents) }}</span> upfront amount is due
      before work begins.
    </div>

    <!-- Uninsured disclosure — only when the chosen tradesperson isn't insured. -->
    <div
      v-if="props.uninsured"
      class="mt-3 rounded-md border border-[color:var(--bs-danger)] bg-[color:var(--bs-danger-tint)] px-3 py-2.5"
    >
      <p class="text-sm font-semibold text-[color:var(--bs-danger-text)]">
        <i class="pi pi-exclamation-triangle mr-1"></i>{{ CLIENT_UNINSURED_TITLE }}
      </p>
      <p class="mt-1 text-xs text-[color:var(--bs-danger-text)]">
        {{ clientUninsuredBody(tradieName()) }}
      </p>
      <label class="mt-2 flex items-start gap-2 text-xs text-[color:var(--bs-danger-text)]">
        <Checkbox v-model="uninsuredAck" binary :disabled="props.busy" />
        <span>{{ CLIENT_UNINSURED_CHECKBOX }}</span>
      </label>
    </div>
  </BaseSignatureDialog>
</template>
