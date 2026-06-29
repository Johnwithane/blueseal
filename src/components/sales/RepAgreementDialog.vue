<script setup lang="ts">
import { ref } from "vue";
import BaseSignatureDialog from "@/components/BaseSignatureDialog.vue";
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
const saving = ref(false);

async function onConfirm(dataUrl: string) {
  saving.value = true;
  try {
    await signSalesAgreement(dataUrl);
    // Close immediately on success so the rep isn't left staring at the
    // signature pad. reloadUserDoc then clears the gate (App.vue's
    // needsRepAgreement) so the dialog doesn't remount.
    visible.value = false;
    await auth.reloadUserDoc();
    toast.success("Signed", "You're all set. Welcome to the Blue Seal sales team.");
  } catch (e) {
    toast.error("Couldn't sign", humanizeError(e));
    saving.value = false;
  }
}
</script>

<template>
  <BaseSignatureDialog
    v-model:visible="visible"
    :busy="saving"
    blocking
    header="Sales representative agreement"
    dialog-class="w-[min(36rem,92vw)]"
    :cancelable="false"
    @confirm="onConfirm"
  >
    <p class="text-sm text-[color:var(--bs-muted)] mb-3">
      Before you can refer tradespeople or review applications, please read and sign the agreement
      below. You only need to do this once.
    </p>
    <div class="max-h-[40vh] overflow-y-auto bs-card p-3 mb-4">
      <MarkdownProse :source="REP_AGREEMENT_MARKDOWN" />
    </div>
    <label class="text-xs font-medium block mb-1">Your signature</label>
  </BaseSignatureDialog>
</template>
