<script setup lang="ts">
// Landing page for a COPIED/texted job-invite link (/invite/:token). The
// token can't sign anyone in — the only thing this page can do is ask the
// server to email a fresh magic sign-in link to the address the tradesperson
// stored on the invite. Requiring the visitor to type that email (and press
// a button — nothing runs on mount, so link-preview scanners get nothing)
// keeps inbox control as the credential even if the text was forwarded.
import { ref } from "vue";
import { useRoute } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import { sendJobInviteSignInLink } from "@/firebase/services/jobs";
import { humanizeError } from "@/utils/errors";

const route = useRoute();
const token = String(route.params.token ?? "");

const email = ref("");
const status = ref<"form" | "sending" | "sent" | "error">("form");
const error = ref<string | null>(null);

async function submit() {
  if (status.value === "sending") return;
  const addr = email.value.trim().toLowerCase();
  if (!addr) return;
  status.value = "sending";
  error.value = null;
  try {
    await sendJobInviteSignInLink(token, addr);
    status.value = "sent";
  } catch (e) {
    error.value = humanizeError(e);
    status.value = "error";
  }
}
</script>

<template>
  <section class="bs-container py-10 max-w-md">
    <h1 class="text-2xl font-bold text-center">Your job on Blue Seal</h1>

    <template v-if="status === 'form' || status === 'error' || status === 'sending'">
      <p class="text-sm text-[color:var(--bs-muted)] mt-3 text-center">
        Your tradesperson set up your job on Blue Seal — quotes, schedule and
        invoices in one place. Confirm your email and we'll send you a sign-in
        link. No password, no account setup.
      </p>
      <div class="mt-6 space-y-3">
        <InputText
          v-model="email"
          type="email"
          placeholder="you@example.com"
          class="w-full"
          autocomplete="email"
          @keydown.enter="submit"
        />
        <Button
          label="Email me a sign-in link"
          icon="pi pi-envelope"
          class="w-full"
          :loading="status === 'sending'"
          :disabled="!email.trim()"
          @click="submit"
        />
        <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
        <p class="text-xs text-[color:var(--bs-muted)] text-center">
          It must be the email your tradesperson used to invite you.
        </p>
      </div>
    </template>

    <div v-else-if="status === 'sent'" class="bs-empty mt-6 text-center">
      <i class="pi pi-envelope text-4xl mb-2 block text-[color:var(--bs-blue)]"></i>
      <p class="font-semibold">Check your inbox</p>
      <p class="text-sm text-[color:var(--bs-muted)] mt-1">
        We've emailed a sign-in link to <strong>{{ email.trim().toLowerCase() }}</strong
        >. One tap and you're in.
      </p>
    </div>
  </section>
</template>
