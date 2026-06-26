<script setup lang="ts">
// Magic-link landing for PROJECT invites (/claim-project). Mirrors InviteClaimView:
// nothing runs on mount (corporate mail scanners execute JS and would consume the
// one-time sign-in link); the visitor confirms their email, we PREVIEW the project
// invites ("you were invited to <project>") so the wrong person can stop before
// being attached, then claim on explicit confirmation. Claiming attaches them as
// the client; the Accept / Decline decision happens on their dashboard (the
// "Projects set up for you" panel), so this view hands off there.
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import { useAuthStore } from "@/stores/auth";
import { claimProjectInvite, type ProjectInvitePreview } from "@/firebase/services/projects";
import { humanizeError } from "@/utils/errors";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const email = ref<string>(typeof route.query.email === "string" ? route.query.email : "");
const status = ref<
  "confirm_email" | "signing_in" | "preview" | "claiming" | "done" | "none" | "error"
>("confirm_email");
const error = ref<string | null>(null);
const invites = ref<ProjectInvitePreview[]>([]);

async function signIn() {
  if (status.value === "signing_in") return;
  const addr = email.value.trim().toLowerCase();
  if (!addr) return;
  status.value = "signing_in";
  error.value = null;
  try {
    await auth.init();
    await auth.completeEmailLinkSignIn(addr, { role: "client" });
    const res = await claimProjectInvite(false);
    if (res.status === "needs_verification") {
      error.value = "We couldn't verify your email from this link. Ask your project manager to re-send it.";
      status.value = "error";
      return;
    }
    if (res.status === "none") {
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
    const res = await claimProjectInvite(true);
    if (res.status === "claimed" && res.claimed > 0) {
      status.value = "done";
      setTimeout(() => router.push("/dashboard"), 1800);
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
    <h1 class="text-2xl font-bold text-center">Your project on Blue Seal</h1>

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
        label="Sign in & view my project"
        icon="pi pi-arrow-right"
        class="w-full"
        :loading="status === 'signing_in'"
        :disabled="!email.trim()"
        @click="signIn"
      />
    </div>

    <div v-else-if="status === 'preview' || status === 'claiming'" class="mt-6 space-y-3">
      <p class="text-sm text-center">
        You've been invited to {{ invites.length === 1 ? "this project" : "these projects" }}:
      </p>
      <div v-for="inv in invites" :key="inv.projectId" class="bs-card p-3 text-left">
        <div class="font-semibold text-sm">{{ inv.label }}</div>
        <div class="text-xs text-[color:var(--bs-muted)] mt-0.5">
          {{ inv.jobCount }} {{ inv.jobCount === 1 ? "job" : "jobs" }}
          <span v-if="inv.clientName"> · invited as {{ inv.clientName }}</span>
        </div>
      </div>
      <p class="text-xs text-[color:var(--bs-muted)] text-center">
        Not you, or don't recognize {{ invites.length === 1 ? "this project" : "these projects" }}?
        Just close this page — nothing is linked to you until you continue.
      </p>
      <Button
        :label="invites.length === 1 ? 'Yes, show me the project' : 'Yes, show me these projects'"
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
        Taking you to your dashboard to review and accept…
      </p>
    </div>

    <div v-else-if="status === 'none'" class="bs-empty mt-6 text-center">
      <i class="pi pi-info-circle text-4xl mb-2 block text-[color:var(--bs-blue)]"></i>
      <p class="font-semibold">You're signed in</p>
      <p class="text-sm text-[color:var(--bs-muted)] mt-1">
        No pending project invites for this email — if you already joined, your
        projects are on your dashboard. Taking you there…
      </p>
    </div>

    <Message v-else-if="status === 'error'" severity="error" :closable="false" class="mt-6">
      {{ error }}
    </Message>
  </section>
</template>
