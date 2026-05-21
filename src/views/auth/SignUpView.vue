<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Password from "primevue/password";
import Message from "primevue/message";
import Divider from "primevue/divider";
import { useAuthStore } from "@/stores/auth";
import { signUpSchema } from "@/validation/schemas";

const auth = useAuthStore();
const router = useRouter();

const displayName = ref("");
const email = ref("");
const password = ref("");
const fieldErrors = ref<Record<string, string>>({});
const formError = ref<string | null>(null);

async function submit() {
  fieldErrors.value = {};
  formError.value = null;
  const parsed = signUpSchema.safeParse({
    displayName: displayName.value,
    email: email.value,
    password: password.value,
    role: "client",
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      fieldErrors.value[issue.path[0] as string] = issue.message;
    }
    return;
  }
  try {
    await auth.signUp(parsed.data);
    router.replace("/dashboard");
  } catch (e) {
    formError.value = (e as Error).message;
  }
}

async function google() {
  try {
    await auth.signInWithGoogle("client");
    router.replace("/dashboard");
  } catch (e) {
    formError.value = (e as Error).message;
  }
}
</script>

<template>
  <section class="bs-container py-12 max-w-md mx-auto">
    <h1 class="text-2xl font-bold">Create your account</h1>
    <p class="text-[color:var(--bs-muted)] mb-6">Find verified tradies near you.</p>

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
        <Password
          v-model="password"
          toggle-mask
          input-class="w-full"
          class="mt-1 w-full"
          autocomplete="new-password"
        />
        <small v-if="fieldErrors.password" class="text-red-600">{{ fieldErrors.password }}</small>
      </div>

      <Message v-if="formError" severity="error" :closable="false">{{ formError }}</Message>

      <Button type="submit" label="Create account" :loading="auth.pending" class="w-full" />

      <Divider align="center"><span class="text-xs text-[color:var(--bs-muted)]">or</span></Divider>
      <Button label="Continue with Google" icon="pi pi-google" outlined class="w-full" @click="google" />

      <p class="text-sm text-center">
        Already have an account?
        <router-link to="/sign-in" class="font-medium">Sign in</router-link>
      </p>
      <p class="text-sm text-center text-[color:var(--bs-muted)]">
        Tradesperson?
        <router-link to="/sign-up/tradie" class="font-medium">Sign up as a trade</router-link>
      </p>
    </form>
  </section>
</template>
