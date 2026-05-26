<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import Message from "primevue/message";
import Checkbox from "primevue/checkbox";
import { getInvoice } from "@/firebase/services/invoices";
import { clientMarkPaid } from "@/firebase/services/jobs";
import type { InvoiceDoc, WithId } from "@/firebase/interfaces";
import { useFormatters } from "@/composables/useFormatters";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

const props = defineProps<{
  visible: boolean;
  jobId: string;
  invoiceId: string;
}>();

const emit = defineEmits<{
  "update:visible": [v: boolean];
  paid: [];
}>();

const { money } = useFormatters();
const toast = useToast();

const invoice = ref<WithId<InvoiceDoc> | null>(null);
const loading = ref(true);
const confirming = ref(false);
const acknowledged = ref(false);

async function load() {
  if (!props.invoiceId) return;
  loading.value = true;
  invoice.value = await getInvoice(props.invoiceId);
  loading.value = false;
}

onMounted(() => {
  if (props.visible) void load();
});

watch(
  () => props.visible,
  (v) => {
    if (v) {
      acknowledged.value = false;
      void load();
    }
  },
);

const instructions = computed(
  () => invoice.value?.paymentInstructions?.trim() ?? "",
);

async function onConfirm() {
  if (confirming.value || !acknowledged.value) return;
  confirming.value = true;
  try {
    await clientMarkPaid(props.jobId);
    toast.success(
      "Payment confirmed",
      "Marked paid. The tradesperson has been notified.",
    );
    emit("paid");
    emit("update:visible", false);
  } catch (e) {
    toast.error("Couldn't confirm payment", humanizeError(e));
  } finally {
    confirming.value = false;
  }
}

function close() {
  if (confirming.value) return;
  emit("update:visible", false);
}
</script>

<template>
  <Dialog
    :visible="props.visible"
    modal
    :closable="!confirming"
    :dismissable-mask="!confirming"
    :draggable="false"
    header="Pay invoice"
    :style="{ width: '32rem', maxWidth: '92vw' }"
    @update:visible="(v) => emit('update:visible', v)"
  >
    <div v-if="loading" class="text-sm text-[color:var(--bs-muted)]">Loading…</div>
    <template v-else-if="invoice">
      <p class="text-sm text-[color:var(--bs-muted)] mb-3">
        Pay the tradesperson directly using the instructions below. Once
        you've sent the payment, confirm here to close out the job and
        receive a receipt.
      </p>

      <!-- Total to pay — bold, can't be missed. -->
      <div
        class="rounded-lg border-2 border-[color:var(--bs-blue)] p-4 mb-3 flex items-center justify-between"
        style="background: color-mix(in srgb, var(--bs-blue-light) 30%, transparent);"
      >
        <div>
          <div class="text-xs text-[color:var(--bs-muted)]">Amount due</div>
          <div class="text-2xl font-bold leading-tight">
            {{ money(invoice.total) }}
          </div>
        </div>
        <div class="text-right text-xs text-[color:var(--bs-muted)]">
          {{ invoice.invoiceNumber }}
        </div>
      </div>

      <!-- Tradesperson's payment instructions. The InvoiceDoc carries this
           free-text field — typically e-transfer email, account info, or
           "cash on completion". Falls back to a generic prompt if the
           tradesperson hasn't set anything up. -->
      <div class="bs-card p-3 mb-3">
        <h4 class="font-semibold text-sm mb-1 flex items-center gap-2">
          <i class="pi pi-info-circle text-[color:var(--bs-blue)]"></i>
          How to pay
        </h4>
        <p
          v-if="instructions"
          class="text-sm whitespace-pre-wrap leading-snug"
        >{{ instructions }}</p>
        <p v-else class="text-sm text-[color:var(--bs-muted)]">
          The tradesperson hasn't set up payment instructions yet. Message
          them in the chat to agree on a method (e-transfer, cash, etc.)
          before confirming below.
        </p>
      </div>

      <Message
        severity="warn"
        :closable="false"
        class="text-xs mb-3"
      >
        Card payments aren't enabled yet on Blue Seal — payment happens
        directly between you and the tradesperson. Only confirm once
        you've actually sent it.
      </Message>

      <label class="flex items-start gap-2 text-sm cursor-pointer">
        <Checkbox v-model="acknowledged" :binary="true" />
        <span>
          I've sent
          <span class="font-semibold">{{ money(invoice.total) }}</span>
          to the tradesperson and want to mark this invoice paid.
        </span>
      </label>
    </template>

    <template #footer>
      <Button label="Cancel" text :disabled="confirming" @click="close" />
      <Button
        label="Confirm payment sent"
        icon="pi pi-check"
        severity="success"
        :loading="confirming"
        :disabled="confirming || !acknowledged || loading"
        @click="onConfirm"
      />
    </template>
  </Dialog>
</template>
