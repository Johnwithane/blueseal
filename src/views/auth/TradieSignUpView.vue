<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Password from "primevue/password";
import Checkbox from "primevue/checkbox";
import Message from "primevue/message";
import { useAuthStore } from "@/stores/auth";
import { signUpSchema } from "@/validation/schemas";
import { humanizeError } from "@/utils/errors";

const auth = useAuthStore();
const router = useRouter();

const displayName = ref("");
const email = ref("");
const password = ref("");
const termsAccepted = ref(false);
const fieldErrors = ref<Record<string, string>>({});
const formError = ref<string | null>(null);

async function submit() {
  fieldErrors.value = {};
  formError.value = null;
  const parsed = signUpSchema.safeParse({
    displayName: displayName.value,
    email: email.value,
    password: password.value,
    role: "tradesperson",
    termsAccepted: termsAccepted.value,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      fieldErrors.value[issue.path[0] as string] = issue.message;
    }
    return;
  }
  try {
    await auth.signUp(parsed.data);
    router.replace("/onboarding");
  } catch (e) {
    formError.value = humanizeError(e);
  }
}

async function google() {
  if (!termsAccepted.value) {
    fieldErrors.value = {
      termsAccepted: "You must agree to the Terms of Service and Privacy Policy",
    };
    return;
  }
  fieldErrors.value = {};
  formError.value = null;
  try {
    await auth.signInWithGoogle("tradesperson");
    router.replace("/onboarding");
  } catch (e) {
    formError.value = humanizeError(e);
  }
}
</script>

<template>
  <section class="bs-container py-12 max-w-md mx-auto">
    <div class="bs-pill verified mb-3">
      <i class="pi pi-verified"></i>
      <span>For tradespeople</span>
    </div>
    <h1 class="text-2xl font-bold">Build your verified profile</h1>
    <p class="text-[color:var(--bs-muted)] mb-6">
      We'll vet your cert + ID, then put you in front of nearby clients.
    </p>

    <form class="bs-form bs-card p-6 space-y-4" @submit.prevent="submit">
      <div>
        <label class="text-sm font-medium">Your name</label>
        <InputText v-model="displayName" class="mt-1" autocomplete="name" />
        <small v-if="fieldErrors.displayName" class="text-red-600">{{ fieldErrors.displayName }}</small>
      </div>
      <div>
        <label class="text-sm font-medium">Email</label>
        <InputText v-model="email" type="email" class="mt-1" autocomplete="email" />
        <small v-if="fieldErrors.email" class="text-red-600">{{ fieldErrors.email }}</small>
      </div>
      <div>
        <label class="text-sm font-medium">Password</label>
        <Password v-model="password" toggle-mask input-class="w-full" class="mt-1 w-full" autocomplete="new-password" />
        <small v-if="fieldErrors.password" class="text-red-600">{{ fieldErrors.password }}</small>
      </div>

      <div>
        <label class="flex items-start gap-2 text-sm cursor-pointer">
          <Checkbox v-model="termsAccepted" :binary="true" input-id="terms-accepted-tradie" />
          <span>
            I agree to the
            <router-link to="/terms" target="_blank" class="font-medium underline">Terms of Service</router-link>
            and
            <router-link to="/privacy" target="_blank" class="font-medium underline">Privacy Policy</router-link>.
            I understand Blue Seal is a platform — not my employer or contractor — and that
            I'll need to upload a trade certification and government-issued ID to be approved.
          </span>
        </label>
        <small v-if="fieldErrors.termsAccepted" class="text-red-600 block mt-1">
          {{ fieldErrors.termsAccepted }}
        </small>
      </div>

      <Message v-if="formError" severity="error" :closable="false">{{ formError }}</Message>

      <Button type="submit" label="Start onboarding" :loading="auth.pending" class="w-full" />
      <Button label="Continue with Google" icon="pi pi-google" outlined class="w-full" @click="google" />
    </form>
  </section>
</template>
