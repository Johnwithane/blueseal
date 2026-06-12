<script setup lang="ts">
// Magic-link landing for job invites (/claim-job). Distinct from the
// prospect ClaimView (/claim): that one provisions TRADESPEOPLE and routes
// to onboarding; this one provisions a CLIENT account and attaches them to
// the job(s) they were invited to.
//
// Deliberately nothing runs on mount: corporate mail scanners execute JS,
// and an auto-run would let them consume the one-time sign-in link
// (ClaimView's known exposure — not repeated here). The visitor confirms
// their email and presses a button; after sign-in we PREVIEW the invites
// ("<tradie> invited you to <job>") so the wrong person can stop before
// being attached, then claim on explicit confirmation.
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import { useAuthStore } from "@/stores/auth";
import { claimJobInvite, type InvitePreview } from "@/firebase/services/jobs";
import { humanizeError } from "@/utils/errors";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const email = ref<string>(typeof route.query.email === "string" ? route.query.email : "");
const status = ref<"confirm_email" | "signing_in" | "preview" | "claiming" | "done" | "none" | "error">(
  "confirm_email",
);
const error = ref<string | null>(null);
const invites = ref<InvitePreview[]>([]);
const claimedJobIds = ref<string[]>([]);

const hasOfflineRecords = computed(() => invites.value.some((i) => i.acceptedOffline));

async function signIn() {
  if (status.value === "signing_in") return;
  const addr = email.value.trim().toLowerCase();
  if (!addr) return;
  status.value = "signing_in";
  error.value = null;
  try {
    await auth.init();
    await auth.completeEmailLinkSignIn(addr, { role: "client" });
    const res = await claimJobInvite(false);
    if (res.status === "needs_verification") {
      error.value = "We couldn't verify your email from this link. Ask your tradesperson to re-send it.";
      status.value = "error";
      return;
    }
    if (res.status === "none") {
      // Signed in fine but no pending invites — already claimed (second
      // device / double-click) or revoked. Send them to their dashboard.
      status.value = "none";
      setTimeout(() => router.push("/dashboard"), 2200);
      return;
    }
    if (res.status === "preview") {
      invites.value = res.invites;
      status.value = "preview";
    }
  } catch (e) {
    error.value = humanizeError(e);
    status.value = "error";
  }
}

async function confirmClaim() {
  if (status.value === "claiming") return;
  status.value = "claiming";
  error.value = null;
  try {
    const res = await claimJobInvite(true);
    if (res.status === "claimed" && res.claimed > 0) {
      claimedJobIds.value = res.jobIds;
      status.value = "done";
      const target = res.jobIds.length === 1 ? `/jobs/${res.jobIds[0]}` : "/dashboard";
      setTimeout(() => router.push(target), 1800);
    } else {
      status.value = "none";
      setTimeout(() => router.push("/dashboard"), 2200);
    }
  } catch (e) {
    error.value = humanizeError(e);
    status.value = "error";
  }
}
</script>

<template>
  <section class="bs-container py-10 max-w-md">
    <h1 class="text-2xl font-bold text-center">Join your job on Blue Seal</h1>

    <div v-if="status === 'confirm_email' || status === 'signing_in'" class="mt-6 space-y-3">
      <p class="text-sm text-[color:var(--bs-muted)] text-center">
        Confirm the email this link was sent to and we'll sign you in — no
        password needed.
      </p>
      <InputText
        v-model="email"
        type="email"
        placeholder="you@example.com"
        class="w-full"
        autocomplete="email"
        @keydown.enter="signIn"
      />
      <Button
        label="Sign in & view my job"
        icon="pi pi-arrow-right"
        class="w-full"
        :loading="status === 'signing_in'"
        :disabled="!email.trim()"
        @click="signIn"
      />
    </div>

    <div v-else-if="status === 'preview' || status === 'claiming'" class="mt-6 space-y-3">
      <p class="text-sm text-center">
        You've been invited to {{ invites.length === 1 ? "this job" : "these jobs" }}:
      </p>
      <div
        v-for="inv in invites"
        :key="inv.jobId"
        class="bs-card p-3 text-left"
      >
        <div class="font-semibold text-sm">{{ inv.title }}</div>
        <div class="text-xs text-[color:var(--bs-muted)] mt-0.5">
          {{ inv.tradieName }}<span v-if="inv.trade"> · {{ inv.trade }}</span>
          <span v-if="inv.clientName"> · invited as {{ inv.clientName }}</span>
        </div>
        <div v-if="inv.acceptedOffline" class="text-xs mt-1 text-[color:var(--bs-warn,#b45309)]">
          <i class="pi pi-info-circle text-[10px]"></i>
          Your tradesperson recorded a quote acceptance on your behalf before you
          joined — you'll see it in the job log.
        </div>
      </div>
      <p class="text-xs text-[color:var(--bs-muted)] text-center">
        Not you, or don't recognize {{ invites.length === 1 ? "this job" : "these jobs" }}?
        Just close this page — nothing is linked to you until you continue.
      </p>
      <Button
        :label="invites.length === 1 ? 'Yes, this is my job' : 'Yes, these are my jobs'"
        icon="pi pi-check"
        class="w-full"
        :loading="status === 'claiming'"
        @click="confirmClaim"
      />
    </div>

    <div v-else-if="status === 'done'" class="bs-empty mt-6 text-center">
      <i class="pi pi-check-circle text-4xl text-[color:var(--bs-success)] mb-2 block"></i>
      <p class="font-semibold">You're in!</p>
      <p class="text-sm text-[color:var(--bs-muted)] mt-1">
        {{ hasOfflineRecords ? "Taking you to your job — check the log for anything recorded before you joined…" : "Taking you to your job…" }}
      </p>
    </div>

    <div v-else-if="status === 'none'" class="bs-empty mt-6 text-center">
      <i class="pi pi-info-circle text-4xl mb-2 block text-[color:var(--bs-blue)]"></i>
      <p class="font-semibold">You're signed in</p>
      <p class="text-sm text-[color:var(--bs-muted)] mt-1">
        No pending invites for this email — if you already joined, your job is
        on your dashboard. Taking you there…
      </p>
    </div>

    <Message v-else-if="status === 'error'" severity="error" :closable="false" class="mt-6">
      {{ error }}
    </Message>
  </section>
</template>
