<script setup lang="ts">
// Magic-link claim handler. The prospect clicks the sign-in link in their
// outreach email and lands here: we complete the Firebase email-link sign-in
// (which marks their email VERIFIED), then call claimProspect to migrate their
// seeded listing + convert any waiting customer requests into real jobs.
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import { useAuthStore } from "@/stores/auth";
import { claimProspect } from "@/firebase/services/prospects";
import { humanizeError } from "@/utils/errors";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const status = ref<"working" | "need_email" | "error" | "done">("working");
const error = ref<string | null>(null);
const email = ref<string>(typeof route.query.email === "string" ? route.query.email : "");
const jobsCreated = ref(0);
// Whether a seeded listing was actually claimed (vs. signed in but no match).
const claimedListing = ref(false);

async function run() {
  status.value = "working";
  error.value = null;
  if (!email.value.trim()) {
    status.value = "need_email";
    return;
  }
  try {
    await auth.init();
    await auth.completeEmailLinkSignIn(email.value.trim().toLowerCase());
    const res = await claimProspect();
    if (res.status === "needs_verification") {
      // Shouldn't happen after a real magic-link sign-in, but don't mask it.
      error.value = "We couldn't verify your email from this link. Please request a fresh link.";
      status.value = "error";
      return;
    }
    // `claimed` = a seeded listing was migrated + leads converted.
    // `none` = signed in fine, but no listing matched (already claimed/expired
    // or never seeded). Either way they now hold a tradesperson account, so we
    // still send them to onboarding — just without the "requests waiting" UI.
    claimedListing.value = res.status === "claimed";
    if (res.status === "claimed") jobsCreated.value = res.jobsCreated;
    status.value = "done";
    setTimeout(() => router.push({ name: "TradieOnboarding" }), 1800);
  } catch (e) {
    error.value = humanizeError(e);
    status.value = "error";
  }
}

onMounted(run);
</script>

<template>
  <section class="bs-container py-10 max-w-md text-center">
    <h1 class="text-2xl font-bold">Claiming your Blue Seal profile…</h1>

    <div v-if="status === 'working'" class="bs-empty mt-6">
      <i class="pi pi-spin pi-spinner text-3xl mb-2 block"></i>
      <p>Signing you in securely…</p>
    </div>

    <div v-else-if="status === 'need_email'" class="mt-6 space-y-3 text-left">
      <p class="text-sm text-[color:var(--bs-muted)]">
        Confirm the email this link was sent to:
      </p>
      <InputText v-model="email" placeholder="you@business.com" class="w-full" />
      <Button label="Continue" icon="pi pi-arrow-right" class="w-full" @click="run" />
    </div>

    <Message v-else-if="status === 'error'" severity="error" :closable="false" class="mt-6">
      {{ error }}
    </Message>

    <div v-else-if="status === 'done'" class="mt-6">
      <i class="pi pi-check-circle text-4xl text-green-600 mb-2 block"></i>
      <p class="font-semibold">{{ claimedListing ? "You're in!" : "You're signed in" }}</p>
      <p v-if="jobsCreated" class="text-sm text-[color:var(--bs-muted)]">
        {{ jobsCreated }} customer request{{ jobsCreated === 1 ? "" : "s" }} waiting for you.
      </p>
      <p class="text-sm text-[color:var(--bs-muted)]">
        {{ claimedListing ? "Taking you to finish your profile…" : "Let's set up your Blue Seal profile…" }}
      </p>
    </div>
  </section>
</template>
