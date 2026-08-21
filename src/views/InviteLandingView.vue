<script setup lang="ts">
// Landing page for a COPIED/texted job-invite link (/invite/:token). One tap on
// "View my job" trades the token for a signed-in client session (redeemJobInvite)
// and drops the client straight into their job — no email typing, no inbox
// detour. Whoever holds the link can open the job; that's the deliberate
// tradeoff for a shareable link (the emailed magic link already behaves this
// way). The account-takeover guard lives server-side: if the invited email
// already has a Blue Seal account, redeemJobInvite refuses to mint a session and
// emails that inbox the magic link instead, and we show "check your inbox".
//
// Nothing runs on mount (a link-preview scanner executes JS but won't tap a
// button), so a prefetching bot can never consume the invite.
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "primevue/button";
import Message from "primevue/message";
import { useAuthStore } from "@/stores/auth";
import { claimJobInvite, redeemJobInvite } from "@/firebase/services/jobs";
import { humanizeError } from "@/utils/errors";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const token = String(route.params.token ?? "");

const status = ref<"idle" | "working" | "emailed" | "error">("idle");
const error = ref<string | null>(null);

// Settle persisted auth up front (no sign-in triggered) so an already-signed-in
// client who taps through can claim with their current session.
onMounted(() => {
  void auth.init();
});

// Attach every invite matching the signed-in email and navigate to the job.
// Returns false when the current session has no matching invite (wrong/no
// account) so the caller can fall back to token redemption.
async function claimAndGo(): Promise<boolean> {
  const res = await claimJobInvite(true);
  if (res.status === "claimed" && res.jobIds.length > 0) {
    // A claim on an already-finished job is a review ask (the tradesperson
    // sent the link from the completed job's banner) — land them on the
    // review prompt, not a generic job view. Offline-accepted jobs are
    // excluded: the rules never allow public reviews there.
    const first = res.jobs?.[0];
    const review =
      first &&
      (first.status === "complete" || first.status === "reviewed") &&
      !first.acceptedOffline;
    await router.push(`/jobs/${res.jobIds[0]}${review ? "?review=1" : ""}`);
    return true;
  }
  return false;
}

async function openJob() {
  if (status.value === "working") return;
  status.value = "working";
  error.value = null;
  try {
    await auth.init();

    // Already signed in as the invited client? Claim directly — no new session.
    if (auth.isAuthenticated && (await claimAndGo())) return;

    const res = await redeemJobInvite(token);
    if (res.mode === "emailed") {
      // Email already has an account — the magic link was sent to that inbox.
      status.value = "emailed";
      return;
    }

    // Brand-new client: sign in with the minted token, then claim + open.
    await auth.completeInviteTokenSignIn(res.customToken);
    if (await claimAndGo()) return;
    // Signed in, but nothing left to claim (already claimed / revoked mid-flight).
    await router.push("/dashboard");
  } catch (e) {
    error.value = humanizeError(e);
    status.value = "error";
  }
}
</script>

<template>
  <section class="bs-container py-10 max-w-md">
    <h1 class="text-2xl font-bold text-center">Your job on Blue Seal</h1>

    <template v-if="status !== 'emailed'">
      <p class="text-sm text-[color:var(--bs-muted)] mt-3 text-center">
        Your tradesperson set up your job on Blue Seal — quotes, schedule and
        invoices in one place. One tap opens it. No password, no account setup.
      </p>
      <div class="mt-6 space-y-3">
        <Button
          label="View my job"
          icon="pi pi-arrow-right"
          class="w-full"
          size="large"
          :loading="status === 'working'"
          @click="openJob"
        />
        <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
      </div>
    </template>

    <div v-else class="bs-empty mt-6 text-center">
      <i class="pi pi-envelope text-4xl mb-2 block text-[color:var(--bs-blue)]"></i>
      <p class="font-semibold">Check your inbox</p>
      <p class="text-sm text-[color:var(--bs-muted)] mt-1">
        You already have a Blue Seal account for this email, so we've sent a
        one-tap sign-in link there. Open it to view your job.
      </p>
    </div>
  </section>
</template>
