<script setup lang="ts">
import { ref } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import { useAuthStore } from "@/stores/auth";
import { forgotPasswordSchema } from "@/validation/schemas";
import { humanizeError } from "@/utils/errors";
import { useSeo } from "@/composables/useSeo";

useSeo({ title: "Reset your password", noindex: true });

const auth = useAuthStore();

const email = ref("");
const fieldError = ref<string | null>(null);
const formError = ref<string | null>(null);
const submitted = ref(false);
const sending = ref(false);

async function submit() {
  fieldError.value = null;
  formError.value = null;
  const parsed = forgotPasswordSchema.safeParse({ email: email.value });
  if (!parsed.success) {
    fieldError.value = parsed.error.issues[0]?.message ?? "Enter a valid email";
    return;
  }
  sending.value = true;
  try {
    await auth.sendPasswordReset(parsed.data.email);
    // Always show success regardless of whether the account exists, to avoid
    // leaking which emails are registered.
    submitted.value = true;
  } catch (e) {
    formError.value = humanizeError(e);
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <section class="bs-container py-12 max-w-md mx-auto">
    <h1 class="text-2xl font-bold">Reset your password</h1>
    <p class="text-[color:var(--bs-muted)] mb-6">
      Enter your email and we'll send you a link to reset your password.
    </p>

    <form
      v-if="!submitted"
      class="bs-form bs-card p-6 space-y-4"
      @submit.prevent="submit"
    >
      <div>
        <label class="text-sm font-medium">Email</label>
        <InputText v-model="email" type="email" class="mt-1" autocomplete="email" />
        <small v-if="fieldError" class="text-red-600">{{ fieldError }}</small>
      </div>

      <Message v-if="formError" severity="error" :closable="false">{{ formError }}</Message>

      <Button
        type="submit"
        label="Send reset link"
        :loading="sending"
        class="w-full"
      />

      <p class="text-sm text-center">
        Remembered it?
        <router-link to="/sign-in" class="font-medium">Sign in</router-link>
      </p>
    </form>

    <div v-else class="bs-card p-6 space-y-4">
      <Message severity="success" :closable="false">
        If an account exists for <strong>{{ email }}</strong>, a reset link is on its way.
        Check your inbox (and spam folder).
      </Message>
      <router-link
        to="/sign-in"
        class="block text-sm text-center font-medium"
      >
        Back to sign in
      </router-link>
    </div>
  </section>
</template>
