<script setup lang="ts">
// Attention banner when the tradesperson submits the wrap-up. The actual
// approve / request-changes actions live on the invoice itself
// (ClientInvoiceCard, Invoice tab) so the client decides while LOOKING at
// the line items — this banner just walks them there.
import Button from "primevue/button";
import StatusBanner from "@/components/StatusBanner.vue";

const emit = defineEmits<{
  /** Client tapped through — parent switches to the Invoice tab. */
  review: [];
}>();
</script>

<template>
  <StatusBanner severity="action" icon="pi-check-circle" title="Please review the work">
    <template #body>
      <p class="text-sm text-[color:var(--bs-muted)] mt-1">
        Your tradesperson marked the job as done. Review the invoice — you can
        approve and pay it there, or request changes if anything's off.
      </p>
    </template>
    <template #actions>
      <Button
        label="Review invoice"
        icon="pi pi-receipt"
        severity="success"
        @click="emit('review')"
      />
    </template>
  </StatusBanner>
</template>
