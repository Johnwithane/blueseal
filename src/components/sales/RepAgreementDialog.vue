<script setup lang="ts">
import { ref } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import SignatureCanvas from "@/components/SignatureCanvas.vue";
import MarkdownProse from "@/components/help/MarkdownProse.vue";
import { REP_AGREEMENT_MARKDOWN } from "@/sales/agreement";
import { signSalesAgreement } from "@/firebase/services/salesReps";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

// Blocking first-login gate for sales reps: they cannot act as a rep (claim a
// referral code, vet anyone) until they e-sign the current liability agreement.
// App.vue mounts this when activeRole === "sales" and the rep hasn't signed the
// current version; on success we reload the user doc so the gate clears and the
// dialog unmounts.
const auth = useAuthStore();
const toast = useToast();

const visible = ref(true);
const sig = ref<InstanceType<typeof SignatureCanvas> | null>(null);
const empty = ref(true);
const saving = ref(false);

async function submit() {
  const dataUrl = sig.value?.extract() ?? "";
  if (!dataUrl) {
    toast.warn("Sign first", "Please draw your signature to agree.");
    return;
  }
  saving.value = true;
  try {
    await signSalesAgreement(dataUrl);
    await auth.reloadUserDoc();
    toast.success("Signed", "You're all set. Welcome to the Blue Seal sales team.");
  } catch (e) {
    toast.error("Couldn't sign", humanizeError(e));
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    modal
    :closable="false"
    :close-on-escape="false"
    :draggable="false"
    header="Sales representative agreement"
    class="w-[min(36rem,92vw)]"
  >
    <p class="text-sm text-[color:var(--bs-muted)] mb-3">
      Before you can refer tradespeople or review applications, please read and sign the agreement
      below. You only need to do this once.
    </p>
    <div class="max-h-[40vh] overflow-y-auto bs-card p-3 mb-4">
      <MarkdownProse :source="REP_AGREEMENT_MARKDOWN" />
    </div>
    <label class="text-xs font-medium block mb-1">Your signature</label>
    <SignatureCanvas ref="sig" @update:empty="(v) => (empty = v)" />
    <div class="flex justify-end gap-2 mt-3">
      <Button label="Clear" text :disabled="saving || empty" @click="sig?.clear()" />
      <Button label="Agree & sign" icon="pi pi-check" :loading="saving" :disabled="empty" @click="submit" />
    </div>
  </Dialog>
</template>
