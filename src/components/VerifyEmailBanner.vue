<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import Button from "primevue/button";
import { useAuthStore } from "@/stores/auth";
import { useToast } from "@/composables/useToast";
import { humanizeError } from "@/utils/errors";

// Global nudge shown to a signed-in user whose email isn't verified yet (only
// email+password signups — Google / magic-link accounts are already verified).
// For tradespeople this is also a hard gate: submitForVetting refuses an
// unverified account, so they can't go public until they confirm. The resend
// button re-fires the branded verification email (the callable caps it per day).
const auth = useAuthStore();
const toast = useToast();

const show = computed(
  () => auth.ready && auth.isAuthenticated && !auth.isEmailVerified,
);

// Tradespeople can't be reviewed/go public until verified; clients just miss
// out on reliable email — so the "why" differs by role.
const message = computed(() =>
  auth.hasTradieRole
    ? "Verify your email to submit your profile for review and start taking work."
    : "Verify your email so you reliably get messages, quotes, and password-reset emails.",
);

const sending = ref(false);
const cooldown = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;

function startCooldown(secs: number) {
  cooldown.value = secs;
  timer = setInterval(() => {
    cooldown.value -= 1;
    if (cooldown.value <= 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  }, 1000);
}

async function resend() {
  if (sending.value || cooldown.value > 0) return;
  sending.value = true;
  try {
    await auth.resendVerificationEmail();
    toast.success("Verification email sent", "Check your inbox — and your spam folder.");
    startCooldown(60);
  } catch (e) {
    toast.error("Couldn't send the email", humanizeError(e));
  } finally {
    sending.value = false;
  }
}

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div v-if="show" class="bs-verify-banner" role="status">
    <div class="bs-container flex items-center gap-2 py-2">
      <Button
        :label="cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend email'"
        size="small"
        icon="pi pi-envelope"
        :loading="sending"
        :disabled="cooldown > 0"
        class="shrink-0"
        @click="resend"
      />
      <i class="pi pi-exclamation-circle bs-verify-banner__icon shrink-0" aria-hidden="true"></i>
      <p class="min-w-0 flex-1 text-xs leading-snug sm:text-sm">
        <span class="font-semibold">Confirm your email</span>
        <span class="hidden sm:inline">
          <span class="text-[color:var(--bs-text)]/70"> — {{ message }}</span>
        </span>
      </p>
    </div>
  </div>
</template>

<style scoped>
.bs-verify-banner {
  background: #fff5e6;
  border-bottom: 1px solid var(--bs-border);
}
.bs-verify-banner__icon {
  font-size: 1.15rem;
  margin-top: 0.1rem;
  color: #b45309;
}
</style>
