<script setup lang="ts">
// Completion page for a passwordless sign-in link (/finish-signin). The link's
// email rides in ?email= (we generate it server-side), so we complete the
// Firebase email-link sign-in and redirect — no claim, no password. A new email
// is provisioned as a client (the safe default); existing accounts just sign in.
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import { useAuthStore } from "@/stores/auth";
import { humanizeError } from "@/utils/errors";
import { useSeo } from "@/composables/useSeo";

useSeo({ title: "Signing in", noindex: true });

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const status = ref<"working" | "need_email" | "error">("working");
const error = ref<string | null>(null);
const email = ref<string>(typeof route.query.email === "string" ? route.query.email : "");

async function run() {
  status.value = "working";
  error.value = null;
  if (!email.value.trim()) {
    status.value = "need_email";
    return;
  }
  try {
    await auth.init();
    await auth.completeEmailLinkSignIn(email.value.trim().toLowerCase(), { role: "client" });
    const redirect = (route.query.redirect as string) || "/dashboard";
    router.replace(redirect);
  } catch (e) {
    error.value = humanizeError(e);
    status.value = "error";
  }
}

onMounted(run);
</script>

<template>
  <section class="bs-container py-12 max-w-md text-center">
    <h1 class="text-2xl font-bold">Signing you in…</h1>

    <div v-if="status === 'working'" class="bs-empty mt-6">
      <i class="pi pi-spin pi-spinner text-3xl mb-2 block"></i>
      <p>One moment…</p>
    </div>

    <div v-else-if="status === 'need_email'" class="mt-6 space-y-3 text-left">
      <p class="text-sm text-[color:var(--bs-muted)]">Confirm the email this link was sent to:</p>
      <InputText v-model="email" placeholder="you@business.com" class="w-full" />
      <Button label="Continue" icon="pi pi-arrow-right" class="w-full" @click="run" />
    </div>

    <Message v-else-if="status === 'error'" severity="error" :closable="false" class="mt-6">
      {{ error }} You can request a fresh link from the
      <router-link to="/sign-in" class="font-medium underline">sign-in page</router-link>.
    </Message>
  </section>
</template>
