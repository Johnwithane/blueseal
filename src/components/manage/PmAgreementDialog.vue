<script setup lang="ts">
import { ref } from "vue";
import BaseSignatureDialog from "@/components/BaseSignatureDialog.vue";
import MarkdownProse from "@/components/help/MarkdownProse.vue";
import { PM_AGREEMENT_MARKDOWN } from "@/projectManager/agreement";
import { signPmAgreement } from "@/firebase/services/pmPayoutsService";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

// Project-manager agreement, presented at PAYOUT SETUP (not first login — a PM can
// use the cockpit before signing). Mirrors RepAgreementDialog, but parent-controlled:
// the Earnings panel opens it when the PM starts payout setup unsigned. On success
// we reload the user doc so the panel sees the signed agreement and moves to Connect.
defineProps<{ visible: boolean }>();
const emit = defineEmits<{ "update:visible": [boolean]; signed: [] }>();

const auth = useAuthStore();
const toast = useToast();

const saving = ref(false);

async function onConfirm(dataUrl: string) {
  saving.value = true;
  try {
    await signPmAgreement(dataUrl);
    emit("update:visible", false);
    await auth.reloadUserDoc();
    emit("signed");
    toast.success("Signed", "You're all set. Connect your bank account to get paid.");
  } catch (e) {
    toast.error("Couldn't sign", humanizeError(e));
    saving.value = false;
  }
}
</script>

<template>
  <BaseSignatureDialog
    :visible="visible"
    :busy="saving"
    header="Project manager agreement"
    dialog-class="w-[min(36rem,92vw)]"
    :cancelable="false"
    @update:visible="emit('update:visible', $event)"
    @confirm="onConfirm"
  >
    <p class="text-sm text-[color:var(--bs-muted)] mb-3">
      Before you set up payouts, please read and sign the agreement below. You only
      need to do this once (you can keep using the cockpit either way).
    </p>
    <div class="max-h-[40vh] overflow-y-auto bs-card p-3 mb-4">
      <MarkdownProse :source="PM_AGREEMENT_MARKDOWN" />
    </div>
    <label class="text-xs font-medium block mb-1">Your signature</label>
  </BaseSignatureDialog>
</template>
